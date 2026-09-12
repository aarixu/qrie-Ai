import type { TopicOutcome } from '@ai-tutor/class-prep';
import { loadDiagnosticDataFor } from './diagnosticData';
import { profileStore } from '../stores/profile';
import { currentKlass } from '../stores/settings';

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
 * already use. Every node in the three committed maps carries one.
 *
 * An empty answer is an ordinary state, not a failure: a map may not cover
 * this class yet. The class is still taught — it just cannot be measured, and
 * the prompt is then silent about outcomes rather than inviting a guess.
 */

/**
 * Past this the list stops being a scope and becomes a syllabus.
 *
 * A topic's own nodes are a handful; a chapter's are fifty. Handing a planner
 * fifty outcomes for one four-minute class invites it to claim all of them,
 * which is worse than claiming none.
 */
export const MAX_OUTCOMES = 12;

export function outcomesForTopic(topicRef: string | undefined): TopicOutcome[] {
  if (!topicRef) return [];

  const klass = currentKlass();
  if (klass === null) return [];

  const data = loadDiagnosticDataFor(klass, profileStore.get().subjects);
  if (!data) return [];

  return data.index
    .ids()
    .map((id) => data.index.node(id))
    .filter((node): node is NonNullable<typeof node> => node !== null && node.topicRef === topicRef)
    // Easiest first, which is the order a class teaches them in anyway.
    .sort((a, b) => a.difficulty - b.difficulty)
    .slice(0, MAX_OUTCOMES)
    .map((node) => ({ id: node.id, statement: node.outcome }));
}
