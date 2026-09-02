import {
  GraphIndex,
  gapsFrom,
  type DiagnosticResult,
  type Gap,
  type PlanStep,
} from '@ai-tutor/knowledge-graph';
import type { DiagnosticSession } from './session';

/**
 * The study plan — the only part of the diagnostic a student actually sees.
 *
 * Two rules shape it, and the first outranks the second:
 *
 *  1. PREREQUISITES FIRST. A plan that teaches division before fractions is
 *     worse than no plan. Ordering follows the map's topological order, not the
 *     gap score, however badly a later node scored.
 *  2. SHORT. A two-hundred-step plan is a wall, not a plan. Twelve steps is
 *     roughly a fortnight of work, which is a thing a student can picture.
 */

export interface PlanOptions {
  /** Hard cap on steps shown. */
  maxSteps?: number;
  /** Below this belief a node counts as a gap. */
  threshold?: number;
}

const DEFAULT_MAX_STEPS = 12;

export function buildPlan(
  session: DiagnosticSession,
  index: GraphIndex,
  opts: PlanOptions = {},
): DiagnosticResult {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  const gaps = gapsFrom(session.mastery, index, {
    subjects: session.config.subjects,
    klass: session.config.klass,
    // The plan may reach back exactly as far as the test did: a Class 9
    // student whose break is Class 7 fractions gets Class 7 fractions as
    // step one, not a Class 9 restatement of it.
    minKlass: session.config.klass - (session.config.lookBack ?? 0),
    threshold: opts.threshold,
  });

  return {
    mastery: session.mastery,
    gaps,
    plan: orderPlan(gaps, index, maxSteps),
    answers: session.answers,
  };
}

/**
 * Take the worst gaps, then re-sort them so nothing is taught before what it
 * rests on. The scoring picks WHICH nodes make the plan; the topological order
 * decides the sequence.
 */
function orderPlan(gaps: Gap[], index: GraphIndex, maxSteps: number): PlanStep[] {
  const gapIds = new Set(gaps.map((g) => g.nodeId));

  // Walk the worst gaps in score order, but pull in any gap they depend on
  // first — a step whose foundation is also broken is not a step a student can
  // take. Those pulled-in prerequisites count against the cap too.
  const chosen: string[] = [];
  const inPlan = new Set<string>();

  const add = (id: string): void => {
    if (inPlan.has(id) || chosen.length >= maxSteps) return;
    for (const prerequisite of index.prerequisitesOf(id)) {
      if (gapIds.has(prerequisite)) add(prerequisite);
    }
    if (inPlan.has(id) || chosen.length >= maxSteps) return;
    inPlan.add(id);
    chosen.push(id);
  };

  for (const gap of gaps) {
    if (chosen.length >= maxSteps) break;
    add(gap.nodeId);
  }

  // Final ordering is the map's own topological order, so the sequence is
  // teachable even though the selection was score-driven.
  const rank = new Map(index.topoOrder().map((id, i) => [id, i]));
  chosen.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));

  return toSteps(interleave(chosen, index), index, inPlan);
}

/**
 * INTERLEAVING — the same steps, in an order that survives the week.
 *
 * Six steps from one chapter in a row is blocked practice. It feels efficient
 * while it is happening and it is the weaker way to learn: the student stops
 * having to work out WHICH idea applies, because the answer is always "the
 * same one as last time". Mixing chapters costs a little fluency in the moment
 * and buys a lot of retention (Rohrer & Taylor; Bjork's desirable difficulties).
 *
 * It is applied AFTER the topological sort and may never break it: a step is
 * only ever pulled forward past steps it does not depend on. Teaching division
 * before fractions to make the list look varied would be a far worse trade
 * than any amount of blocking.
 */
function interleave(ordered: string[], index: GraphIndex): string[] {
  const chapterOf = (id: string): string => index.node(id)?.chapter ?? '';
  const remaining = [...ordered];
  const out: string[] = [];
  const placed = new Set<string>();

  while (remaining.length > 0) {
    const lastChapter = out.length > 0 ? chapterOf(out[out.length - 1]) : null;

    // The first step whose prerequisites are all already placed (or were never
    // in the plan) AND which changes the subject. Falling back to the first
    // ready step keeps the topological order intact when nothing else is legal.
    const ready = remaining.filter((id) =>
      index.prerequisitesOf(id).every((p) => !ordered.includes(p) || placed.has(p)),
    );
    if (ready.length === 0) {
      // Cannot happen for a topologically sorted list, but a plan is not the
      // place to discover that: take the head rather than loop forever.
      const next = remaining.shift()!;
      out.push(next);
      placed.add(next);
      continue;
    }

    const next = ready.find((id) => chapterOf(id) !== lastChapter) ?? ready[0];
    remaining.splice(remaining.indexOf(next), 1);
    out.push(next);
    placed.add(next);
  }
  return out;
}

/** Turn ordered node ids into the steps a student reads. */
function toSteps(chosen: string[], index: GraphIndex, inPlan: ReadonlySet<string>): PlanStep[] {
  return chosen.map((id) => {
    const node = index.node(id);
    return {
      nodeId: id,
      reason: reasonFor(id, index, inPlan),
      // Both carried, because a plan is STORED: a student's saved result has to
      // stay resolvable after the map is regenerated under it, and the topic is
      // what survives — an outcome moves between nodes far more often than a
      // chapter of the syllabus moves.
      topicRef: node?.topicRef,
      lessonRef: node?.lessonRef,
    };
  });
}

/**
 * The line the student reads. It has to answer "why this, why now" in one
 * breath — a plan that just lists topics reads like a report card.
 */
function reasonFor(id: string, index: GraphIndex, inPlan: ReadonlySet<string>): string {
  const node = index.node(id);
  if (!node) return 'Worth a look.';

  const blocked = index.blockCount(id);
  const brokenFoundations = index
    .prerequisitesOf(id)
    .filter((p) => inPlan.has(p)).length;

  if (brokenFoundations > 0) {
    return `Builds on what you just fixed — take this one straight after.`;
  }
  if (blocked >= 6) {
    return `Worth fixing first — ${blocked} later topics build on this one.`;
  }
  if (blocked > 0) {
    return `Fixing this unlocks ${blocked} more ${blocked === 1 ? 'topic' : 'topics'}.`;
  }
  if (node.difficulty >= 4) {
    return `A tricky one — worth a careful second pass.`;
  }
  return `A quick win to lock in.`;
}
