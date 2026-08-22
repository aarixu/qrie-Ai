import { describe, expect, it } from 'vitest';
import { GraphIndex, loadGraph, type LearningNode, type Probe, type ProbeBank } from '@ai-tutor/knowledge-graph';
import { answerProbe, isComplete, progressOf, startSession } from '../src/session';
import { availableProbeCount, selectNextProbe } from '../src/select';
import { buildPlan } from '../src/plan';

const node = (id: string, prerequisites: string[] = [], extra: Partial<LearningNode> = {}): LearningNode => ({
  id,
  klass: 10,
  subject: 'Science',
  chapter: 'life-processes',
  title: `Topic ${id}`,
  outcome: `Can do ${id}`,
  prerequisites,
  difficulty: 3,
  ...extra,
});

const probe = (nodeId: string, correctIndex = 0): Probe => ({
  id: `p-${nodeId}`,
  nodeId,
  question: `Question about ${nodeId}?`,
  options: ['right', 'wrong-a', 'wrong-b', 'wrong-c'],
  correctIndex,
});

/**
 * A small but realistic map:
 *   fractions -> ratios -> percentages     (a chain worth diagnosing)
 *   cells -> respiration                   (a second chapter, for spread)
 *   trivia                                 (an isolated leaf)
 */
function fixture() {
  const nodes = [
    node('fractions', [], { difficulty: 1 }),
    node('ratios', ['fractions'], { difficulty: 2, lessonRef: 'class10-ratios' }),
    node('percentages', ['ratios'], { difficulty: 3 }),
    node('cells', [], { chapter: 'cell-biology', difficulty: 1 }),
    node('respiration', ['cells'], { chapter: 'cell-biology', difficulty: 3, lessonRef: 'class10-respiration' }),
    node('trivia', [], { difficulty: 2 }),
  ];
  const index = new GraphIndex(loadGraph({ version: 1, nodes }));
  const bank: ProbeBank = { version: 1, probes: nodes.map((n) => probe(n.id)) };
  return { index, bank };
}

const session = (over: Partial<Parameters<typeof startSession>[2]> = {}) => {
  const { index, bank } = fixture();
  return {
    index,
    bank,
    s: startSession(index, bank, { klass: 10, subjects: ['Science'], ...over }),
  };
};

describe('selectNextProbe', () => {
  it('is deterministic — same state gives the same probe', () => {
    const { index, bank, s } = session();
    expect(selectNextProbe(s, index, bank)?.id).toBe(selectNextProbe(s, index, bank)?.id);
  });

  it('never asks about the same node twice', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'] });
    const asked: string[] = [];
    for (let i = 0; i < 6; i++) {
      const next = selectNextProbe(s, index, bank);
      if (!next) break;
      asked.push(next.nodeId);
      s = answerProbe(s, index, next, 0);
    }
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('prefers a connected node over an isolated one, all else equal', () => {
    const { index, bank, s } = session();
    // fractions and trivia are both unprobed at the prior; fractions blocks two
    // other nodes, trivia blocks nothing.
    const first = selectNextProbe(s, index, bank);
    expect(first?.nodeId).not.toBe('trivia');
  });

  it('reaches for something harder after a correct answer', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'] });
    s = answerProbe(s, index, probe('fractions'), 0); // correct, difficulty 1
    const next = selectNextProbe(s, index, bank);
    expect(index.node(next!.nodeId)!.difficulty).toBeGreaterThan(1);
  });

  it('spreads across chapters rather than draining one', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'] });
    const chapters = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const next = selectNextProbe(s, index, bank);
      if (!next) break;
      chapters.add(index.node(next.nodeId)!.chapter);
      s = answerProbe(s, index, next, 0);
    }
    expect(chapters.size).toBeGreaterThan(1);
  });

  it('skips nodes outside the chosen class or subjects', () => {
    const { index, bank } = fixture();
    const s = startSession(index, bank, { klass: 9, subjects: ['Science'] });
    expect(selectNextProbe(s, index, bank)).toBeNull();
    expect(availableProbeCount(s, index, bank)).toBe(0);
  });

  it('returns null once every remaining node has settled', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'] });
    for (const p of bank.probes) s = answerProbe(s, index, p, 0);
    expect(selectNextProbe(s, index, bank)).toBeNull();
  });
});

