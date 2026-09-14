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
   * Ids already in the map for this class and subject. A generated node may
   * not re-use one of these, and generated prerequisites may point at them,
   * which is what stops each batch becoming an island.
   */
  existingIds: string[];
  /**
   * The nodes the model is allowed to point an edge AT, with their outcomes.
   * Defaults to every id in `existingIds`, with no outcome text.
   *
   * The topic-gap pass narrows this to the chapter's own nodes, and the reason
   * is measured: an earlier whole-chapter run hung new chapters off chapter
   * ROOTS, and the descendant closures that produced are absurd —
   * class11-biology's "define-taxon" blocks 337 of 462 nodes, class9-science's
   * "define-motion-relative-to-reference" blocks 279 of 725. One wrong answer
   * about taxonomy then lowers belief across the whole of biology. Nodes added
   * to a chapter that is already populated do not need to reach outside it, so
   * they are not offered the chance.
   */
  linkable?: readonly Pick<LearningNode, 'id' | 'outcome'>[];
  /**
   * Decompose ONLY these topics of the chapter, leaving the rest alone. Used
   * to fill topics that hold no outcomes inside a chapter that already does —
   * the gap the chapter-at-a-time generator cannot see, because it skips any
   * chapter that has nodes.
   */
  onlyTopicIds?: readonly string[];
  /** Roughly how many nodes to produce for this chapter (or, scoped, per topic). */
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

/**
 * The edge rule for a chapter that is ALREADY populated.
 *
 * A separate block rather than a clause on EDGES, because it says the opposite
 * thing and the two must never appear in one prompt: EDGES exists to talk a
 * from-scratch chapter into reaching across the subject, and this exists to
 * stop a handful of new nodes hanging themselves off whatever node in the
 * chapter looked most foundational. Measured on the committed maps: one
 * class11-biology node blocks 337 of 462, one class9-science node blocks 279
 * of 725. At that fan-out a single wrong answer condemns a whole subject.
 */
const EDGES_IN_CHAPTER = `PREREQUISITE EDGES

"prerequisites" lists the node ids a student must already hold before this one
is reachable. Rules:
- Point at ids in THIS batch, or at ids from the chapter listed below. Those are
  the only ids that exist for you; anything else is rejected.
- The graph must stay ACYCLIC. If A lists B, then B must not reach A.
- Prefer few, real edges. An edge means "genuinely cannot do this without that",
  not "these are related" and not "this comes later in the textbook".
- Most of these nodes should have ONE prerequisite or none. You are filling gaps
  in a chapter somebody already wrote, and an edge into a node the rest of the
  chapter already depends on makes one wrong answer condemn the chapter.`;

const FIELDS = `EACH NODE IS EXACTLY THIS SHAPE:
{
  "id": "<syllabusPrefix>-<chapter>-<short-slug>",   lowercase, hyphenated, unique
  "klass": <number>,
  "subject": "<subject>",
  "chapter": "<chapterId>",
  "title": "<a short human label, 2-6 words>",
  "outcome": "<the observable outcome sentence>",
  "prerequisites": ["<id>", ...],
  "difficulty": <1..5>
}

difficulty: 1 recall, 2 straightforward application, 3 multi-step,
4 synthesis across ideas, 5 the hardest thing in the chapter.

Do NOT emit any other field. In particular do not name a lesson or a topic:
you cannot know what has been recorded, and a reference you invent becomes a
Start button that lands on "this lesson does not exist". Filing nodes under
topics is a separate pass that is shown the syllabus and validated against it.`;

