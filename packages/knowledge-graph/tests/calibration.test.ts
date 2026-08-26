import { describe, expect, it } from 'vitest';
import { GraphIndex, loadGraph, type LearningNode, type Mastery } from '../src/index';
import {
  DEFAULT_GUESS,
  DEFAULT_SLIP,
  edgeSupport,
  emptyParams,
  itemParams,
  posterior,
} from '../src/params';
import {
  observationsFrom,
  suspectEdges,
  suspectItems,
  train,
  type Observation,
} from '../src/calibration';
import { applyDoubt, decayMastery } from '../src/mastery';
import { PRIOR } from '../src/types';

const node = (id: string, prerequisites: string[] = []): LearningNode => ({
  id,
  klass: 9,
  subject: 'Science',
  chapter: 'c',
  title: id,
  outcome: `State ${id}`,
  prerequisites,
  difficulty: 3,
});

/** A -> B -> C, so B rests on A and C rests on B. */
const chain = () =>
  new GraphIndex(loadGraph({ version: 1, nodes: [node('A'), node('B', ['A']), node('C', ['B'])] }));

const obs = (over: Partial<Observation> = {}): Observation => ({
  probeId: 'p1',
  nodeId: 'B',
  correct: true,
  priorBelief: 0.9,
  ...over,
});

describe('posterior - one answer, weighed honestly', () => {
  const item = { guess: 0.25, slip: 0.1, attempts: 0, correct: 0 };

  it('a correct answer is evidence, not proof, when a quarter of guesses land', () => {
    expect(posterior(0.5, true, item)).toBeCloseTo(0.783, 2);
  });

  it('a wrong answer from a confident student is survivable, because people slip', () => {
    // The naive update sent this near zero, and then taught them something
    // they already knew.
    expect(posterior(0.9, false, item)).toBeGreaterThan(0.5);
  });

  it('an item that is pure guesswork barely moves belief at all', () => {
    const coinFlip = { guess: 0.5, slip: 0.4, attempts: 0, correct: 0 };
    expect(Math.abs(posterior(0.5, true, coinFlip) - 0.5)).toBeLessThan(0.12);
  });

  it('leaves belief alone rather than dividing by zero on an impossible answer', () => {
    const perfect = { guess: 0, slip: 0, attempts: 0, correct: 0 };
    expect(posterior(0, true, perfect)).toBe(0);
  });
});

describe('train - items', () => {
  it('learns a high guess rate from students who should not have known it', () => {
    const index = chain();
    // Twenty students the map said did NOT hold B, and most got it right.
    const observations = Array.from({ length: 20 }, (_, i) =>
      obs({ priorBelief: 0.1, correct: i < 16 }),
    );
    const params = train(emptyParams(), index, observations, {});
    expect(itemParams(params, 'p1').guess).toBeGreaterThan(DEFAULT_GUESS);
  });

  it('learns a high slip rate from confident students who keep failing it', () => {
    const index = chain();
    const observations = Array.from({ length: 20 }, (_, i) =>
      obs({ priorBelief: 0.95, correct: i < 8 }),
    );
    const params = train(emptyParams(), index, observations, {});
    expect(itemParams(params, 'p1').slip).toBeGreaterThan(DEFAULT_SLIP);
  });

  it('a single odd answer barely moves anything - shrinkage does its job', () => {
    const index = chain();
    const params = train(emptyParams(), index, [obs({ priorBelief: 0.95, correct: false })], {});
    expect(itemParams(params, 'p1').slip).toBeLessThan(0.16);
  });

  it('ignores the uncertain middle, which says nothing clean about the item', () => {
    const index = chain();
    const params = train(emptyParams(), index, [obs({ priorBelief: PRIOR, correct: true })], {});
    const item = itemParams(params, 'p1');
    expect(item.guess).toBe(DEFAULT_GUESS);
    expect(item.slip).toBe(DEFAULT_SLIP);
    // It still counts toward the observed difficulty.
    expect(item.attempts).toBe(1);
  });

  it('accumulates across runs rather than starting over', () => {
    const index = chain();
    const first = train(emptyParams(), index, [obs()], {});
    const second = train(first, index, [obs()], {});
    expect(itemParams(second, 'p1').attempts).toBe(2);
    expect(second.observations).toBe(2);
  });

  it('does nothing at all with no evidence - the priors stand', () => {
    const before = emptyParams();
    expect(train(before, chain(), [], {})).toBe(before);
  });
});