describe('session', () => {
  it('records correctness and skips', () => {
    const { index, s } = session();
    const right = answerProbe(s, index, probe('fractions'), 0);
    const wrong = answerProbe(s, index, probe('fractions'), 2);
    const skip = answerProbe(s, index, probe('fractions'), null);
    expect(right.answers[0].correct).toBe(true);
    expect(wrong.answers[0].correct).toBe(false);
    expect(skip.answers[0].chosenIndex).toBeNull();
  });

  it('is pure — answering returns a new session', () => {
    const { index, s } = session();
    const next = answerProbe(s, index, probe('fractions'), 0);
    expect(s.answers).toHaveLength(0);
    expect(next.answers).toHaveLength(1);
  });

  it('never finishes before minQuestions', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'], minQuestions: 4 });
    for (const p of bank.probes.slice(0, 3)) s = answerProbe(s, index, p, 0);
    expect(isComplete(s, index)).toBe(false);
  });

  it('finishes at maxQuestions even when nothing has settled', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'], maxQuestions: 3, minQuestions: 1 });
    for (const p of bank.probes.slice(0, 3)) s = answerProbe(s, index, p, null); // all skipped
    expect(isComplete(s, index)).toBe(true);
  });

  it('finishes early once the picture has settled', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, {
      klass: 10, subjects: ['Science'], minQuestions: 2, maxQuestions: 20, confidenceTarget: 0.5,
    });
    for (const p of bank.probes) s = answerProbe(s, index, p, 0);
    expect(isComplete(s, index)).toBe(true);
    expect(s.answers.length).toBeLessThan(20);
  });

  it('reports progress against the ceiling', () => {
    const { index, s } = session({ maxQuestions: 10 });
    const after = answerProbe(s, index, probe('fractions'), 0);
    expect(progressOf(after)).toEqual({ asked: 1, target: 10, fraction: 0.1 });
  });
});

describe('buildPlan', () => {
  /** A student who has lost the foundation: fails fractions, so everything above wobbles. */
  const strugglingSession = () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'] });
    s = answerProbe(s, index, probe('fractions'), 3); // wrong
    s = answerProbe(s, index, probe('percentages'), 3); // wrong
    return { index, s };
  };

  it('puts the broken foundation first', () => {
    const { index, s } = strugglingSession();
    const plan = buildPlan(s, index).plan;
    expect(plan[0].nodeId).toBe('fractions');
  });

  it('never schedules a node before its prerequisite', () => {
    const { index, s } = strugglingSession();
    const plan = buildPlan(s, index).plan;
    const at = (id: string) => plan.findIndex((p) => p.nodeId === id);
    for (const step of plan) {
      for (const prerequisite of index.prerequisitesOf(step.nodeId)) {
        const before = at(prerequisite);
        if (before !== -1) expect(before).toBeLessThan(at(step.nodeId));
      }
    }
  });

  it('caps the plan so it reads as a plan, not a wall', () => {
    const { index, s } = strugglingSession();
    expect(buildPlan(s, index, { maxSteps: 2 }).plan).toHaveLength(2);
  });

  it('says what a blocking node unlocks', () => {
    const { index, s } = strugglingSession();
    const first = buildPlan(s, index).plan[0];
    expect(first.reason).toMatch(/unlock|build/i);
  });

  it('carries lessonRef through so the UI can link into a lesson', () => {
    const { index, s } = strugglingSession();
    const ratios = buildPlan(s, index).plan.find((p) => p.nodeId === 'ratios');
    expect(ratios?.lessonRef).toBe('class10-ratios');
  });

  it('returns an empty plan for a student with no gaps', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'] });
    for (const p of bank.probes) s = answerProbe(s, index, p, 0); // all correct
    const result = buildPlan(s, index);
    expect(result.plan).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it('carries the answers through for auditing', () => {
    const { index, s } = strugglingSession();
    expect(buildPlan(s, index).answers).toHaveLength(2);
  });
});

describe('end to end', () => {
  it('a student who only fails the foundation gets it first in their plan', () => {
    const { index, bank } = fixture();
    let s = startSession(index, bank, { klass: 10, subjects: ['Science'], minQuestions: 1 });

    // Answer honestly: this student knows everything except fractions.
    for (let i = 0; i < 10; i++) {
      const next = selectNextProbe(s, index, bank);
      if (!next) break;
      const knowsIt = next.nodeId !== 'fractions';
      s = answerProbe(s, index, next, knowsIt ? next.correctIndex : 2);
      if (isComplete(s, index)) break;
    }

    const plan = buildPlan(s, index).plan;
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].nodeId).toBe('fractions');
  });
});
