import fs from 'node:fs';
import path from 'node:path';
import { validateLesson } from '../../../packages/lesson-format/src/validate.ts';
import { createNanoBanana } from './imageModel.ts';
import { generateForLesson } from './generate.ts';

/**
 * CLI. Thin on purpose — everything worth testing lives in generate.ts.
 *
 *   node tools/gen-images/src/cli.ts --lesson content/class10-respiration [--force] [--dry-run]
 */

function usage(message: string): never {
  console.error(`${message}

Usage:
  node tools/gen-images/src/cli.ts --lesson <dir> [--force] [--dry-run]

  --lesson    lesson folder, e.g. content/class10-respiration
  --force     regenerate images that already exist
  --dry-run   print the prompts and generate nothing

Env:
  GEMINI_API_KEY | GOOGLE_API_KEY   required (unless --dry-run)
  IMAGE_MODEL                       default "gemini-3.1-flash-image"`);
  process.exit(2);
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

  // Validate BEFORE touching the network: generating art for a broken lesson
  // wastes quota and hides the real problem.
  const result = validateLesson(JSON.parse(fs.readFileSync(lessonFile, 'utf8')));
  if (!result.ok) {
    console.error(`${lessonDirArg}/lesson.json is invalid:`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const dryRun = argv.includes('--dry-run');
  const report = await generateForLesson(
    result.lesson,
    // A dry run never calls the model, so it must not demand a key either.
    dryRun ? { generate: async () => ({ base64: '', mimeType: 'image/png' }) } : createNanoBanana(),
    lessonDir,
    { force: argv.includes('--force'), dryRun },
  );

  if (dryRun) {
    for (const { elementId, prompt } of report.prompts) {
      console.log(`\n─── ${elementId} ───\n${prompt}`);
    }
    console.log(`\n${report.prompts.length} image element(s). Nothing generated (--dry-run).`);
    return;
  }

  for (const g of report.generated) {
    console.log(`  ✓ ${g.elementId} → ${g.file} (${Math.round(g.bytes / 1024)} KB)`);
  }
  for (const s of report.skipped) console.log(`  · ${s.elementId} skipped (${s.reason})`);
  for (const f of report.failed) console.error(`  ✗ ${f.elementId}: ${f.error}`);

  console.log(
    `\n${report.generated.length} generated, ${report.skipped.length} skipped, ${report.failed.length} failed.`,
  );
  if (report.failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
