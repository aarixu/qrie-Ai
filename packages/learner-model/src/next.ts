import { GAP_THRESHOLD, type GraphIndex } from '@ai-tutor/knowledge-graph';
import { confirmedMisconceptions } from './misconception.ts';
import type { ConceptState, LearnerModel } from './types.ts';

/**
 * WHAT COMES NEXT (E6-E8/F5, T4a), decided from what we believe — not from
 * syllabus order alone.
 *
 * In this order, and each answer says why:
 *   1. REMEDIAL (lam-one-brain Task 6): what went wrong and has not been put
 *      right — an outcome with a confirmed wrong idea not cleared since
 *      (`confirmedMisconceptions`), due or not, and a due outcome they have
 *      failed cold (unassisted belief under GAP_THRESHOLD on at least one cold
 *      answer). Wrong ideas first, most shown first; then the weakest. At most
 *      three, never what they have just done;
 *   2. REVIEW what is due (F1-F3's `nextReviewAt` has passed) and is not
 *      remedial — maintenance — most overdue first, at most three, never what
 *      they have just done;
 *   3. a PREREQUISITE of what comes next, at any depth, nearest first, that
 *      they have shown, cold, they do not hold (no evidence is not a gap);
 *   4. CHECK-PREREQUISITE: an outcome they have missed cold at least twice
 *      with no cold right answer — just done or not — rests on something they
 *      have never been asked cold. That is asked first, nearest first, since
 *      a third try at the outcome may be a try on missing ground;
 *   5. the NEXT topic in the syllabus.
 *
 * A due outcome with no confirmed wrong idea and no cold failure is
 * maintenance review whether or not it is mastered yet (`masteredAt` is not
 * read here): one right answer alone is not a failure, and spaced review is
 * how it gets mastered. Nothing here calls an outcome held on a high number.
 *
 * Pure: the clock is passed in, and so is what "next" is — the app knows the
 * syllabus, this function knows the student.
 */

export const MAX_REVIEWS = 3;

export type NextActivity =
  | { kind: 'remedial'; outcomeIds: string[]; because: string }
  | { kind: 'review'; outcomeIds: string[]; because: string }
  | { kind: 'prerequisite'; outcomeId: string; because: string }
  | { kind: 'check-prerequisite'; outcomeId: string; because: string }
  | { kind: 'next'; because: string };

export interface NextInput {
  model: LearnerModel;
  index: GraphIndex;
  /** ISO time now — the caller's clock, never read here. */
  now: string;
  /** Outcomes of what they have just finished: never offered as a review. */
  justDone?: readonly string[];
  /** The outcomes of the next topic in the syllabus, when there is one. */
  next?: { outcomeIds: readonly string[] };
}

/** Shown, cold, not to be held: at least one cold answer and belief under the gap line. */
const failedCold = (s: ConceptState): boolean => s.unassistedObservations > 0 && s.unassistedMastery < GAP_THRESHOLD;

/** At least two cold answers and not one of them right. */
const missedColdTwice = (s: ConceptState): boolean => s.unassistedObservations >= 2 && s.lastUnassistedSuccessAt === null;

const isDue = (s: ConceptState, now: number): boolean =>
  s.box !== null && s.nextReviewAt !== null && Date.parse(s.nextReviewAt) <= now;

/** Every ancestor of `id`, nearest first, each once; ties in the map's declaration order. */
function ancestorsNearestFirst(index: GraphIndex, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let frontier = [id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const at of frontier) {
      for (const pre of index.prerequisitesOf(at)) {
        if (seen.has(pre)) continue;
        seen.add(pre);
        out.push(pre);
        next.push(pre);
      }
    }
    frontier = next;
  }
  return out;
}

export function nextActivity(input: NextInput): NextActivity {
  const now = Date.parse(input.now);
  const skip = new Set(input.justDone ?? []);
  const states = Object.values(input.model.states).sort((a, b) => (a.outcomeId < b.outcomeId ? -1 : a.outcomeId > b.outcomeId ? 1 : 0));

  const shown = (s: ConceptState): number => confirmedMisconceptions(s).reduce((n, m) => n + m.count, 0);
  const remedial = states
    .filter((s) => !skip.has(s.outcomeId) && (shown(s) > 0 || (isDue(s, now) && failedCold(s))))
    .sort((a, b) => shown(b) - shown(a) || a.unassistedMastery - b.unassistedMastery)
    .slice(0, MAX_REVIEWS);
  if (remedial.length > 0) {
    const ideas = remedial.filter((s) => shown(s) > 0).length;
    const failed = remedial.length - ideas;
    const parts = [
      ...(ideas > 0 ? [`${ideas} outcome${ideas === 1 ? ' shows' : 's show'} a wrong idea seen more than once and not cleared`] : []),
      ...(failed > 0 ? [`${failed} due outcome${failed === 1 ? ' was' : 's were'} failed when answered alone`] : []),
    ];
    return { kind: 'remedial', outcomeIds: remedial.map((s) => s.outcomeId), because: `${parts.join('; ')}: fix before anything new` };
  }

  const due = states
    .filter((s) => isDue(s, now) && !skip.has(s.outcomeId))
    .sort((a, b) => Date.parse(a.nextReviewAt!) - Date.parse(b.nextReviewAt!))
    .slice(0, MAX_REVIEWS);
  if (due.length > 0) {
    const late = Math.round((now - Date.parse(due[0].nextReviewAt!)) / 86_400_000);
    return {
      kind: 'review',
      outcomeIds: due.map((s) => s.outcomeId),
      because: `${due.length} outcome${due.length === 1 ? ' is' : 's are'} due for review, the oldest ${late} day${late === 1 ? '' : 's'} overdue`,
    };
  }

  for (const id of input.next?.outcomeIds ?? []) {
    for (const pre of ancestorsNearestFirst(input.index, id)) {
      const s = input.model.states[pre];
      if (s && failedCold(s)) {
        return {
          kind: 'prerequisite',
          outcomeId: pre,
          because: `the next topic rests on prerequisite ${pre}, held cold at ${s.unassistedMastery.toFixed(2)} (under ${GAP_THRESHOLD})`,
        };
      }
    }
  }

  for (const s of states.filter(missedColdTwice)) {
    for (const pre of ancestorsNearestFirst(input.index, s.outcomeId)) {
      const p = input.model.states[pre];
      if (!p || p.unassistedObservations === 0) {
        return {
          kind: 'check-prerequisite',
          outcomeId: pre,
          because: `${s.outcomeId} was missed cold ${s.unassistedObservations} times with no cold right answer, and it rests on ${pre}, which they have never been asked cold: check that first`,
        };
      }
    }
  }

  return { kind: 'next', because: 'nothing is due and nothing it rests on is shaky: on to the next topic' };
}
