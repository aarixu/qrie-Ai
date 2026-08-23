import fs from 'node:fs';
import path from 'node:path';
import { validateLesson } from '../../../packages/lesson-format/src/validate.ts';
import { costForDurationMs, formatBytes, formatDuration, formatUsd } from './cost.ts';
import { createFfmpegEncoder, FFMPEG_INSTALL_HINT, hasFfmpeg } from './encode.ts';
import { isSafeBeatId, MANIFEST_FILE } from './manifest.ts';
import {
  createGeminiTts,
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  isKnownVoice,
  VOICES,
  type TtsTransport,
} from './tts.ts';
import { DEFAULT_CONCURRENCY, planForLesson, renderLesson } from './render.ts';

/**
 * CLI. Thin on purpose — everything worth testing lives beside it.
 *
 *   node tools/record-class/src/cli.ts --lesson content/class10-blood
 */

function usage(message: string): never {
  console.error(`${message}

Usage:
  node tools/record-class/src/cli.ts --lesson <dir> [options]

  --lesson <dir>        lesson folder, e.g. content/class10-blood
  --force               re-render every beat, even unchanged ones
  --dry-run             print the plan and the cost; make no network call
  --voice <name>        prebuilt voice (default "${DEFAULT_VOICE}")
  --model <id>          TTS model (default "${DEFAULT_MODEL}")
  --concurrency <n>     beats in flight (default ${DEFAULT_CONCURRENCY})

Env:
  GEMINI_API_KEY | GOOGLE_API_KEY   required unless everything is up to date

Output lands in <dir>/audio/ and is committed with the lesson.`);
  process.exit(2);
}

function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_CONCURRENCY;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 8) usage('--concurrency must be a whole number, 1 to 8.');
  return n;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const lessonDirArg = flag('--lesson');
  if (!lessonDirArg) usage('Missing --lesson.');

  const lessonDir = path.resolve(process.cwd(), lessonDirArg);
  const lessonFile = path.join(lessonDir, 'lesson.json');
  if (!fs.existsSync(lessonFile)) usage(`No lesson.json in ${lessonDirArg}`);

  // Validate BEFORE anything can be spent: a lesson that does not validate is
  // never rendered, and rendering a broken one wastes quota and hides the real
  // problem.
  const result = validateLesson(JSON.parse(fs.readFileSync(lessonFile, 'utf8')));
  if (!result.ok) {
    console.error(`${lessonDirArg}/lesson.json is invalid:`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const lesson = result.lesson;

  // A beat id becomes a file name. Finding that out after paying for ten takes
  // would be a poor trade.
  const unsafe = lesson.beats.map((b) => b.id).filter((id) => !isSafeBeatId(id));
  if (unsafe.length > 0) {
    console.error(`Beat ids must be usable as file names: ${unsafe.join(', ')}`);
    console.error('  Allowed: letters, digits, dot, dash, underscore.');
    process.exit(1);
  }

  const voice = flag('--voice') ?? DEFAULT_VOICE;
  if (!isKnownVoice(voice)) {
    console.error(`Unknown voice "${voice}". Google publishes 30:`);
    console.error(`  ${VOICES.join(', ')}`);
    console.error(`\n  "${DEFAULT_VOICE}" is the warm one, and the one the live agent uses.`);
    process.exit(1);
  }

  const model = flag('--model') ?? DEFAULT_MODEL;
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');
  const concurrency = parseConcurrency(flag('--concurrency'));

  const { plan, problem } = planForLesson(lesson, lessonDir, { voice, model, force });
  if (problem) console.warn(`  ! ${problem} — every beat will be re-rendered.`);

  console.log(`\n${lesson.title} (${lesson.id}) — ${lesson.beats.length} beats, voice ${voice}`);
  for (const r of plan.render) {
    console.log(`  ↻ ${r.beatId.padEnd(18)} ${r.reason.padEnd(18)} ~${formatDuration(r.estimatedMs)}`);
  }
  for (const s of plan.skip) {
    console.log(`  · ${s.beatId.padEnd(18)} ${'unchanged'.padEnd(18)} ${formatDuration(s.durationMs)}`);
  }
  for (const beatId of plan.stale) console.log(`  ✗ ${beatId.padEnd(18)} no longer in the lesson`);

  const plannedMs = plan.render.reduce((sum, r) => sum + r.estimatedMs, 0);

  if (dryRun) {
    console.log(
      `\nWould render ${plan.render.length}, skip ${plan.skip.length}.` +
        ` About ${formatDuration(plannedMs)} of new audio, roughly ${formatUsd(costForDurationMs(plannedMs))}.`,
    );
    console.log('Nothing rendered and nothing called (--dry-run).');
    return;
  }

  const nothingToRender = plan.render.length === 0;

  // ffmpeg and the API key are only demanded when there is something to render,
  // so re-running an up-to-date lesson stays instant and free.
  if (!nothingToRender && !(await hasFfmpeg())) {
    console.error('\nffmpeg is not on PATH, and the takes cannot be encoded without it.');
    console.error(`  Install it with:  ${FFMPEG_INSTALL_HINT}`);
    process.exit(1);
  }

  const idle: TtsTransport = {
    synthesize: () => Promise.reject(new Error('nothing to render')),
  };
  const tts = nothingToRender ? idle : createGeminiTts();

  const report = await renderLesson(
    lesson,
    lessonDir,
    { tts, encoder: createFfmpegEncoder() },
    {
      voice,
      model,
      force,
      concurrency,
      onEvent: (event) => {
        if (event.kind === 'rendered') {
          console.log(
            `  ✓ ${event.beatId.padEnd(18)} ${formatDuration(event.durationMs).padEnd(8)} ${formatBytes(event.bytes)}`,
          );
        } else if (event.kind === 'retry') {
          console.warn(`  ↻ ${event.beatId}: ${event.error} — retrying in ${event.delayMs}ms`);
        } else {
          console.error(`  ✗ ${event.beatId}: ${event.error}`);
        }
      },
    },
  );

  console.log(
    `\n${report.rendered.length} rendered, ${report.skipped.length} unchanged, ${report.failed.length} failed.`,
  );
  console.log(
    `Class now runs ${formatDuration(report.totalDurationMs)} across ${formatBytes(report.totalBytes)}.`,
  );
  console.log(
    `This run: ${formatDuration(report.renderedDurationMs)} of new audio, about ${formatUsd(costForDurationMs(report.renderedDurationMs))}.`,
  );
  if (report.pruned.length > 0) {
    console.log(`Dropped ${report.pruned.length} entry(s) for beats the lesson no longer has.`);
  }
  if (report.notAttempted.length > 0) {
    console.error(`\nStopped early — not attempted: ${report.notAttempted.join(', ')}.`);
    console.error('  Re-run the same command after the quota resets; finished beats are kept.');
  }
  if (report.manifestWritten) {
    console.log(`Wrote ${path.join(lessonDirArg, 'audio', MANIFEST_FILE)}`);
  }
  if (report.failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
