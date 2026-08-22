import { describe, expect, it } from 'vitest';
import { GraphIndex, loadGraph } from '../src/graph';
import type { LearningNode } from '../src/types';

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

const graph = (nodes: LearningNode[]) => ({ version: 1 as const, nodes });

/** A -> B, A -> C, B -> D, C -> D  (arrows point from prerequisite to dependent) */
const diamond = () =>
  loadGraph(
    graph([node('A'), node('B', ['A']), node('C', ['A']), node('D', ['B', 'C'])]),
  );

describe('loadGraph', () => {
  it('accepts a valid graph', () => {
    expect(diamond().nodes).toHaveLength(4);
  });

  it('rejects a non-object and a wrong version', () => {
    expect(() => loadGraph('nope')).toThrow(/must be a JSON object/);
    expect(() => loadGraph({ version: 2, nodes: [node('A')] })).toThrow(/version/);
  });

  it('rejects an empty node list', () => {
    expect(() => loadGraph(graph([]))).toThrow(/non-empty nodes/);
  });

  it('rejects duplicate ids, naming the id', () => {
    expect(() => loadGraph(graph([node('A'), node('A')]))).toThrow(/duplicate node id "A"/);
  });

  it('rejects a dangling prerequisite, naming both ends', () => {
    expect(() => loadGraph(graph([node('B', ['ghost'])]))).toThrow(/"ghost" does not exist/);
  });

  it('rejects a self-prerequisite', () => {
    expect(() => loadGraph(graph([node('A', ['A'])]))).toThrow(/own prerequisite/);
  });

  it('rejects a cycle and names a node in the loop', () => {
    const cyclic = graph([node('A', ['C']), node('B', ['A']), node('C', ['B'])]);
    expect(() => loadGraph(cyclic)).toThrow(/cycle/);
    expect(() => loadGraph(cyclic)).toThrow(/A|B|C/);
  });

  it('rejects out-of-range klass and difficulty', () => {
    expect(() => loadGraph(graph([node('A', [], { klass: 5 })]))).toThrow(/klass/);
    expect(() => loadGraph(graph([node('A', [], { difficulty: 9 })]))).toThrow(/difficulty/);
  });

  it('allows forward references — edges resolve after every id is known', () => {
    expect(() => loadGraph(graph([node('B', ['A']), node('A')]))).not.toThrow();
  });
});

describe('GraphIndex traversal', () => {
  const index = () => new GraphIndex(diamond());

  it('reports direct edges in both directions', () => {
    expect(index().prerequisitesOf('D')).toEqual(['B', 'C']);
    expect(index().dependentsOf('A').sort()).toEqual(['B', 'C']);
  });

  it('computes transitive ancestors and descendants', () => {
    expect([...index().ancestorsOf('D')].sort()).toEqual(['A', 'B', 'C']);
    expect([...index().descendantsOf('A')].sort()).toEqual(['B', 'C', 'D']);
    expect([...index().ancestorsOf('A')]).toEqual([]);
  });

  it('blockCount is how much a node holds back', () => {
    expect(index().blockCount('A')).toBe(3);
    expect(index().blockCount('D')).toBe(0);
  });

  it('measures distance to an ancestor, and -1 when unrelated', () => {
    const i = index();
    expect(i.distanceToAncestor('D', 'D')).toBe(0);
    expect(i.distanceToAncestor('D', 'B')).toBe(1);
    expect(i.distanceToAncestor('D', 'A')).toBe(2);
    expect(i.distanceToAncestor('A', 'D')).toBe(-1);
  });

  it('topoOrder puts prerequisites first', () => {
    const order = index().topoOrder();
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
  });

  it('finds roots and filters', () => {
    expect(index().roots()).toEqual(['A']);
    expect(index().filter({ subject: 'Science' })).toHaveLength(4);
    expect(index().filter({ subject: 'Maths' })).toHaveLength(0);
    expect(index().filter({ klass: 9 })).toHaveLength(0);
  });

  it('handles a deep chain without blowing the stack', () => {
    // Recursive closure would fail here; the implementation is iterative.
    const nodes = Array.from({ length: 5000 }, (_, i) =>
      node(`n${i}`, i === 0 ? [] : [`n${i - 1}`]),
    );
    const deep = new GraphIndex(loadGraph(graph(nodes)));
    expect(deep.ancestorsOf('n4999').size).toBe(4999);
    expect(deep.blockCount('n0')).toBe(4999);
  });
});
