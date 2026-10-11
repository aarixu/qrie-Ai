import { describe, expect, it } from 'vitest';
import { bankProblems } from '../../../packages/knowledge-graph/src/probes.ts';
import type { KnowledgeGraph, LearningNode, Probe, ProbeRole } from '../../../packages/knowledge-graph/src/types.ts';
import type { LlmAdapter } from '../src/llm.ts';
import {
  addMoreProbes,
  generateMoreProbes,
  planMoreProbes,
  reviewProbes,
  type MoreRequest,
} from '../src/moreProbes.ts';
import { buildLabelCheckPrompt, buildMoreProbesPrompt, buildSolvePrompt } from '../src/prompt.ts';

/**
 * MORE THAN ONE QUESTION PER OUTCOME (lam-one-brain Task 16).
 *
 * Every test here runs on a fake LLM adapter: no model is called.
 */

const node = (id: string): LearningNode => ({
  id,
  klass: 10,
  subject: 'Science',
  chapter: 'life-processes',
  title: id,
  outcome: `State the thing called ${id}`,
  prerequisites: [],
  difficulty: 2,
});

const first = (nodeId: string): Probe => ({
  id: `probe-${nodeId}`,
  nodeId,
  question: `What is ${nodeId}?`,
  options: ['right one', 'wrong one', 'wrong two', 'wrong three'],
  correctIndex: 0,
  misconceptions: ['', 'confuses cause with effect', 'reverses the direction', 'recalls the wrong stage'],
});

/** What a writer replies for one (node, role): the right option starts with "right". */
const written = (nodeId: string, role: ProbeRole, over: Record<string, unknown> = {}) => ({
  nodeId,
  role,
  question: `A ${role} question about ${nodeId}?`,
  options: ['right answer', 'wrong answer a', 'wrong answer b', 'wrong answer c'],
  correctIndex: 0,
  misconceptions: ['', 'thinks the cause is the effect', 'reads the step backwards', 'mixes up the two stages'],
  ...over,
});

type Item = { ref: string; options: string[]; correctIndex?: number; misconceptions?: string[] };
/** The items a checking prompt lists, read back out of it the way a model would read them. */
const itemsIn = (user: string): Item[] => JSON.parse(user.slice(user.indexOf('['))) as Item[];

/**
 * A fake model with three jobs, told apart by the prompt it is given: the
 * writer replies `writes` in turn; the solver answers the option that starts
 * with "right"; the label checker calls a label bad when it says "BAD".
 */
function fake(writes: string[], opts: { solver?: (item: Item) => number | null; failChecks?: boolean } = {}) {
  const calls: { job: 'write' | 'solve' | 'labels'; system: string; user: string }[] = [];
  let w = 0;
  const adapter: LlmAdapter = {
    async complete(system, user) {
      if (system.startsWith('You check a question bank by answering')) {
        calls.push({ job: 'solve', system, user });
        if (opts.failChecks) throw new Error('quota');
        const solve = opts.solver ?? ((it: Item) => it.options.findIndex((o) => o.startsWith('right')));
        return JSON.stringify({ answers: itemsIn(user).map((it) => ({ ref: it.ref, answerIndex: solve(it) })) });
      }
      if (system.startsWith('You check the wrong-option labels')) {
        calls.push({ job: 'labels', system, user });
        return JSON.stringify({
          reviews: itemsIn(user).map((it) => ({
            ref: it.ref,
            bad: (it.misconceptions ?? []).flatMap((m, i) => (m.includes('BAD') ? [i] : [])),
          })),
        });
      }
      calls.push({ job: 'write', system, user });
      return writes[Math.min(w++, writes.length - 1)];
    },
  };
  return { adapter, calls };
}

const reply = (probes: unknown[]) => JSON.stringify({ probes });
const opts = { klass: 10, subject: 'Science' };

describe('planMoreProbes', () => {
  const graph: KnowledgeGraph = { version: 1, nodes: [node('a'), node('b'), node('c')] };

  it('asks for the roles a node with a first question lacks, and skips a node without one', () => {
    const bank = [first('a'), first('b'), { ...first('b'), id: 'probe-b-retest', question: 'Again b?', role: 'retest' as const }];
    const plan = planMoreProbes(graph, bank, ['retest', 'review'], () => true);
    expect(plan.map((r) => [r.node.id, r.roles])).toEqual([
      ['a', ['retest', 'review']],
      ['b', ['review']],
    ]);
    expect(plan[1].existing.map((p) => p.id)).toEqual(['probe-b', 'probe-b-retest']);
  });

  it('keeps to the chapters in scope', () => {
    expect(planMoreProbes(graph, [first('a')], ['retest'], (ch) => ch !== 'life-processes')).toEqual([]);
  });
});