export function buildNodesPrompt(
  chapter: Chapter,
  opts: NodesPromptOptions,
): { system: string; user: string } {
  const wanted = new Set(opts.onlyTopicIds ?? []);
  const scoped = wanted.size > 0;
  const todo = scoped ? chapter.topics.filter((t) => wanted.has(t.id)) : chapter.topics;
  const linkable = opts.linkable ?? opts.existingIds.map((id) => ({ id, outcome: '' }));

  const system = [
    'You are a curriculum architect building a Learning Outcome Map for Indian school students (NCERT/CBSE). The map is a directed acyclic graph of atomic learning outcomes joined by prerequisite edges, and it is used to diagnose exactly where a student stopped understanding.',
    ATOMICITY,
    scoped ? EDGES_IN_CHAPTER : EDGES,
    FIELDS,
    `AUDIENCE: Class ${opts.klass} ${opts.subject}. Use the vocabulary an NCERT textbook for this class would use — correct technical terms, no university-level framing.`,
    'Reply with ONLY a JSON object of the form {"nodes": [ ... ]}. No markdown fences, no commentary.',
  ].join('\n\n');

  const lines = scoped
    ? [
        'The topics listed below have NO learning outcomes behind them at all. A class',
        'taught on one of them records nothing, because there is no outcome for it to be',
        `recorded against. Write roughly ${opts.targetCount} nodes for EACH topic listed, and nothing`,
        'at all for any other topic.',
        '',
        `CHAPTER: ${chapter.title}  (id: "${chapter.id}")`,
        'THE TOPICS TO DECOMPOSE - every node you write belongs to one of these:',
      ]
    : [
        `Decompose this chapter into roughly ${opts.targetCount} atomic learning outcome nodes.`,
        '',
        `CHAPTER: ${chapter.title}  (id: "${chapter.id}")`,
        'ITS TOPICS, each of which should yield SEVERAL nodes:',
      ];

  for (const topic of todo) {
    lines.push(`\n- ${topic.title} (id: "${topic.id}")`);
    for (const objective of topic.objectives) lines.push(`    objective: ${objective}`);
  }

  // The rest of the chapter, by TITLE only. It is context for where the
  // boundaries of these topics lie, and it must not be decomposed - listing
  // its objectives too would read as more work to do, and the model would
  // duly do it, re-creating outcomes the chapter already holds.
  const rest = scoped ? chapter.topics.filter((t) => !wanted.has(t.id)) : [];
  if (rest.length > 0) {
    lines.push(
      '',
      'THE REST OF THE CHAPTER, already covered. Write NOTHING for these:',
      ...rest.map((t) => `  ${t.title}`),
    );
  }

  if (linkable.length > 0) {
    lines.push(
      '',
      ...(scoped
        ? [
            'NODES ALREADY IN THIS CHAPTER. These are the only ids you may point a',
            'prerequisite at, and you must not re-create them:',
          ]
        : [
            'NODES ALREADY IN THE MAP for this class and subject. Reuse these ids in',
            '"prerequisites" wherever this chapter genuinely builds on them, and do NOT',
            're-create them:',
          ]),
      // With the outcome alongside, where there is one. A bare id is enough to
      // point an edge at, and not enough to know whether the outcome you are
      // about to write is already there under another slug.
      ...linkable.map((n) => (n.outcome ? `  ${n.id}: ${n.outcome}` : `  ${n.id}`)),
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
aligned to "options" BY INDEX. That naming is what lets the tutor say WHY a
student is stuck rather than just THAT they are.

TWO RULES ABOUT "misconceptions" THAT ARE REJECTED MECHANICALLY:
1. misconceptions[correctIndex] MUST be the empty string "". The correct answer
   is not a misconception, so its slot is blank. If correctIndex is 2, then
   misconceptions[2] is "" and the other three are filled.
2. Every other entry must be a SENTENCE about the student's thinking, not a
   label. "foam" and "both" are rejected; "thinks whipped cream is a colloid
   because it looks thick" is what is wanted.

Example — note correctIndex is 2 here, so the BLANK is at index 2, not index 0:
  options:        ["Left atrium", "Right ventricle", "Left ventricle", "Right atrium"]
  correctIndex:   2
  misconceptions: ["thinks atria pump rather than receive",
                   "confuses the pulmonary circuit with the systemic circuit",
                   "",
                   "confuses side and chamber type together"]

ALL FOUR OPTIONS MUST BE ABOUT THE SAME LENGTH.

This rule used to read "no option longer than the correct answer", which is the
instruction that produced the defect: across the 4,494 probes written under it,
the correct answer is strictly the longest option in 36.8% of questions and 55%
in one bank, so a student who always picks the longest without reading scores
43.6% where guessing should buy 25%. A placement test that can be passed by
counting words measures nothing.

So: write the correct answer first, then make every distractor carry the same
amount of detail. If the right answer needs a qualifier, give the wrong ones a
qualifier too. A batch where the correct answer is usually the longest is
REJECTED MECHANICALLY and sent back.

BANNED: "all of the above", "none of the above", options that are obviously
silly, and options that differ only by a typo.`;

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
