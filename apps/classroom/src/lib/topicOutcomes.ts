import type { TopicOutcome } from '@ai-tutor/class-prep';

/**
 * WHAT THE MAP SAYS A TOPIC IS FOR.
 *
 * The one link between a class and the map that measures it, and until now it
 * did not exist: the planner was asked for `teaches` ids and never shown a
 * single one, so it invented them. An invented outcome id means the class is
 * taught, tested and recorded as having taught NOTHING — the finished lesson
 * raises no belief, the quiz after it finds no probes, and the adaptive loop
 * has nothing to act on. Silently, and for good.
 *
 * The join is `topicRef`, the same key the catalogue and the chapter screen
 * already use. Every node in the committed maps carries one.
 *
 * THE MAP IS THE TOPIC'S OWN, NOT THE STUDENT'S (T1.3). A topicRef begins with
 * its syllabus id — `class10-mathematics/...` — and every authored map is
 * filed under that same id in packages/knowledge-graph/data. So the map is
 * read straight from the topicRef. This used to go through the student's
 * CURRENT class and subjects instead, and answer [] whenever no class was set
 * or the topic sat outside the student's window: the first maths class ever
 * prepared (2026-09-28) was planned with no outcomes and kept with none on
 * any of its 14 beats. The prewarm runner has always read the topic's own
 * map (tools/prewarm/lib/topics.mjs, outcomesFor), and now the two agree —
 * same file, same join, same easiest-first order, same cap.
 *
 * An empty answer is an ordinary state, not a failure: a syllabus may have no
 * map yet. The class is still taught — it just cannot be measured, and the
 * prompt is then silent about outcomes rather than inviting a guess.
 */

/**
 * Past this the list stops being a scope and becomes a syllabus.
 *
 * A topic's own nodes are a handful; a chapter's are fifty. Handing a planner
 * fifty outcomes for one four-minute class invites it to claim all of them,
 * which is worse than claiming none.
 */
export const MAX_OUTCOMES = 12;

interface MapNode {
  id: string;
  outcome: string;
  topicRef?: string;
  difficulty: number;
}

/**
 * Every authored map, by the syllabus id it is filed under. The glob is the
 * same one lib/diagnosticData.ts uses, so the bundle carries these files once
 * whichever module asks; sidecar probe and link files are not maps.
 */
const mapModules = import.meta.glob('../../../../packages/knowledge-graph/data/*.json', {
  eager: true,
}) as Record<string, { default: unknown }>;

function nodesOf(syllabusId: string): MapNode[] {
  const entry = Object.entries(mapModules).find(([path]) => path.endsWith(`/${syllabusId}.json`));
  const nodes = (entry?.[1].default as { nodes?: unknown } | undefined)?.nodes;
  return Array.isArray(nodes) ? (nodes as MapNode[]) : [];
}

export function outcomesForTopic(topicRef: string | undefined): TopicOutcome[] {
  if (!topicRef) return [];
  const syllabusId = topicRef.split('/')[0];
  if (!syllabusId) return [];

  return nodesOf(syllabusId)
    .filter((node) => node.topicRef === topicRef)
    // Easiest first, which is the order a class teaches them in anyway.
    .sort((a, b) => a.difficulty - b.difficulty)
    .slice(0, MAX_OUTCOMES)
    .map((node) => ({ id: node.id, statement: node.outcome }));
}
