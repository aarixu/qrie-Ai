import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Lesson } from '../../../packages/lesson-format/src/types.ts';
import {
  audioFileName,
  hashNarration,
  parseManifest,
} from '../../../packages/voice/src/index.ts';
import type { AudioEncoder } from '../src/encode.ts';
import { renderLesson, type RenderEvent } from '../src/render.ts';
import { TransientTtsError, type SpeechAudio, type TtsTransport } from '../src/tts.ts';

/**
 * Rendering, with the two things that cost money faked out: the model and
 * ffmpeg. No network, no clock, no binary — the retry sleep is injected, so a
 * run that backs off twice still finishes in microseconds.
 */

const VOICE = 'Sulafat';
const MODEL = 'gemini-3.1-flash-tts-preview';
const OPTS = { voice: VOICE, model: MODEL, concurrency: 1, retry: { baseDelayMs: 0, sleep: () => Promise.resolve() } };

const HOOK = 'Blood is a tissue, not a fluid, and it does four separate jobs at once.';
const RECAP = 'So: plasma carries, red cells breathe, white cells defend, platelets seal.';

const lesson = (narrations: Record<string, string>): Lesson => ({
  formatVersion: 1,
  id: 'test-lesson',
  title: 'Blood & Its Components',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'title', id: 't', x: 500, y: 80, text: 'Blood' }],
  beats: Object.entries(narrations).map(([id, narration]) => ({
    id,
    topic: `About ${id}`,
    narration,
    show: ['t'],
  })),
});

const SAMPLE_RATE = 24_000;

/** Silent 16-bit mono PCM of an exact length, the way the model returns it. */
const take = (durationMs: number): SpeechAudio => ({
  base64: Buffer.alloc((durationMs / 1000) * SAMPLE_RATE * 2).toString('base64'),
  mimeType: `audio/l16; rate=${SAMPLE_RATE}; channels=1`,
});

/** Answers the scripted list in order, then repeats its last answer forever. */
const transport = (script: (() => SpeechAudio)[]): TtsTransport & { calls: number } => {
  const state = {
    calls: 0,
    synthesize(): Promise<SpeechAudio> {
      const step = script[Math.min(state.calls, script.length - 1)];
      state.calls += 1;
      try {
        return Promise.resolve(step());
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
  return state;
};

const rateLimited = (): SpeechAudio => {
  throw new TransientTtsError('TTS API 429: rate limit exceeded');
};

const encoder = (): AudioEncoder => ({
  encode(request) {
    fs.mkdirSync(path.dirname(request.outFile), { recursive: true });
    fs.writeFileSync(request.outFile, request.pcm);
    return Promise.resolve(request.pcm.length);
  },
});

const dirs: string[] = [];
const tmpDir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'record-class-'));
  dirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const readManifestFile = (dir: string): string =>
  fs.readFileSync(path.join(dir, 'audio', 'narration.json'), 'utf8');

describe('renderLesson', () => {
  it('renders a beat once after two transient failures', async () => {
    const dir = tmpDir();
    const tts = transport([rateLimited, rateLimited, () => take(5_000)]);

    const report = await renderLesson(lesson({ hook: HOOK }), dir, { tts, encoder: encoder() }, OPTS);

    expect(tts.calls).toBe(3);
    expect(report.failed).toEqual([]);
    expect(report.rendered).toEqual([
      { beatId: 'hook', file: 'hook.m4a', durationMs: 5_000, bytes: 5 * SAMPLE_RATE * 2 },
    ]);
    expect(fs.existsSync(path.join(dir, 'audio', 'hook.m4a'))).toBe(true);
  });

  it('takes a beat again when the take that came back is not plausible', async () => {
    const dir = tmpDir();
    // 300 ms for a thirteen-word line is the truncated take Google returns with
    // a 200, and it must be caught before it is written rather than after.
    const tts = transport([() => take(300), () => take(5_000)]);
    const events: RenderEvent[] = [];

    const report = await renderLesson(
      lesson({ hook: HOOK }),
      dir,
      { tts, encoder: encoder() },
      { ...OPTS, onEvent: (e) => events.push(e) },
    );

    expect(tts.calls).toBe(2);
    expect(report.rendered).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'retry')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'retry')?.error).toContain('implausible take');
  });

  it('leaves the committed manifest untouched when nothing renders', async () => {
    const dir = tmpDir();
    const first = await renderLesson(
      lesson({ hook: HOOK, recap: RECAP }),
      dir,
      { tts: transport([() => take(5_000)]), encoder: encoder() },
      OPTS,
    );
    expect(first.rendered).toHaveLength(2);

    const before = readManifestFile(dir);

    // One sentence rewritten, and every take of it fails. The half-truth to
    // avoid is a manifest that drops the beat, or keeps it with the new hash.
    const edited = lesson({ hook: HOOK, recap: `${RECAP} That is the whole of it.` });
    const second = await renderLesson(
      edited,
      dir,
      { tts: transport([rateLimited]), encoder: encoder() },
      OPTS,
    );

    expect(second.rendered).toEqual([]);
    expect(second.failed.map((f) => f.beatId)).toEqual(['recap']);
    expect(second.manifestWritten).toBe(false);
    expect(readManifestFile(dir)).toBe(before);

    // The manifest still vouches for the words that were actually recorded, so
    // the player falls through to live synthesis for the edited beat instead of
    // speaking a line the lesson no longer says.
    const kept = parseManifest(JSON.parse(before));
    expect(kept?.beats.recap?.hash).toBe(hashNarration(RECAP));
  });

  it('writes no manifest at all when a first run fails outright', async () => {
    const dir = tmpDir();

    const report = await renderLesson(
      lesson({ hook: HOOK }),
      dir,
      { tts: transport([rateLimited]), encoder: encoder() },
      OPTS,
    );

    expect(report.failed).toHaveLength(1);
    expect(report.manifestWritten).toBe(false);
    // No index means no recording, which is the truth. An empty one would tell
    // the app a class had been recorded and every beat of it was missing.
    expect(fs.existsSync(path.join(dir, 'audio', 'narration.json'))).toBe(false);
  });

  it('writes a manifest @ai-tutor/voice accepts, in lesson order', async () => {
    const dir = tmpDir();
    const source = lesson({ hook: HOOK, recap: RECAP });

    const report = await renderLesson(
      source,
      dir,
      { tts: transport([() => take(6_000)]), encoder: encoder() },
      OPTS,
    );
    expect(report.manifestWritten).toBe(true);

    const parsed = parseManifest(JSON.parse(readManifestFile(dir)));
    expect(parsed).toEqual({
      formatVersion: 1,
      lessonId: 'test-lesson',
      voice: VOICE,
      model: MODEL,
      beats: {
        hook: { file: audioFileName('hook'), durationMs: 6_000, hash: hashNarration(HOOK) },
        recap: { file: audioFileName('recap'), durationMs: 6_000, hash: hashNarration(RECAP) },
      },
    });
    expect(Object.keys(parsed?.beats ?? {})).toEqual(['hook', 'recap']);
  });
});
