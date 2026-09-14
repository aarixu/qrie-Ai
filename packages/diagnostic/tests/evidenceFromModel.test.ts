import { describe, expect, it } from 'vitest';
import { GraphIndex, initialMastery } from '@ai-tutor/knowledge-graph';
import { buildPlan } from '../src/plan';
import type { DiagnosticSession } from '../src/session';

/**
 * A chain: `root` under `mid` under `leaf`. Three nodes is the smallest map
 * where "a node nobody examined" and "a node examined elsewhere" are different
 * things.
 */
const node = (id: string, prerequisites: string[], difficulty = 4) => ({
  id,
  klass: 10,
  subject: 'Science',
  chapter: 'ch1',
  title: id,
  outcome: `can do ${id}`,
  prerequisites,
  difficulty,
  topicRef: 'class10-science/ch1/t1',
});

const index = new GraphIndex({
  version: 1,
  nodes: [node('root', []), node('mid', ['root']), node('leaf', ['mid'])],
} as never);

/** A sitting in which nobody was asked anything. */
const emptySitting = (): DiagnosticSession =>
  ({
    config: { klass: 10, subjects: ['Science'], lookBack: 0 },
    mastery: initialMastery(index, { biasByDifficulty: true }),
    answers: [],
    askedNodeIds: new Set<string>(),
    seeded: new Set<string>(),
  }) as unknown as DiagnosticSession;

describe('the evidence gate, sourced from the learner model', () => {
  /**
   * THE 0.46 DEFECT. `initialMastery({ biasByDifficulty: true })` seeds a
   * difficulty-4 node at 0.46, below the 0.5 gap line. Without a gate, a
   * placement test nobody answered produces a remedial plan.
   */
  it('gives a student nobody has measured no plan at all', () => {
    expect(buildPlan(emptySitting(), index).plan).toHaveLength(0);
  });

  /**
   * And this is what the model adds. The classroom examined `mid` last week;
   * this test never asked about it. Before Phase 3 the plan could only reason
   * about the questions in front of it, which is the one-sitting memory a
   * learner model exists to replace.
   */
  it('lets an outcome examined elsewhere become a step', () => {
    const plan = buildPlan(emptySitting(), index, {
      knownEvidence: new Set(['mid']),
    }).plan;
    expect(plan.map((s) => s.nodeId)).toEqual(['mid']);
  });

  it('still refuses every outcome the model has never seen', () => {
    const plan = buildPlan(emptySitting(), index, {
      knownEvidence: new Set(['mid']),
    }).plan;
    expect(plan.map((s) => s.nodeId)).not.toContain('root');
    expect(plan.map((s) => s.nodeId)).not.toContain('leaf');
  });
});
