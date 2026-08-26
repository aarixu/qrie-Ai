import type { LearningNode } from '../../../packages/knowledge-graph/src/types.ts';
import type { Topic } from '../../../packages/syllabus/src/syllabus.ts';

/**
 * WHICH OF A CHAPTER'S OUTCOMES BELONG TO THIS LESSON.
 *
 * A chapter holds about fifty outcomes and about ten topics, so a lesson is
 * roughly five of them. The map does not say which five: a node records the
 * chapter it came from and not the topic inside it, because the generator was
 * written before lessons were planned from outcomes at all.
 *
 * Until nodes carry a topic id, this matches on what both sides already say in
 * words. A syllabus topic states its objectives ("Student can calculate the
 * dilution factor..."); a node states an outcome in the same vocabulary,
 * because both were written from the same NCERT chapter. Overlapping content
 * words are a weak signal individually and a reliable one across a whole
 * objective list.
 *
 * The selection is then CLOSED under prerequisites inside the chapter: pulling
 * in an outcome without the one it rests on would hand the planner a ladder
 * with a missing rung.
 */

/** Words that appear in every objective and carry no signal. */
const STOP = new Set([
  'student', 'can', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'from', 'that', 'this', 'it', 'is', 'are', 'as', 'by', 'at', 'be', 'how', 'why', 'what',
  'their', 'its', 'they', 'them', 'given', 'using', 'use', 'between', 'each', 'one', 'two',
  'state', 'identify', 'describe', 'explain', 'name', 'list', 'define',
]);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * How many beats a lesson may run to, and therefore how many outcomes it may
 * carry. The format allows 6-12 beats; a hook, a recap and roughly one check
 * per three outcomes means seven outcomes lands inside that.
 */
export const MAX_OUTCOMES_PER_LESSON = 7;

export interface SelectOptions {
  max?: number;
}

/**
 * The outcomes this topic's lesson should teach, in no particular order — the
 * planner decides the order.
 *
 * Falls back to the easiest outcomes in the chapter when nothing matches,
 * which is what happens for a topic whose objectives are phrased differently
 * from the map's. A lesson built from the chapter's foundations is a worse
 * lesson than a well-matched one and a much better outcome than none.
 */
export function outcomesForTopic(
  topic: Topic,
  chapterNodes: readonly LearningNode[],
  opts: SelectOptions = {},
): LearningNode[] {
  const max = opts.max ?? MAX_OUTCOMES_PER_LESSON;
  if (chapterNodes.length === 0) return [];

  const wanted = new Set([...words(topic.title), ...topic.objectives.flatMap(words)]);
  const byId = new Map(chapterNodes.map((n) => [n.id, n]));

  const scored = chapterNodes
    .map((node) => {
      const overlap = words(node.outcome).filter((w) => wanted.has(w)).length;
      return { node, overlap };
    })
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        a.node.difficulty - b.node.difficulty ||
        a.node.id.localeCompare(b.node.id),
    );

  const matched = scored.filter((s) => s.overlap > 0);
  const pool = matched.length > 0 ? matched : scored;

  // Take the best, then close under in-chapter prerequisites so the ladder has
  // no missing rungs. The closure counts against the cap: a lesson of nine
  // outcomes is not a lesson.
  const chosen = new Map<string, LearningNode>();
  const addWithPrerequisites = (node: LearningNode): void => {
    if (chosen.has(node.id) || chosen.size >= max) return;
    for (const id of node.prerequisites) {
      const prerequisite = byId.get(id);
      if (prerequisite) addWithPrerequisites(prerequisite);
    }
    if (chosen.size < max) chosen.set(node.id, node);
  };

  for (const { node } of pool) {
    if (chosen.size >= max) break;
    addWithPrerequisites(node);
  }
  return [...chosen.values()];
}
