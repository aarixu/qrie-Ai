import fs from 'node:fs';
import path from 'node:path';
import type { Beat, Lesson } from '../../../packages/lesson-format/src/types.ts';
import { checkTake, parsePcmFormat, pcmDurationMs } from './audio.ts';
import type { AudioEncoder } from './encode.ts';
import {
  audioFileName,
  emptyManifest,
  hashNarration,
  loadManifest,
  manifestDir,
  orderBeats,
  writeManifest,
  type NarrationManifest,
} from './manifest.ts';
import { planRender, type PlannedSkip, type RenderPlan } from './plan.ts';
import { buildSpeechPrompt } from './speechPrompt.ts';
import {
  isQuotaExhausted,
  retry,
  TransientTtsError,
  type RetryOptions,
  type TtsTransport,
} from './tts.ts';

/**
 * RENDERING THE CLASS.
 *
 * The rules that matter, all of them paid for by a real failure:
 *
 *  - One bad beat never kills the run. Transient failures get backoff and
 *    another take; a beat that still will not render is reported by name and
 *    the rest of the lesson is finished around it.
 *  - A take is measured before it is kept. Google's model sometimes reads the
 *    director's notes aloud or returns a truncated take, both with HTTP 200,
 *    and a silent bad recording shipping into a class is worse than a run that
 *    fails loudly.
 *  - The manifest never claims more than exists. It is written only after a
 *    take is on disk, so a run where everything fails leaves the committed
 *    recording exactly as it was.
 */

export interface RenderDeps {
  tts: TtsTransport;
  encoder: AudioEncoder;
}

export type RenderEvent =
  | { kind: 'rendered'; beatId: string; durationMs: number; bytes: number }
  | { kind: 'failed'; beatId: string; error: string }
  | { kind: 'retry'; beatId: string; attempt: number; delayMs: number; error: string };

export interface RenderOptions {
  voice: string;
  model: string;
  force?: boolean;
  /** Small by default: there is no published rate limit and a 429 storm helps nobody. */
  concurrency?: number;
  retry?: RetryOptions;
  onEvent?: (event: RenderEvent) => void;
}

export interface RenderedBeat {
  beatId: string;
  file: string;
  durationMs: number;
  bytes: number;
}

export interface RenderReport {
  rendered: RenderedBeat[];
  skipped: PlannedSkip[];
  failed: { beatId: string; error: string }[];
  /** Beats never attempted because the run stopped early. */
  notAttempted: string[];
  /** Manifest entries dropped because the lesson no longer has that beat. */
  pruned: string[];
  plan: RenderPlan;
  manifest: NarrationManifest;
  manifestWritten: boolean;
  /** The finished class as it now stands on disk, not just this run. */
  totalDurationMs: number;
  totalBytes: number;
  /** This run only — what the run actually cost. */
  renderedDurationMs: number;
}

export const DEFAULT_CONCURRENCY = 2;

export interface LessonPlan {
  plan: RenderPlan;
  manifest: NarrationManifest | null;
  /** Set when a manifest file exists but is unusable, so the caller can say why. */
  problem?: string;
}

/**
 * The plan, bound to the filesystem. Both --dry-run and the real run go through
 * here, so what a dry run prints is what a real run does.
 */
export function planForLesson(
  lesson: Lesson,
  lessonDir: string,
  opts: { voice: string; model: string; force?: boolean },
): LessonPlan {
  const audioDir = manifestDir(lessonDir);
  const loaded = loadManifest(lessonDir);

  // A manifest carrying another lesson's id was copied in; trusting it would
  // skip beats whose audio is somebody else's voice saying something else.
  const usable =
    loaded.manifest && loaded.manifest.lessonId === lesson.id ? loaded.manifest : null;
  const problem =
    loaded.problem ??
    (loaded.manifest && !usable
      ? `narration.json belongs to lesson "${loaded.manifest.lessonId}", not "${lesson.id}"`
      : undefined);

  const plan = planRender(lesson, usable, {
    voice: opts.voice,
    model: opts.model,
    force: opts.force,
    audioExists: (file) => fs.existsSync(path.join(audioDir, file)),
  });

  return { plan, manifest: usable, problem };
}

interface Take {
  pcm: Buffer;
  durationMs: number;
  sampleRate: number;
  channels: number;
}

/**
 * One take, retried. The plausibility check lives INSIDE the retry so a take
 * that came back wrong is simply taken again — the model is nondeterministic,
 * and a second reading usually fixes what a first one mangled.
 */
