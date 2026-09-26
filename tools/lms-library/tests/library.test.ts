// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fingerprint, libraryItems, loadBanks, type LibraryItem } from '../src/library.ts';

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

describe('the real banks', () => {
  it('load as 4,697 items across all 13 banks, each with a unique ref', () => {
    const items = libraryItems(loadBanks());
    expect(items).toHaveLength(4697);
    expect(new Set(items.map((i) => i.libraryRef)).size).toBe(4697);
    expect(new Set(items.map((i) => `${i.grade} ${i.subject}`)).size).toBe(13);
  });
});
