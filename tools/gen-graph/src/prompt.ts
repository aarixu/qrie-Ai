import type { LearningNode } from '../../../packages/knowledge-graph/src/types.ts';
import type { Chapter } from '../../../packages/syllabus/src/syllabus.ts';

/**
 * The prompts are where "nanoscale" actually gets enforced.
 *
 * A map is only worth having if its nodes are small enough to be *the* thing a
 * student is missing. "Understand photosynthesis" is useless: it cannot be
 * tested, and knowing a student lacks it tells you nothing about what to teach.
 * "Identify which side of the equation oxygen appears on" can be tested in one
 * question and fixed in one lesson beat. Every rule below serves that.
 */

export interface NodesPromptOptions {
  syllabusId: string;
  klass: number;
  subject: string;
  /**
   * Ids already in the map for this class and subject. Generated prerequisites
   * may point at these, which is what stops each batch becoming an island.
   */
  existingIds: string[];
  /** Roughly how many nodes to produce for this chapter. */
  targetCount: number;
}

const ATOMICITY = `WHAT A GOOD NODE IS — this is the whole job, read it twice.

A node is ONE outcome, small enough that a single lesson beat could fix it and a
single question could test it. Nodes are NOT chapters, NOT lessons, NOT topics.

Each "outcome" must start with an OBSERVABLE verb — something you could watch a
student do: state, name, identify, list, order, classify, calculate, balance,
trace, explain, compare, predict, derive, apply.

BAD (never emit these):
  "Understand photosynthesis"            - not atomic, not observable
  "Learn about the heart"                - not observable, not testable
  "Know the digestive system"            - a whole chapter wearing a node costume
  "Master chemical equations"            - vague, unbounded

GOOD (this is the size you are aiming for):
  "Name carbon dioxide, water and sunlight as the inputs of photosynthesis"
  "Identify that oxygen appears on the product side of the photosynthesis equation"
  "Balance a simple chemical equation by adjusting coefficients only"
  "Trace blood from the right ventricle to the lungs and back to the left atrium"
  "Explain the thicker left ventricle wall by the higher pressure needed"

Notice the good ones split a single textbook paragraph into several nodes. That
is correct. Err on the side of splitting: two nodes that are too small cost
nothing, one node that is too big makes the whole map useless.`;

const EDGES = `PREREQUISITE EDGES

"prerequisites" lists the node ids a student must already hold before this one
is reachable. Rules:
- Point at ids in THIS batch, or at ids from the existing map listed below.
- The graph must stay ACYCLIC. If A lists B, then B must not reach A.
- Prefer few, real edges. An edge means "genuinely cannot do this without that",
  not "these are related" and not "this comes later in the textbook".
- CROSS-CHAPTER edges are valuable and expected: writing the photosynthesis
  equation depends on being able to balance an equation, which lives in
  chemistry, not biology. Those edges are what make a diagnostic able to find
  the real cause of a gap instead of its symptom.`;

const FIELDS = `EACH NODE IS EXACTLY THIS SHAPE:
{
  "id": "<syllabusPrefix>-<chapter>-<short-slug>",   lowercase, hyphenated, unique
  "klass": <number>,
  "subject": "<subject>",
  "chapter": "<chapterId>",
  "title": "<a short human label, 2-6 words>",
  "outcome": "<the observable outcome sentence>",
  "prerequisites": ["<id>", ...],
  "difficulty": <1..5>,
  "lessonRef": "<optional lesson id that teaches this>"
}

difficulty: 1 recall, 2 straightforward application, 3 multi-step,
4 synthesis across ideas, 5 the hardest thing in the chapter.`;

