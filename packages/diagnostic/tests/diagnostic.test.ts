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

  // Task 16: a node may hold its first question and further ones. Placement
  // asks each node once, by its first question; the further ones are for
  // later (a retest, a review). Their ids sort first here on purpose.
  describe('with several questions per node', () => {
    const several = () => {
      const { index, bank } = fixture();
      const extra = bank.probes.map((p) => ({
        ...p,
        id: `0-${p.nodeId}-retest`,
        question: `Another way to ask about ${p.nodeId}?`,
        role: 'retest' as const,
      }));
      return { index, bank: { version: 1 as const, probes: [...extra, ...bank.probes] } };
    };

    it('asks a node by its first question, and only once', () => {
      const { index, bank } = several();
      let s = startSession(index, bank, { klass: 10, subjects: ['Science'] });
      const asked: Probe[] = [];
      for (let i = 0; i < 10; i++) {
        const next = selectNextProbe(s, index, bank);
        if (!next) break;
        asked.push(next);
        s = answerProbe(s, index, next, 0);
      }
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((p) => p.role === undefined)).toBe(true);
      expect(new Set(asked.map((p) => p.nodeId)).size).toBe(asked.length);
    });

    it('counts the nodes it could still ask, not the questions', () => {
      const { index, bank } = several();
      const s = startSession(index, bank, { klass: 10, subjects: ['Science'] });
      expect(availableProbeCount(s, index, bank)).toBe(6);
    });
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

describe('lookBack — placement reaches into earlier classes', () => {
  /** A two-class map: Class 9 percentages rest on Class 8 and Class 7 ground. */
  function crossClassFixture() {
    // A real prerequisite chain across the classes — isolated nodes carry no
    // information, and a probe with nothing to infer is never worth asking.
    const nodes = [
      node('c6-counting', [], { klass: 6, chapter: 'counting', difficulty: 1 }),
      node('c7-fractions', ['c6-counting'], { klass: 7, chapter: 'fractions', difficulty: 1 }),
      node('c8-ratios', ['c7-fractions'], { klass: 8, chapter: 'ratios', difficulty: 2 }),
      node('c9-percentages', ['c8-ratios'], { klass: 9, chapter: 'percentages', difficulty: 3 }),
    ];
    const index = new GraphIndex(loadGraph({ version: 1, nodes }));
    const bank: ProbeBank = { version: 1, probes: nodes.map((n) => probe(n.id)) };
    return { index, bank };
  }

  it('with lookBack 0 only the student class is askable (the old behaviour)', () => {
    const { index, bank } = crossClassFixture();
    const s = startSession(index, bank, { klass: 9, subjects: ['Science'] });
    expect(availableProbeCount(s, index, bank)).toBe(1); // c9-percentages alone
  });

  it('with lookBack 2 the two classes behind come into scope, no further', () => {
    const { index, bank } = crossClassFixture();
    const s = startSession(index, bank, { klass: 9, subjects: ['Science'], lookBack: 2 });
    // c9, c8, c7 — and never c6, and never anything above the student.
    expect(availableProbeCount(s, index, bank)).toBe(3);
  });

  it('never asks above the student class, whatever the lookBack', () => {
    const { index, bank } = crossClassFixture();
    const s = startSession(index, bank, { klass: 7, subjects: ['Science'], lookBack: 5 });
    expect(availableProbeCount(s, index, bank)).toBe(2); // c7 + c6, never c8/c9
  });

  it('the plan may prescribe an earlier-class node', () => {
    const { index, bank } = crossClassFixture();
    let s = startSession(index, bank, {
      klass: 9,
      subjects: ['Science'],
      lookBack: 2,
      minQuestions: 1,
      maxQuestions: 4,
    });
    // Fail everything the test asks; whatever settles low is a gap.
    for (let i = 0; i < 4; i += 1) {
      const p = selectNextProbe(s, index, bank);
      if (!p) break;
      s = answerProbe(s, index, p, (p.correctIndex + 1) % 4);
    }
    const result = buildPlan(s, index);
    const klasses = result.plan.map((step) => index.node(step.nodeId)!.klass);
    expect(Math.min(...klasses)).toBeLessThan(9); // reached behind the student's class
    expect(Math.max(...klasses)).toBeLessThanOrEqual(9);
  });
});

describe('the plan interleaves without breaking prerequisites', () => {
  /** Two independent three-step chains, in different chapters. */
  function twoChains() {
    const nodes = [
      node('m1', [], { chapter: 'maths', difficulty: 1 }),
      node('m2', ['m1'], { chapter: 'maths', difficulty: 2 }),
      node('m3', ['m2'], { chapter: 'maths', difficulty: 3 }),
      node('s1', [], { chapter: 'science', difficulty: 1 }),
      node('s2', ['s1'], { chapter: 'science', difficulty: 2 }),
      node('s3', ['s2'], { chapter: 'science', difficulty: 3 }),
    ];
    const index = new GraphIndex(loadGraph({ version: 1, nodes }));
    const bank: ProbeBank = { version: 1, probes: nodes.map((n) => probe(n.id)) };
    return { index, bank, nodes };
  }

  /** Everything is a gap, so the plan has to order all six. */
  const allWrong = () => {
    const { index, bank, nodes } = twoChains();
    let s = startSession(index, bank, {
      klass: 10,
      subjects: ['Science'],
      minQuestions: 1,
      maxQuestions: nodes.length,
    });
    for (let i = 0; i < nodes.length; i += 1) {
      const p = selectNextProbe(s, index, bank);
      if (!p) break;
      s = answerProbe(s, index, p, (p.correctIndex + 1) % 4);
    }
    return { plan: buildPlan(s, index).plan, index };
  };

  it('never teaches a step before something it rests on', () => {
    const { plan, index } = allWrong();
    const position = new Map(plan.map((step, i) => [step.nodeId, i]));
    for (const step of plan) {
      for (const prerequisite of index.prerequisitesOf(step.nodeId)) {
        const before = position.get(prerequisite);
        if (before === undefined) continue; // not in the plan at all
        expect(before, `${prerequisite} must come before ${step.nodeId}`).toBeLessThan(
          position.get(step.nodeId)!,
        );
      }
    }
  });

  it('mixes the chapters rather than blocking one after the other', () => {
    const { plan, index } = allWrong();
    const chapters = plan.map((s) => index.node(s.nodeId)!.chapter);
    // Blocked practice would be maths,maths,maths,science,science,science:
    // exactly one switch. Interleaving has to do better than that.
    const switches = chapters.filter((c, i) => i > 0 && c !== chapters[i - 1]).length;
    expect(switches).toBeGreaterThan(1);
  });

  it('is deterministic — the same gaps give the same plan', () => {
    expect(allWrong().plan.map((s) => s.nodeId)).toEqual(allWrong().plan.map((s) => s.nodeId));
  });
});
