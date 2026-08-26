import { describe, expect, it } from 'vitest';
import type { LearningNode } from '../../../packages/knowledge-graph/src/types.ts';
import type { Chapter } from '../../../packages/syllabus/src/syllabus.ts';
import type { LlmAdapter } from '../src/llm.ts';
import { stripJsonFences } from '../src/llm.ts';
import { buildNodesPrompt, buildProbesPrompt } from '../src/prompt.ts';
import { generateNodes, generateProbes, mergeIntoGraph } from '../src/generate.ts';

const chapter: Chapter = {
  id: 'life-processes',
  title: 'Life Processes',
  topics: [
    {
      id: 'nutrition',
      title: 'Nutrition',
      objectives: ['Student can explain photosynthesis', 'Student can trace human digestion'],
    },
  ],
};

const nodeOpts = {
  syllabusId: 'class10-science',
  klass: 10,
  subject: 'Science',
  existingIds: ['sci10-chem-balance-equation'],
  targetCount: 20,
};

const node = (id: string, prerequisites: string[] = []): LearningNode => ({
  id,
  klass: 10,
  subject: 'Science',
  chapter: 'life-processes',
  title: id,
  outcome: `State the thing called ${id}`,
  prerequisites,
  difficulty: 2,
});

/** Replies in order; records what it was asked. */
function fakeAdapter(...replies: string[]): LlmAdapter & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    async complete(_system: string, user: string) {
      prompts.push(user);
      return replies[Math.min(i++, replies.length - 1)];
    },
  };
}

const nodesReply = (nodes: LearningNode[]) => JSON.stringify({ nodes });

describe('buildNodesPrompt', () => {
  const { system, user } = buildNodesPrompt(chapter, nodeOpts);

  it('teaches atomicity with worked good and bad examples', () => {
    expect(system).toMatch(/Understand photosynthesis/); // the BAD example
    expect(system).toMatch(/Identify that oxygen appears on the product side/); // the GOOD one
    expect(system).toMatch(/observable verb|OBSERVABLE verb/i);
  });

  it('demands an acyclic graph and encourages cross-chapter edges', () => {
    expect(system).toMatch(/ACYCLIC/);
    expect(system).toMatch(/CROSS-CHAPTER/);
  });

  it('offers the existing map as edge targets so batches are not islands', () => {
    expect(user).toContain('sci10-chem-balance-equation');
    expect(user).toMatch(/do NOT\s*\n?re-create/i);
  });

  it('carries the chapter, its topics and their objectives', () => {
    expect(user).toContain('Life Processes');
    expect(user).toContain('Nutrition');
    expect(user).toContain('Student can explain photosynthesis');
  });
});

describe('buildProbesPrompt', () => {
  const { system, user } = buildProbesPrompt([node('a'), node('b')], { klass: 10, subject: 'Science' });

  it('requires a named misconception per wrong option', () => {
    expect(system).toMatch(/misconception/i);
    expect(system).toMatch(/aligned to "options"/i);
  });

  it('bans the lazy distractors', () => {
    expect(system).toMatch(/all of the above/i);
    expect(system).toMatch(/none of the above/i);
  });

  it('lists every node with its outcome', () => {
    expect(user).toContain('id "a"');
    expect(user).toContain('id "b"');
    expect(user).toContain('State the thing called a');
  });
});

describe('generateNodes', () => {
  it('accepts a valid batch', async () => {
    const out = await generateNodes(chapter, fakeAdapter(nodesReply([node('n1'), node('n2', ['n1'])])), nodeOpts);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('accepts an edge pointing into the existing map', async () => {
    const out = await generateNodes(
      chapter,
      fakeAdapter(nodesReply([node('n1', ['sci10-chem-balance-equation'])])),
      nodeOpts,
    );
    expect(out.ok).toBe(true);
  });

  it('rejects a vague outcome and says why', async () => {
    const vague = { ...node('n1'), outcome: 'Understand photosynthesis' };
    const out = await generateNodes(chapter, fakeAdapter(nodesReply([vague]), nodesReply([vague])), nodeOpts);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/not observable/);
  });

  it('rejects a cycle inside the batch and feeds the error back for repair', async () => {
    const cyclic = nodesReply([node('a', ['b']), node('b', ['a'])]);
    const adapter = fakeAdapter(cyclic, nodesReply([node('a'), node('b', ['a'])]));
    const out = await generateNodes(chapter, adapter, nodeOpts);

    expect(out.ok).toBe(true); // the repair succeeded
    expect(adapter.prompts).toHaveLength(2);
    expect(adapter.prompts[1]).toMatch(/cycle/);
  });

  it('rejects a dangling prerequisite', async () => {
    const bad = nodesReply([node('n1', ['ghost'])]);
    const out = await generateNodes(chapter, fakeAdapter(bad, bad), nodeOpts);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/"ghost" is not in this batch/);
  });

  it('rejects an id that already exists in the map', async () => {
    const clash = nodesReply([node('sci10-chem-balance-equation')]);
    const out = await generateNodes(chapter, fakeAdapter(clash, clash), nodeOpts);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/already exists/);
  });

  it('repairs unparseable JSON', async () => {
    const adapter = fakeAdapter('not json at all', nodesReply([node('n1')]));
    const out = await generateNodes(chapter, adapter, nodeOpts);
    expect(out.ok).toBe(true);
    expect(adapter.prompts[1]).toMatch(/not valid JSON/);
  });

  it('gives up after one repair, preserving the raw reply', async () => {
    const out = await generateNodes(chapter, fakeAdapter('garbage', 'still garbage'), nodeOpts);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.raw).toBe('still garbage');
  });
});