export function buildNodesPrompt(
  chapter: Chapter,
  opts: NodesPromptOptions,
): { system: string; user: string } {
  const system = [
    'You are a curriculum architect building a Learning Outcome Map for Indian school students (NCERT/CBSE). The map is a directed acyclic graph of atomic learning outcomes joined by prerequisite edges, and it is used to diagnose exactly where a student stopped understanding.',
    ATOMICITY,
    EDGES,
    FIELDS,
    `AUDIENCE: Class ${opts.klass} ${opts.subject}. Use the vocabulary an NCERT textbook for this class would use — correct technical terms, no university-level framing.`,
    'Reply with ONLY a JSON object of the form {"nodes": [ ... ]}. No markdown fences, no commentary.',
  ].join('\n\n');

  const lines = [
    `Decompose this chapter into roughly ${opts.targetCount} atomic learning outcome nodes.`,
    '',
    `CHAPTER: ${chapter.title}  (id: "${chapter.id}")`,
    'ITS TOPICS, each of which should yield SEVERAL nodes:',
  ];

  for (const topic of chapter.topics) {
    lines.push(`\n- ${topic.title} (id: "${topic.id}")`);
    for (const objective of topic.objectives) lines.push(`    objective: ${objective}`);
  }

  if (opts.existingIds.length > 0) {
    lines.push(
      '',
      'NODES ALREADY IN THE MAP for this class and subject. Reuse these ids in',
      '"prerequisites" wherever this chapter genuinely builds on them, and do NOT',
      're-create them:',
      ...opts.existingIds.map((id) => `  ${id}`),
    );
  }

  lines.push(
    '',
    `Use "${opts.syllabusId}" as the id prefix, klass ${opts.klass}, subject "${opts.subject}", chapter "${chapter.id}".`,
  );

  return { system, user: lines.join('\n') };
}

export interface ProbesPromptOptions {
  klass: number;
  subject: string;
}

const MISCONCEPTIONS = `THE WRONG OPTIONS ARE THE POINT

Three wrong options per question, and each must be a mistake a real student
actually makes. A distractor nobody would pick teaches you nothing when it is
not picked, and wastes the question.

For each wrong option, name the misconception it encodes in "misconceptions",
aligned to "options" BY INDEX, with an empty string at the correct index. That
naming is what lets the tutor say WHY a student is stuck rather than just THAT
they are.

Example for "Which chamber pumps blood to the whole body?":
  options:        ["Left ventricle", "Right ventricle", "Left atrium", "Right atrium"]
  correctIndex:   0
  misconceptions: ["", "confuses the pulmonary circuit with the systemic circuit",
                   "thinks atria pump rather than receive",
                   "confuses side and chamber type together"]

BANNED: "all of the above", "none of the above", options that are obviously
silly, options that differ only by a typo, and options longer than the correct
answer (students learn to pick the longest).`;

export function buildProbesPrompt(
  nodes: LearningNode[],
  opts: ProbesPromptOptions,
): { system: string; user: string } {
  const system = [
    'You write diagnostic questions for a Learning Outcome Map. Each question tests ONE node and nothing else — if a student could fail your question while holding the node, the question is wrong.',
    MISCONCEPTIONS,
    `EACH PROBE IS EXACTLY THIS SHAPE:
{
  "id": "probe-<nodeId>",
  "nodeId": "<the node it tests>",
  "question": "<one clear question>",
  "options": ["<a>", "<b>", "<c>", "<d>"],          exactly 4, all distinct
  "correctIndex": <0..3>,
  "misconceptions": ["", "<why b is tempting>", "<why c>", "<why d>"]
}`,
    `AUDIENCE: Class ${opts.klass} ${opts.subject}. Question and options must read at that level — plain sentences, no trick phrasing, no double negatives.`,
    'Vary the position of the correct answer across questions.',
    'Reply with ONLY a JSON object of the form {"probes": [ ... ]}. No markdown fences, no commentary.',
  ].join('\n\n');

  const lines = ['Write exactly one question for each node below.', ''];
  for (const node of nodes) {
    lines.push(`- id "${node.id}" (difficulty ${node.difficulty})`);
    lines.push(`  outcome: ${node.outcome}`);
  }

  return { system, user: lines.join('\n') };
}
