import { describe, expect, it } from 'vitest';
import { GraphIndex, loadGraph } from '../src/graph';
import {
  applyEvidence,
  confidenceCoverage,
  gapsFrom,
  informationValue,
  initialMastery,
} from '../src/mastery';
import { PRIOR, type Answer, type LearningNode } from '../src/types';

const node = (id: string, prerequisites: string[] = [], extra: Partial<LearningNode> = {}): LearningNode => ({
  id,
  klass: 10,
  subject: 'Science',
  chapter: 'life-processes',
  title: id,
  outcome: `Can do ${id}`,
  prerequisites,
  difficulty: 3,
  ...extra,
});

/** A -> B -> C, plus an unrelated leaf X. */
const chain = () =>
  new GraphIndex(
    loadGraph({
      version: 1,
      nodes: [node('A'), node('B', ['A']), node('C', ['B']), node('X')],
    }),
  );

const answer = (nodeId: string, correct: boolean, extra: Partial<Answer> = {}): Answer => ({
  probeId: `p-${nodeId}`,
  nodeId,
  chosenIndex: correct ? 0 : 1,
  correct,
  ...extra,
});

describe('initialMastery', () => {
  it('starts every node at the prior', () => {
    const m = initialMastery(chain());
    expect(Object.values(m).every((v) => v === PRIOR)).toBe(true);
  });

  it('nudges easy nodes above hard ones when biased', () => {
    const index = new GraphIndex(
      loadGraph({ version: 1, nodes: [node('easy', [], { difficulty: 1 }), node('hard', [], { difficulty: 5 })] }),
    );
    const m = initialMastery(index, { biasByDifficulty: true });
    expect(m.easy).toBeGreaterThan(m.hard);
    // It is a prior, not a claim — the nudge stays small.
    expect(m.easy - m.hard).toBeLessThan(0.2);
  });
});

describe('applyEvidence', () => {
  it('a correct answer raises the node and its ancestors', () => {
    const index = chain();
    const m = applyEvidence(initialMastery(index), index, answer('C', true));
    // Bayes with a 1-in-4 guess rate: 0.5 -> 0.78, not the 0.93 a naive pull
    // gave. One correct answer on a four-option question is real evidence and
    // not proof, and the difference is exactly what stops luck reading as
    // knowledge. It still clears the 0.75 a node needs to count as settled.
    expect(m.C).toBeGreaterThan(0.75);
    expect(m.C).toBeLessThan(0.85);
    expect(m.B).toBeGreaterThan(PRIOR);
    expect(m.A).toBeGreaterThan(PRIOR);
    // Belief decays with distance: the direct evidence is strongest.
    expect(m.B).toBeGreaterThan(m.A);
    expect(m.X).toBe(PRIOR); // unrelated nodes are untouched
  });

  it('a wrong answer lowers the node and its descendants', () => {
    const index = chain();
    const m = applyEvidence(initialMastery(index), index, answer('A', false));
    expect(m.A).toBeLessThan(0.2);
    expect(m.B).toBeLessThan(PRIOR);
    expect(m.C).toBeLessThan(PRIOR);
    expect(m.C).toBeGreaterThan(m.B); // further away, less affected
    expect(m.X).toBe(PRIOR);
  });

  it('never overwrites direct evidence with inference', () => {
    const index = chain();
    // The student demonstrably knows A.
    let m = applyEvidence(initialMastery(index), index, answer('A', true));
    const knownA = m.A;
    // Later they fail C. Inference would drag A down; direct evidence must win.
    m = applyEvidence(m, index, answer('C', false), { probed: new Set(['A']) });
    expect(m.A).toBe(knownA);
  });

  it('clamps rather than reaching certainty', () => {
    const index = chain();
    let m = initialMastery(index);
    for (let i = 0; i < 20; i++) m = applyEvidence(m, index, answer('A', true));
    expect(m.A).toBeLessThanOrEqual(0.98);
    expect(m.A).toBeGreaterThan(0.9);
  });

  it('counts a slow correct answer for less than a fast one', () => {
    const index = chain();
    const fast = applyEvidence(initialMastery(index), index, answer('C', true, { ms: 3_000 }));
    const slow = applyEvidence(initialMastery(index), index, answer('C', true, { ms: 60_000 }));
    expect(slow.C).toBeLessThan(fast.C);
  });

  it('treats a skip as weak evidence against, without propagating', () => {
    const index = chain();
    const m = applyEvidence(initialMastery(index), index, {
      probeId: 'p', nodeId: 'A', chosenIndex: null, correct: false,
    });
    expect(m.A).toBeLessThan(PRIOR);
    expect(m.A).toBeGreaterThan(0.25); // weaker than a real wrong answer
    expect(m.B).toBe(PRIOR); // silence says nothing about the rest of the map
  });

  it('is pure — the input map is untouched', () => {
    const index = chain();
    const before = initialMastery(index);
    const snapshot = { ...before };
    applyEvidence(before, index, answer('A', true));
    expect(before).toEqual(snapshot);
  });
});

