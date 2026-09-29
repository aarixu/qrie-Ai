import { GAP_THRESHOLD, type GraphIndex } from '@ai-tutor/knowledge-graph';
import type { LearnerModel } from './types.ts';

/**
 * WHAT COMES NEXT (E6-E8/F5, T4a), decided from what we believe — not from
 * syllabus order alone.
 *
 * In this order, and each answer says why:
 *   1. REVIEW what is due (F1-F3's `nextReviewAt` has passed), most overdue
 *      first, at most three, never what they have just done;
 *   2. a PREREQUISITE of what comes next that they have shown, cold, they do
 *      not hold (unassisted belief under GAP_THRESHOLD, on at least one cold
 *      answer — no evidence is not a gap);
 *   3. the NEXT topic in the syllabus.
 *
 * Confirmed-misconception fixes belong between 1 and 2 in the plan; there is
 * no misconception registry yet (T3), so that branch does not exist here.
 *
 * Pure: the clock is passed in, and so is what "next" is — the app knows the
 * syllabus, this function knows the student.
 */

export const MAX_REVIEWS = 3;

export type NextActivity =
  | { kind: 'review'; outcomeIds: string[]; because: string }
  | { kind: 'prerequisite'; outcomeId: string; because: string }
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

export function nextActivity(input: NextInput): NextActivity {
  const now = Date.parse(input.now);
  const skip = new Set(input.justDone ?? []);

  const due = Object.values(input.model.states)
    .filter((s) => s.box !== null && s.nextReviewAt !== null && Date.parse(s.nextReviewAt) <= now && !skip.has(s.outcomeId))
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
    for (const pre of input.index.prerequisitesOf(id)) {
      const s = input.model.states[pre];
      if (s && s.unassistedObservations > 0 && s.unassistedMastery < GAP_THRESHOLD) {
        return {
          kind: 'prerequisite',
          outcomeId: pre,
          because: `the next topic rests on prerequisite ${pre}, held cold at ${s.unassistedMastery.toFixed(2)} (under ${GAP_THRESHOLD})`,
        };
      }
    }
  }

  return { kind: 'next', because: 'nothing is due and nothing it rests on is shaky: on to the next topic' };
}