describe('buildMoreProbesPrompt', () => {
  const requests: MoreRequest[] = [{ node: node('a'), existing: [first('a')], roles: ['retest', 'transfer'] }];
  const { system, user } = buildMoreProbesPrompt(requests, opts);

  it('names each role and what it is for', () => {
    expect(system).toMatch(/"retest"/);
    expect(system).toMatch(/"transfer"/);
    expect(system).toMatch(/misconceptions/);
  });

  it('shows the questions the node already has, so none is repeated', () => {
    expect(user).toContain('What is a?');
    expect(user).toMatch(/retest, transfer/);
    expect(user).toContain('State the thing called a');
  });
});

describe('generateMoreProbes', () => {
  const requests: MoreRequest[] = [
    { node: node('a'), existing: [first('a')], roles: ['retest', 'review'] },
    { node: node('b'), existing: [first('b')], roles: ['retest'] },
  ];
  const good = reply([written('a', 'retest'), written('a', 'review'), written('b', 'retest')]);

  it('gives each new question its role, an id of its own beside the first, and the same shape', async () => {
    const out = await generateMoreProbes(requests, fake([good]).adapter, opts, [first('a'), first('b')]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.map((p) => [p.id, p.nodeId, p.role])).toEqual([
      ['probe-a-retest', 'a', 'retest'],
      ['probe-a-review', 'a', 'review'],
      ['probe-b-retest', 'b', 'retest'],
    ]);
    for (const p of out.value) {
      expect(p.options).toHaveLength(4);
      expect(p.misconceptions?.[p.correctIndex]).toBe('');
      expect(p.options[p.correctIndex]).toBe('right answer');
    }
    expect(bankProblems([first('a'), first('b'), ...out.value])).toEqual([]);
  });

  it('never takes an id the bank already holds', async () => {
    const taken = { ...first('z'), id: 'probe-a-retest', nodeId: 'z' };
    const out = await generateMoreProbes(requests, fake([good]).adapter, opts, [first('a'), first('b'), taken]);
    expect(out.ok && out.value[0].id).toBe('probe-a-retest-2');
  });

  it('refuses a stem the node already has, however it is spaced or cased, and repairs once', async () => {
    const repeat = reply([written('a', 'retest', { question: '  what IS a ' }), written('a', 'review'), written('b', 'retest')]);
    const { adapter, calls } = fake([repeat, good]);
    const out = await generateMoreProbes(requests, adapter, opts, [first('a'), first('b')]);
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toMatch(/repeats a question node "a" already has/);
  });

  it('refuses two new questions with one stem, a role not asked for, and a missing one', async () => {
    const bad = reply([
      written('a', 'retest', { question: 'Same?' }),
      written('a', 'review', { question: 'same' }),
      written('b', 'transfer'),
    ]);
    const out = await generateMoreProbes(requests, fake([bad, bad]).adapter, opts, [first('a'), first('b')]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const errors = out.errors.join(' | ');
    expect(errors).toMatch(/repeats another new question for node "a"/);
    expect(errors).toMatch(/role "transfer" was not asked for node "b"/);
    expect(errors).toMatch(/no retest question was written for node "b"/);
  });

  it('holds a new question to the shape of the first: four options, a key, a reason per wrong one', async () => {
    const bad = reply([
      written('a', 'retest', { options: ['x', 'y', 'z'] }),
      written('a', 'review', { misconceptions: ['', 'm', 'reads the step backwards', 'mixes up the two stages'] }),
      written('b', 'retest', { misconceptions: undefined }),
    ]);
    const out = await generateMoreProbes(requests, fake([bad, bad]).adapter, opts, [first('a'), first('b')]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const errors = out.errors.join(' | ');
    expect(errors).toMatch(/exactly 4/);
    expect(errors).toMatch(/WHY a student would pick it/);
    expect(errors).toMatch(/needs "misconceptions"/);
  });
});

describe('reviewProbes: an independent check of each key and each wrong-option label', () => {
  const made = (id: string, over: Partial<Probe> = {}): Probe => ({
    id,
    nodeId: 'a',
    role: 'retest',
    question: `${id}?`,
    options: ['wrong answer a', 'right answer', 'wrong answer b', 'wrong answer c'],
    correctIndex: 1,
    misconceptions: ['thinks the cause is the effect', '', 'reads the step backwards', 'mixes up the two stages'],
    ...over,
  });

  it('keeps what it confirms, and drops a key it answers differently and a label it does not believe', async () => {
    const { adapter, calls } = fake([]);
    const out = await reviewProbes(
      [
        made('ok'),
        made('wrong-key', { correctIndex: 2, misconceptions: ['thinks the cause is the effect', 'some reason here', '', 'x reason'] }),
        made('bad-label', { misconceptions: ['BAD label', '', 'reads the step backwards', 'mixes up the two stages'] }),
      ],
      adapter,
      opts,
    );
    expect(out.kept.map((p) => p.id)).toEqual(['ok']);
    expect(out.dropped).toEqual([
      { id: 'wrong-key', reason: 'the checker answered option 1, the key says 2' },
      { id: 'bad-label', reason: 'the checker does not believe the label of option 0' },
    ]);
    // The solver is never shown the key or the labels, which would give the key away.
    const solve = calls.find((c) => c.job === 'solve')!;
    expect(solve.user).not.toMatch(/correctIndex|misconceptions|reads the step backwards/);
  });

  it('drops a question the checker would not answer, or left out', async () => {
    const { adapter } = fake([], { solver: (it) => (it.ref === 'q1' ? null : 1) });
    const out = await reviewProbes([made('none'), made('fine')], adapter, opts);
    expect(out.kept.map((p) => p.id)).toEqual(['fine']);
    expect(out.dropped).toEqual([{ id: 'none', reason: 'the checker found no single right option' }]);
  });

  it('drops everything when the check cannot run: what it cannot confirm does not go in', async () => {
    const { adapter } = fake([], { failChecks: true });
    const out = await reviewProbes([made('x'), made('y')], adapter, opts);
    expect(out.kept).toEqual([]);
    expect(out.dropped.map((d) => d.id)).toEqual(['x', 'y']);
    expect(out.dropped[0].reason).toMatch(/the check failed: quota/);
  });
});

describe('the check prompts', () => {
  const p: Probe = { ...first('a'), role: 'retest', id: 'probe-a-retest' };

  it('the solver sees the question and the options only', () => {
    const { user } = buildSolvePrompt([p], opts);
    expect(user).toContain('What is a?');
    expect(user).toContain('right one');
    expect(user).not.toContain('confuses cause with effect');
    expect(user).not.toContain('probe-a-retest');
  });

  it('the label checker sees the key and each wrong option\'s label', () => {
    const { user } = buildLabelCheckPrompt([p], opts);
    expect(user).toContain('confuses cause with effect');
    expect(user).toMatch(/"correctIndex": ?0/);
  });
});

describe('addMoreProbes: the run', () => {
  const graph: KnowledgeGraph = { version: 1, nodes: [node('a'), node('b')] };

  it('adds what was confirmed, saves batch by batch, and a second run asks for nothing', async () => {
    let bank: Probe[] = [first('a'), first('b')];
    const saves: number[] = [];
    const save = (incoming: readonly Probe[]) => {
      bank = [...bank, ...incoming];
      saves.push(incoming.length);
    };
    const writes = [
      reply([written('a', 'retest'), written('a', 'review')]),
      reply([written('b', 'retest'), written('b', 'review', { misconceptions: ['', 'BAD one', 'reads the step backwards', 'mixes up the two stages'] })]),
    ];
    const { adapter } = fake(writes);
    const tally = await addMoreProbes({
      graph, probes: bank, roles: ['retest', 'review'], inScope: () => true, adapter, ...opts, batchNodes: 1, save,
    });
    expect(tally).toEqual({ requested: 4, added: 3, dropped: 1, failed: 0 });
    expect(saves).toEqual([2, 1]);
    expect(bank.filter((p) => p.role).map((p) => p.id).sort()).toEqual(['probe-a-retest', 'probe-a-review', 'probe-b-retest']);
    expect(bankProblems(bank)).toEqual([]);

    // Resumable: only the question the check dropped is asked for again.
    const again = fake([reply([written('b', 'review')])]);
    const second = await addMoreProbes({
      graph, probes: bank, roles: ['retest', 'review'], inScope: () => true, adapter: again.adapter, ...opts, save,
    });
    expect(second).toEqual({ requested: 1, added: 1, dropped: 0, failed: 0 });
    expect(again.calls.filter((c) => c.job === 'write')[0].user).toMatch(/node "b"[\s\S]*review/);

    const third = fake([]);
    expect(
      await addMoreProbes({ graph, probes: bank, roles: ['retest', 'review'], inScope: () => true, adapter: third.adapter, ...opts, save }),
    ).toEqual({ requested: 0, added: 0, dropped: 0, failed: 0 });
    expect(third.calls).toEqual([]);
  });

  it('a batch the writer cannot get right costs that batch, not the run', async () => {
    let bank: Probe[] = [first('a'), first('b')];
    const { adapter } = fake(['not json', 'not json', reply([written('b', 'retest')])]);
    const tally = await addMoreProbes({
      graph, probes: bank, roles: ['retest'], inScope: () => true, adapter, ...opts, batchNodes: 1,
      save: (incoming) => {
        bank = [...bank, ...incoming];
      },
    });
    expect(tally).toEqual({ requested: 2, added: 1, dropped: 0, failed: 1 });
    expect(bank.map((p) => p.id)).toEqual(['probe-a', 'probe-b', 'probe-b-retest']);
  });
});
