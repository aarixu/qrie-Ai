import { GAP_THRESHOLD, type GraphIndex } from '@ai-tutor/knowledge-graph';
import { loadDiagnosticDataFor } from './diagnosticData';
import { profileStore } from '../stores/profile';
import { currentKlass } from '../stores/settings';

/**
 * WHAT THE TUTOR IS TOLD ABOUT THE OUTCOME SHE IS TEACHING.
 *
 * @ai-tutor/doubt-session must not depend on the knowledge graph — the handoff
 * is the one thing in the product that has to work when everything else is
 * missing — so it asks for two functions instead of a map. This is the app
 * supplying them.
 *
 * The result is the difference between re-explaining and diagnosing. A student
 * stuck on the dilution factor has usually not lost the dilution factor; they
 * have lost the step underneath it, and a tutor who is handed that chain can
 * start where the trouble actually is.
 *
 * Everything degrades quietly. No map for this class, a lesson written before
 * the map existed, an id that no longer resolves — each one returns undefined,
 * and she teaches from the beat's label and transcript exactly as she did
 * before any of this.
 */

/** How many foundations to name. Past three she is being handed a syllabus. */
const MAX_FOUNDATIONS = 3;

export interface OutcomeLookup {
  statement(id: string): string | undefined;
  foundations(id: string): readonly { statement: string; secure?: boolean }[] | undefined;
}

/**
 * A lookup over the student's own merged map, with their beliefs folded in.
 *
 * `mastery` is optional because the classroom does not always have a live
 * belief map — without it the foundations are still named, just not marked.
 * Naming them unmarked is worth doing on its own: it tells her what the step
 * rests on even when it cannot tell her where the student is.
 */
export function createOutcomeLookup(mastery?: Record<string, number>): OutcomeLookup {
  const klass = currentKlass();
  const data = klass === null ? null : loadDiagnosticDataFor(klass, profileStore.get().subjects);
  const index: GraphIndex | null = data?.index ?? null;

  return {
    statement(id) {
      if (!id || !index) return undefined;
      return index.node(id)?.outcome;
    },
    foundations(id) {
      if (!id || !index) return undefined;
      const direct = index.prerequisitesOf(id);
      if (direct.length === 0) return undefined;
      const named: { statement: string; secure?: boolean }[] = [];
      for (const prerequisiteId of direct.slice(0, MAX_FOUNDATIONS)) {
        const node = index.node(prerequisiteId);
        if (!node) continue;
        const belief = mastery?.[prerequisiteId];
        named.push({
          statement: node.outcome,
          // Undefined when we have no belief at all — an honest "unknown"
          // rather than a guess she might act on.
          secure: belief === undefined ? undefined : belief >= GAP_THRESHOLD,
        });
      }
      return named.length > 0 ? named : undefined;
    },
  };
}
