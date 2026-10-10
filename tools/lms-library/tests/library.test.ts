// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fingerprint, libraryItems, loadBanks, outcomes, withoutOldBooks, type LibraryItem } from '../src/library.ts';

const graph = {
  version: 1 as const,
  nodes: [
    {
      id: 'sci8-x',
      klass: 8,
      subject: 'Science',
      chapter: 'c',
      title: 't',
      outcome: 'o',
      prerequisites: [],
      difficulty: 1,
      topicRef: 'class8-science/c/t',
    },
  ],
};
const probes = {
  version: 1 as const,
  probes: [
    {
      id: 'probe-sci8-x',
      nodeId: 'sci8-x',
      question: 'Why?',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 2,
      misconceptions: ['m0', 'm1', '', 'm3'],
    },
  ],
};

describe('libraryItems', () => {
  it('turns a probe and its node into a library item', () => {
    expect(libraryItems([{ name: 'class8-science', graph, probes }])).toEqual([
      {
        libraryRef: 'probe-sci8-x',
        outcomeIds: ['sci8-x'],
        grade: 8,
        subject: 'Science',
        stem: 'Why?',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 2,
        misconceptions: ['m0', 'm1', '', 'm3'],
      },
    ]);
  });

  it('refuses a probe whose node is missing, rather than guess its class', () => {
    const orphan = { version: 1 as const, probes: [{ ...probes.probes[0], nodeId: 'nope' }] };
    expect(() => libraryItems([{ name: 'class8-science', graph, probes: orphan }])).toThrow(
      /class8-science: probe-sci8-x points at node "nope"/,
    );
  });

  it('fingerprints exactly what a teacher approves: the question, the options and the key', () => {
    const [item] = libraryItems([{ name: 'b', graph, probes }]);
    const relabelled: LibraryItem = { ...item, misconceptions: [] };
    expect(fingerprint(item)).toBe(fingerprint(relabelled));
    expect(fingerprint(item)).not.toBe(fingerprint({ ...item, correctIndex: 1 }));
    expect(fingerprint(item)).not.toBe(fingerprint({ ...item, stem: 'Why not?' }));
  });
});

describe('withoutOldBooks', () => {
  const node = (id: string, klass: number) => ({ ...graph.nodes[0], id, klass, topicRef: `class${klass}-science/c/${id}` });
  const probe = (nodeId: string) => ({ ...probes.probes[0], id: `probe-${nodeId}`, nodeId });
  const bank = (name: string, ...nodes: { id: string; klass: number }[]) => ({
    name,
    graph: { version: 1 as const, nodes: nodes.map((n) => node(n.id, n.klass)) },
    probes: { version: 1 as const, probes: nodes.map((n) => probe(n.id)) },
  });

  it('keeps Classes 10 and up, and counts what it leaves out by the class of each outcome', () => {
    const { kept, skipped } = withoutOldBooks([
      bank('class8-science', { id: 'a', klass: 8 }, { id: 'b', klass: 8 }),
      bank('class10-science', { id: 'c', klass: 10 }),
      bank('class6-mathematics', { id: 'd', klass: 6 }),
    ]);
    expect(kept.map((b) => b.name)).toEqual(['class10-science']);
    expect(libraryItems(kept).map((i) => i.grade)).toEqual([10]);
    expect(outcomes(kept).map((o) => o.grade)).toEqual([10]);
    expect(skipped).toEqual([
      { grade: 6, items: 1, outcomes: 1, banks: ['class6-mathematics'] },
      { grade: 8, items: 2, outcomes: 2, banks: ['class8-science'] },
    ]);
  });

  it('goes by each outcome’s class, not the bank’s name: a mixed bank keeps only its newer part', () => {
    const { kept, skipped } = withoutOldBooks([bank('mixed', { id: 'a', klass: 9 }, { id: 'b', klass: 10 })]);
    expect(libraryItems(kept).map((i) => i.libraryRef)).toEqual(['probe-b']);
    expect(outcomes(kept).map((o) => o.id)).toEqual(['b']);
    expect(skipped).toEqual([{ grade: 9, items: 1, outcomes: 1, banks: ['mixed'] }]);
  });

  it('still refuses a probe whose node is missing, rather than drop it quietly', () => {
    const orphan = { name: 'x', graph, probes: { version: 1 as const, probes: [{ ...probes.probes[0], nodeId: 'nope' }] } };
    expect(() => libraryItems(withoutOldBooks([orphan]).kept)).toThrow(/points at node "nope"/);
  });
});

describe('the real banks', () => {
  it('load as 4,697 items across all 13 banks, each with a unique ref', () => {
    const items = libraryItems(loadBanks());
    expect(items).toHaveLength(4697);
    expect(new Set(items.map((i) => i.libraryRef)).size).toBe(4697);
    expect(new Set(items.map((i) => `${i.grade} ${i.subject}`)).size).toBe(13);
  });
});

describe('outcomes', () => {
  it('gives every outcome a library question names its class, subject, chapter and title', () => {
    const banks = loadBanks();
    const byId = new Map(outcomes(banks).map((o) => [o.id, o]));
    for (const item of libraryItems(banks)) {
      for (const id of item.outcomeIds) {
        const o = byId.get(id);
        expect(o, id).toBeDefined();
        expect(o).toMatchObject({ grade: item.grade, subject: item.subject });
        expect(o!.chapter.length).toBeGreaterThan(0);
        expect(o!.title.length).toBeGreaterThan(0);
      }
    }
  });
});