async function synthesise(
  beat: Beat,
  lesson: Lesson,
  deps: RenderDeps,
  opts: RenderOptions,
): Promise<Take> {
  const prompt = buildSpeechPrompt(beat.narration, {
    lessonTitle: lesson.title,
    beatTopic: beat.topic,
  });

  return retry(
    async () => {
      const audio = await deps.tts.synthesize({ prompt, voice: opts.voice, model: opts.model });
      const format = parsePcmFormat(audio.mimeType);
      const pcm = Buffer.from(audio.base64, 'base64');
      const durationMs = pcmDurationMs(pcm.length, format);

      const check = checkTake(beat.narration, durationMs);
      if (!check.ok) throw new TransientTtsError(`implausible take — ${check.reason}`);

      return { pcm, durationMs, sampleRate: format.sampleRate, channels: format.channels };
    },
    {
      ...opts.retry,
      onRetry: ({ attempt, delayMs, error }) => {
        opts.onEvent?.({
          kind: 'retry',
          beatId: beat.id,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        opts.retry?.onRetry?.({ attempt, delayMs, error });
      },
    },
  );
}

type Outcome =
  | { kind: 'rendered'; beat: RenderedBeat }
  | { kind: 'failed'; beatId: string; error: string; quota: boolean }
  | { kind: 'notAttempted'; beatId: string };

/** Fixed-width lanes over a queue. Results stay in beat order for a readable log. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

export async function renderLesson(
  lesson: Lesson,
  lessonDir: string,
  deps: RenderDeps,
  opts: RenderOptions,
): Promise<RenderReport> {
  const { plan, manifest: existing } = planForLesson(lesson, lessonDir, opts);
  const audioDir = manifestDir(lessonDir);

  const toRender = new Set(plan.render.map((p) => p.beatId));
  const queue = lesson.beats.filter((beat) => toRender.has(beat.id));

  // Every existing entry was rendered in the manifest's voice from its model. If
  // either has changed, those entries describe takes this run is replacing, so
  // they start empty: a beat that then fails to re-render must show up as having
  // no recording rather than as a Sulafat file labelled Achird.
  const reusable =
    existing !== null && existing.voice === opts.voice && existing.model === opts.model;
  const manifest: NarrationManifest = reusable
    ? { ...existing, beats: { ...existing.beats } }
    : emptyManifest(lesson.id, opts.voice, opts.model);

  let manifestWritten = false;
  const commit = (): void => {
    writeManifest(lessonDir, orderBeats(manifest, lesson.beats.map((b) => b.id)));
    manifestWritten = true;
  };

  // Daily quota is the one failure that will not clear inside a run: every later
  // beat would fail the same way, so the run stops and says so rather than
  // printing the same 429 ten more times.
  let quotaExhausted = false;

  const outcomes = await pool(queue, opts.concurrency ?? DEFAULT_CONCURRENCY, async (beat): Promise<Outcome> => {
    if (quotaExhausted) return { kind: 'notAttempted', beatId: beat.id };

    try {
      const take = await synthesise(beat, lesson, deps, opts);
      const file = audioFileName(beat.id);
      const bytes = await deps.encoder.encode({
        pcm: take.pcm,
        format: { sampleRate: take.sampleRate, channels: take.channels, bitsPerSample: 16 },
        outFile: path.join(audioDir, file),
      });

      // Duration comes from the PCM, not the encoded file: it is exact, it needs
      // no second process to read it back, and the player schedules against it.
      manifest.beats[beat.id] = { file, durationMs: take.durationMs, hash: hashNarration(beat.narration) };
      // Written per beat, so a run interrupted at beat eight does not re-buy the
      // seven that already worked.
      commit();

      const rendered: RenderedBeat = { beatId: beat.id, file, durationMs: take.durationMs, bytes };
      opts.onEvent?.({ kind: 'rendered', beatId: beat.id, durationMs: take.durationMs, bytes });
      return { kind: 'rendered', beat: rendered };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const quota = isQuotaExhausted(e);
      if (quota) quotaExhausted = true;
      opts.onEvent?.({ kind: 'failed', beatId: beat.id, error });
      return { kind: 'failed', beatId: beat.id, error, quota };
    }
  });

  const rendered = outcomes.flatMap((o) => (o.kind === 'rendered' ? [o.beat] : []));
  const failed = outcomes.flatMap((o) =>
    o.kind === 'failed' ? [{ beatId: o.beatId, error: o.error }] : [],
  );
  const notAttempted = outcomes.flatMap((o) => (o.kind === 'notAttempted' ? [o.beatId] : []));

  // Entries for beats the lesson no longer has are dead weight in the index; the
  // orphaned .m4a stays on disk for the author to delete deliberately.
  for (const beatId of plan.stale) delete manifest.beats[beatId];
  if (plan.stale.length > 0) commit();

  let totalDurationMs = 0;
  let totalBytes = 0;
  for (const beat of lesson.beats) {
    const entry = manifest.beats[beat.id];
    if (!entry) continue;
    totalDurationMs += entry.durationMs;
    const file = path.join(audioDir, entry.file);
    if (fs.existsSync(file)) totalBytes += fs.statSync(file).size;
  }

  return {
    rendered,
    skipped: plan.skip,
    failed,
    notAttempted,
    pruned: plan.stale,
    plan,
    manifest: orderBeats(manifest, lesson.beats.map((b) => b.id)),
    manifestWritten,
    totalDurationMs,
    totalBytes,
    renderedDurationMs: rendered.reduce((sum, r) => sum + r.durationMs, 0),
  };
}
