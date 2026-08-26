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
import { loadGraph } from '../../../packages/knowledge-graph/src/graph.ts';
import type { LearningNode } from '../../../packages/knowledge-graph/src/types.ts';
import { planBeats } from '../../../packages/pedagogy/src/plan.ts';
import { outcomesForTopic } from './select.ts';
import { createAdapterFromEnv, loadEnvFiles } from './llm.ts';
import { designLesson } from './design.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../../packages/syllabus/data');
const graphDir = path.resolve(here, '../../../packages/knowledge-graph/data');

/**
 * The outcomes this lesson has to deliver, read off the Learning Outcome Map.
 *
 * Backward design needs a destination, and the map is the only place one
 * exists. Chapter granularity, because a node names its chapter and not the
 * topic within it — a lesson for one topic is planned against its chapter's
 * outcomes, and the designer is told which of them this topic covers.
 *
 * No map for this class yet is a normal state: the caller falls back to the
 * old topic-only prompt rather than refusing to design anything.
 */
function outcomesForChapter(syllabusId: string, chapterId: string): LearningNode[] {
  const file = path.join(graphDir, `${syllabusId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const graph = loadGraph(JSON.parse(fs.readFileSync(file, 'utf8')));
    return graph.nodes.filter((node) => node.chapter === chapterId);
  } catch (err) {
    console.error(`  ! ${path.basename(file)} did not load: ${(err as Error).message}`);
    return [];
  }
}

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

  const [, chapterId] = args.topic.split('/');
  // A chapter holds ~50 outcomes; one lesson carries about seven of them.
  const nodes = outcomesForTopic(topic, outcomesForChapter(syllabus.id, chapterId));
  // Only outcomes inside this lesson constrain its order; the rest of the
  // chapter is somebody else's lesson.
  const inLesson = new Set(nodes.map((n) => n.id));
  const prerequisites = new Map<string, readonly string[]>(
    nodes.map((n) => [n.id, n.prerequisites.filter((p) => inLesson.has(p))]),
  );

  let blueprint;
  if (nodes.length > 0) {
    const beats = planBeats(
      nodes.map((n) => ({
        id: n.id,
        difficulty: n.difficulty,
        prerequisites: prerequisites.get(n.id) ?? [],
      })),
      { idPrefix: 'b' },
    );
    blueprint = { beats, outcomes: new Map(nodes.map((n) => [n.id, n.outcome])) };
    console.log(
      `Designing "${topic.title}" (${args.topic}) — ${nodes.length} outcomes, ${beats.length} beats planned.`,
    );
  } else {
    console.log(`Designing "${topic.title}" (${args.topic}) — no outcome map for this chapter yet.`);
  }

  const result = await designLesson(topic, adapter, {
    klass: syllabus.klass,
    topicPath: args.topic,
    blueprint,
    prerequisites,
  });

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