describe('gapsFrom', () => {
  it('ranks a blocking node above an equally shaky leaf', () => {
    const index = chain();
    const m = { ...initialMastery(index), A: 0.2, X: 0.2, B: 0.9, C: 0.9 };
    const gaps = gapsFrom(m, index);
    expect(gaps[0].nodeId).toBe('A'); // A blocks B and C; X blocks nothing
    expect(gaps.map((g) => g.nodeId)).toContain('X');
  });

  it('excludes settled nodes and respects subject and class filters', () => {
    const index = new GraphIndex(
      loadGraph({
        version: 1,
        // Each node differs from 'sci' in exactly one dimension, so a filter
        // that leaks shows up unambiguously.
        nodes: [
          node('sci'),
          node('math', [], { subject: 'Mathematics' }),
          node('c9', [], { subject: 'History', klass: 9 }),
        ],
      }),
    );
    const m = { sci: 0.1, math: 0.1, c9: 0.1 };
    expect(gapsFrom(m, index, { subjects: ['Science'] }).map((g) => g.nodeId)).toEqual(['sci']);
    expect(gapsFrom(m, index, { klass: 9 }).map((g) => g.nodeId)).toEqual(['c9']);
    expect(gapsFrom(m, index, { subjects: ['Science'], klass: 9 })).toEqual([]);
    expect(gapsFrom({ sci: 0.9, math: 0.9, c9: 0.9 }, index)).toEqual([]);
  });
});

describe('informationValue', () => {
  it('peaks at maximum uncertainty', () => {
    const index = chain();
    const uncertain = informationValue({ ...initialMastery(index), B: 0.5 }, index, 'B');
    const settled = informationValue({ ...initialMastery(index), B: 0.95 }, index, 'B');
    expect(uncertain).toBeGreaterThan(settled);
  });

  it('prefers a well-connected node over an isolated one at the same uncertainty', () => {
    const index = chain();
    const m = { ...initialMastery(index), B: 0.5, X: 0.5 };
    expect(informationValue(m, index, 'B')).toBeGreaterThan(informationValue(m, index, 'X'));
  });
});

describe('confidenceCoverage', () => {
  it('is 0 at the prior and 1 when every belief has settled', () => {
    const index = chain();
    expect(confidenceCoverage(initialMastery(index), index)).toBe(0);
    expect(confidenceCoverage({ A: 0.95, B: 0.95, C: 0.05, X: 0.05 }, index)).toBe(1);
  });

  it('counts only in-scope subjects', () => {
    const index = new GraphIndex(
      loadGraph({ version: 1, nodes: [node('sci'), node('math', [], { subject: 'Mathematics' })] }),
    );
    expect(confidenceCoverage({ sci: 0.95, math: 0.5 }, index, { subjects: ['Science'] })).toBe(1);
  });
});
