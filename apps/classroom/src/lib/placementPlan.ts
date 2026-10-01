import { buildPlan, startSession, type DiagnosticSession } from '@ai-tutor/diagnostic';
import type { DiagnosticResult, Mastery } from '@ai-tutor/knowledge-graph';
import { evidenceSet } from '@ai-tutor/learner-model';
import { loadDiagnosticDataFor } from './diagnosticData';
import { loadModel } from './learnerModel';
import { placementKey, placementSubjects, restoreSitting } from './placement';
import type { PlacementState } from '../stores/placement';
import type { StudentProfile } from '../stores/profile';

/**
 * ONE PLAN FROM A TEST PER SUBJECT.
 *
 * The test is sat a subject at a time, but the student has one study plan —
 * `profile.diagnostic`, which StudyPlan, the quiz loop (lib/adaptPlan.ts) and
 * the achievements all read as one result. So when the last subject finishes,
 * the sittings are folded into one session over the map of every chosen
 * subject and the engine's own `buildPlan` makes the plan from it: the same
 * cap, the same prerequisites-first order and the same interleaving a
 * one-sitting test always had.
 *
 * Kept out of lib/placement.ts so the Gate, which reads that file on every
 * navigation, does not carry the planner and the learner model with it.
 */

/** What a sitting contributes: what it believes, and what it actually asked. */
export interface Contribution {
  mastery: Mastery;
  /** Where it started; undefined when unknown (a result from the old test). */
  before?: Mastery;
  answers: DiagnosticSession['answers'];
  askedNodeIds: ReadonlySet<string>;
  seeded: ReadonlySet<string>;
}

/**
 * Fold several sittings into one session over `base` (the merged map).
 *
 * The maps of different subjects only share outcomes through lineage — Class
 * 11 Biology and Chemistry both look back into Class 9-10 Science — so most
 * outcomes come from exactly one sitting. Where more than one has a belief:
 *
 *   1. a sitting that ASKED about it outranks one that inferred it, as direct
 *      evidence outranks inference inside a sitting (applyEvidence);
 *   2. otherwise a sitting whose belief MOVED from where it started outranks
 *      one that never spoke about it, so inference is not averaged away by
 *      silence;
 *   3. ties are averaged.
 *
 * Pure, and exported for the test.
 */
export function mergeSittings(base: DiagnosticSession, parts: readonly Contribution[]): DiagnosticSession {
  const mastery: Mastery = { ...base.mastery };
  const ids = new Set<string>();
  for (const part of parts) for (const id of Object.keys(part.mastery)) ids.add(id);

  for (const id of ids) {
    const holders = parts.filter((p) => p.mastery[id] !== undefined);
    const asked = holders.filter((p) => p.askedNodeIds.has(id));
    const moved = holders.filter((p) => p.before === undefined || p.before[id] !== p.mastery[id]);
    const pick = asked.length > 0 ? asked : moved.length > 0 ? moved : holders.slice(0, 1);
    mastery[id] = pick.reduce((sum, p) => sum + p.mastery[id], 0) / pick.length;
  }

  return {
    ...base,
    mastery,
    answers: parts.flatMap((p) => p.answers),
    askedNodeIds: new Set(parts.flatMap((p) => [...p.askedNodeIds])),
    seeded: new Set(parts.flatMap((p) => [...p.seeded])),
  };
}

/**
 * The study plan for every subject placed, or null when there is nothing to
 * build it from.
 *
 * A subject placed by the old one-sitting test has no sitting of its own; its
 * contribution is that test's stored result, so a student who adds a subject
 * after it keeps the plan they had for the others rather than losing it to
 * the new subject's.
 */
export function buildPlacementResult(
  klass: number,
  profile: StudentProfile,
  state: PlacementState,
): DiagnosticResult | null {
  const subjects = placementSubjects(klass, profile.subjects);
  const data = loadDiagnosticDataFor(klass, subjects);
  if (!data || subjects.length === 0) return null;

  const parts: Contribution[] = [];
  let legacyAdded = false;
  for (const subject of subjects) {
    const record = state.records[placementKey(klass, subject)];
    const own = loadDiagnosticDataFor(klass, [subject]);
    const finished = own ? restoreSitting(record?.finished, own, klass, [subject]) : null;
    if (finished) {
      parts.push({ ...finished.session, before: finished.before });
    } else if (record?.legacy && profile.diagnostic && !legacyAdded) {
      legacyAdded = true;
      parts.push({
        mastery: profile.diagnostic.mastery,
        answers: profile.diagnostic.answers,
        askedNodeIds: new Set(profile.diagnostic.answers.map((a) => a.nodeId)),
        seeded: new Set(),
      });
    }
  }
  if (parts.length === 0) return null;

  const base = startSession(data.index, data.bank, {
    klass,
    subjects: data.subjects,
    lookBack: data.lookBack,
  });
  return buildPlan(mergeSittings(base, parts), data.index, {
    knownEvidence: evidenceSet(loadModel()),
  });
}