describe('generateProbes', () => {
  const nodes = [node('a'), node('b')];
  const probe = (nodeId: string, over: Record<string, unknown> = {}) => ({
    id: `probe-${nodeId}`,
    nodeId,
    question: `What about ${nodeId}?`,
    options: ['right', 'w1', 'w2', 'w3'],
    correctIndex: 0,
    // Sentence-length on purpose: a misconception has to say WHY a student
    // would pick that option, and the validator now holds it to that.
    misconceptions: ['', 'confuses cause with effect', 'reverses the direction', 'recalls the wrong stage'],
    ...over,
  });
  const reply = (probes: unknown[]) => JSON.stringify({ probes });

  it('accepts a well-formed bank', async () => {
    const out = await generateProbes(nodes, fakeAdapter(reply([probe('a'), probe('b')])), {
      klass: 10,
      subject: 'Science',
    });
    expect(out.ok).toBe(true);
  });

  it('rejects the wrong number of options', async () => {
    const bad = reply([probe('a', { options: ['x', 'y', 'z'] }), probe('b')]);
    const out = await generateProbes(nodes, fakeAdapter(bad, bad), { klass: 10, subject: 'Science' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/exactly 4/);
  });

  it('rejects an out-of-range correctIndex', async () => {
    const bad = reply([probe('a', { correctIndex: 7 }), probe('b')]);
    const out = await generateProbes(nodes, fakeAdapter(bad, bad), { klass: 10, subject: 'Science' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/correctIndex/);
  });

  it('rejects duplicate options and banned distractors', async () => {
    const dupes = reply([probe('a', { options: ['x', 'x', 'y', 'z'] }), probe('b')]);
    const banned = reply([probe('a', { options: ['x', 'y', 'z', 'All of the above'] }), probe('b')]);
    const d = await generateProbes(nodes, fakeAdapter(dupes, dupes), { klass: 10, subject: 'Science' });
    const b = await generateProbes(nodes, fakeAdapter(banned, banned), { klass: 10, subject: 'Science' });
    expect(d.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(' ')).toMatch(/all of the above/i);
  });

  it('rejects a misconception written against the correct option', async () => {
    const bad = reply([probe('a', { misconceptions: ['wrong here', 'm1', 'm2', 'm3'] }), probe('b')]);
    const out = await generateProbes(nodes, fakeAdapter(bad, bad), { klass: 10, subject: 'Science' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/misconceptions\[correctIndex\]/);
  });

  it('rejects a bank that skips a node', async () => {
    const bad = reply([probe('a')]);
    const out = await generateProbes(nodes, fakeAdapter(bad, bad), { klass: 10, subject: 'Science' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/no probe was written for: b/);
  });
});

describe('mergeIntoGraph', () => {
  const existing = { version: 1 as const, nodes: [node('base')] };

  it('appends a clean batch', () => {
    const out = mergeIntoGraph(existing, [node('new', ['base'])]);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.nodes).toHaveLength(2);
  });

  it('rejects an id collision', () => {
    const out = mergeIntoGraph(existing, [node('base')]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/id collision/);
  });

  it('rejects a merge that creates a cycle ACROSS the boundary', () => {
    // Each side is acyclic alone; together they close a loop. This is the case
    // a per-batch check cannot catch, and the reason the merge re-validates.
    const withEdge = { version: 1 as const, nodes: [node('base', ['incoming'])] };
    const out = mergeIntoGraph(withEdge, [node('incoming', ['base'])]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/cycle/);
  });

  it('rejects a batch with an unresolvable edge', () => {
    const out = mergeIntoGraph(existing, [node('new', ['nowhere'])]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/does not exist/);
  });
});

describe('stripJsonFences', () => {
  it('unwraps fenced JSON and leaves plain JSON alone', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFences('{"a":1}')).toBe('{"a":1}');
  });
});