describe('train - edges', () => {
  /** Holds C without the B it is supposed to rest on: the claim is violated. */
  const violating: Mastery = { A: 0.9, B: 0.05, C: 0.9 };
  const consistent: Mastery = { A: 0.9, B: 0.9, C: 0.9 };

  it('erodes support for an edge students keep contradicting', () => {
    const index = chain();
    let params = emptyParams();
    for (let i = 0; i < 40; i += 1) params = train(params, index, [obs()], violating);
    expect(edgeSupport(params, 'C', 'B')).toBeLessThan(0.6);
  });

  it('leaves an edge that holds up fully trusted', () => {
    const index = chain();
    let params = emptyParams();
    for (let i = 0; i < 40; i += 1) params = train(params, index, [obs()], consistent);
    expect(edgeSupport(params, 'C', 'B')).toBeGreaterThan(0.95);
  });

  it('trusts an edge nobody has tested - day one must still work', () => {
    expect(edgeSupport(emptyParams(), 'C', 'B')).toBe(1);
  });

  it('reports the suspects for a human, and deletes nothing itself', () => {
    const index = chain();
    let params = emptyParams();
    for (let i = 0; i < 40; i += 1) params = train(params, index, [obs()], violating);
    const suspects = suspectEdges(params);
    expect(suspects[0]).toMatchObject({ nodeId: 'C', prerequisiteId: 'B' });
    // The edge is still in the graph; only trust in it fell.
    expect(index.prerequisitesOf('C')).toContain('B');
  });
});

describe('suspectItems', () => {
  it('names a question everyone passes and one nobody does', () => {
    const params = emptyParams();
    params.items.easy = { guess: 0.25, slip: 0.1, attempts: 50, correct: 50 };
    params.items.hard = { guess: 0.25, slip: 0.1, attempts: 50, correct: 2 };
    params.items.fine = { guess: 0.25, slip: 0.1, attempts: 50, correct: 30 };
    const reasons = Object.fromEntries(suspectItems(params).map((s) => [s.probeId, s.reason]));
    expect(reasons).toEqual({ easy: 'too-easy', hard: 'too-hard' });
  });

  it('stays quiet until there is enough evidence to accuse an item', () => {
    const params = emptyParams();
    params.items.fresh = { guess: 0.25, slip: 0.1, attempts: 3, correct: 3 };
    expect(suspectItems(params)).toEqual([]);
  });
});

describe('observationsFrom', () => {
  it('records what was believed BEFORE the answer, not after', () => {
    const before: Mastery = { B: 0.31 };
    const [o] = observationsFrom(
      [{ probeId: 'p1', nodeId: 'B', chosenIndex: 0, correct: true, ms: 900 }],
      before,
    );
    expect(o.priorBelief).toBe(0.31);
  });

  it('drops skips - a skip is not an attempt at the question', () => {
    expect(
      observationsFrom([{ probeId: 'p1', nodeId: 'B', chosenIndex: null, correct: false }], {}),
    ).toEqual([]);
  });
});

describe('decayMastery - forgetting', () => {
  it('relaxes a high belief back toward the prior over time', () => {
    const after = decayMastery({ A: 0.9 }, 30);
    expect(after.A).toBeLessThan(0.9);
    expect(after.A).toBeGreaterThan(PRIOR);
    expect(after.A).toBeCloseTo(PRIOR + (0.9 - PRIOR) * 0.5, 2); // one half-life
  });

  it('never manufactures evidence: a low belief does not drift upward', () => {
    expect(decayMastery({ A: 0.1 }, 365).A).toBe(0.1);
  });

  it('leaves what was just practised alone', () => {
    const after = decayMastery({ A: 0.9, B: 0.9 }, 60, { refreshed: new Set(['A']) });
    expect(after.A).toBe(0.9);
    expect(after.B).toBeLessThan(0.9);
  });

  it('does nothing for no elapsed time', () => {
    const before = { A: 0.9 };
    expect(decayMastery(before, 0)).toBe(before);
  });
});

describe('applyDoubt - a raised hand is evidence', () => {
  it('lowers the nodes being taught when the student stopped the class', () => {
    const after = applyDoubt({ A: 0.8, B: 0.8 }, ['A']);
    expect(after.A).toBeLessThan(0.8);
    expect(after.B).toBe(0.8);
  });

  it('is a nudge, not a verdict - asking is not the same as not knowing', () => {
    const after = applyDoubt({ A: 0.8 }, ['A']);
    expect(after.A).toBeGreaterThan(0.55);
  });

  it('does not propagate: confusion is located, not contagious', () => {
    const after = applyDoubt({ A: 0.8, B: 0.8, C: 0.8 }, ['B']);
    expect(after.A).toBe(0.8);
    expect(after.C).toBe(0.8);
  });
});
