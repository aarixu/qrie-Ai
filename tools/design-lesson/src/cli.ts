/**
 * Thin CLI over design.ts — argument parsing, data loading, file writing.
 * No lesson logic lives here.
 *
 *   node tools/design-lesson/src/cli.ts --topic <syllabusId/chapterId/topicId> --out <dir>
 *
 * Exit codes: 0 = lesson written, 1 = design or setup failure, 2 = bad usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
// Leaf module, not the package index — see the note in prompt.ts.
import { getTopic, listTopics, loadSyllabus } from '../../../packages/syllabus/src/syllabus.ts';
import type { SubjectSyllabus } from '../../../packages/syllabus/src/syllabus.ts';
import { createAdapterFromEnv, loadEnvFiles } from './llm.ts';
import { designLesson } from './design.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../../packages/syllabus/data');

function parseArgs(argv: string[]): { topic: string; out: string } | null {
  let topic: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--topic') topic = argv[i + 1];
    else if (argv[i] === '--out') out = argv[i + 1];
  }
  return topic && out ? { topic, out } : null;
}

function loadAllSyllabi(): SubjectSyllabus[] {
  return fs
    .readdirSync(dataDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      try {
        return loadSyllabus(JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')));
      } catch (err) {
        throw new Error(`${file}: ${(err as Error).message}`);
      }
    });
}

async function main(): Promise<number> {
  // Keys come from .env.local at the repo root; real env vars still win.
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('Usage: node tools/design-lesson/src/cli.ts --topic <syllabusId/chapterId/topicId> --out <dir>');
    return 2;
  }

  let syllabi: SubjectSyllabus[];
  try {
    syllabi = loadAllSyllabi();
  } catch (err) {
    console.error(`Could not load syllabus data: ${(err as Error).message}`);
    return 1;
  }

  const syllabusId = args.topic.split('/')[0];
  const syllabus = syllabi.find((s) => s.id === syllabusId);
  if (!syllabus) {
    console.error(`No syllabus "${syllabusId}". Available: ${syllabi.map((s) => s.id).join(', ')}`);
    return 1;
  }

  const topic = getTopic(syllabus, args.topic);
  if (!topic) {
    console.error(`No topic at "${args.topic}". Topics in ${syllabus.id}:`);
    for (const entry of listTopics(syllabus)) console.error(`  ${entry.path}`);
    return 1;
  }

  let adapter;
  try {
    adapter = createAdapterFromEnv();
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  console.log(`Designing "${topic.title}" (${args.topic})...`);
  const result = await designLesson(topic, adapter, { klass: syllabus.klass, topicPath: args.topic });

  fs.mkdirSync(args.out, { recursive: true });
  if (!result.ok) {
    // Never write a failing draft to lesson.json — a human looks at it first.
    const rejectedPath = path.join(args.out, 'lesson.rejected.json');
    fs.writeFileSync(rejectedPath, `${JSON.stringify({ errors: result.errors, raw: result.raw }, null, 2)}\n`);
    console.error(`Lesson still failed validation after one repair retry — wrote ${rejectedPath}`);
    for (const error of result.errors) console.error(`  - ${error}`);
    return 1;
  }

  const lessonPath = path.join(args.out, 'lesson.json');
  const assetsPath = path.join(args.out, 'assets-spec.json');
  fs.writeFileSync(lessonPath, `${JSON.stringify(result.lesson, null, 2)}\n`);
  fs.writeFileSync(assetsPath, `${JSON.stringify(result.assetsSpec, null, 2)}\n`);
  console.log(`Wrote ${lessonPath} (${result.lesson.beats.length} beats)`);
  console.log(`Wrote ${assetsPath} (${result.assetsSpec.length} asset${result.assetsSpec.length === 1 ? '' : 's'} to generate)`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
