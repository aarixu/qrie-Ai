import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_OUTCOMES, outcomesForTopic } from '../src/lib/topicOutcomes';
import { profileStore } from '../src/stores/profile';
import { settingsStore } from '../src/stores/settings';

/**
 * The one join between a class and the map that measures it.
 *
 * The failure this guards is silent by construction: when the planner is shown
 * no outcome ids it invents plausible ones, every id misses, and the class is
 * taught, tested and recorded as having taught nothing. Nothing throws. So the
 * tests here are mostly about the empty answer being honest rather than
 * accidental — an empty list makes the prompt say nothing about outcomes,
 * which is the safe state; a WRONG list is the unsafe one.
 */

const DATA_DIR = path.resolve(__dirname, '../../../packages/knowledge-graph/data');
const graph = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'class9-science.json'), 'utf8')) as {
  nodes: { id: string; outcome: string; topicRef?: string; difficulty: number }[];
};

/** A topic the committed map actually covers, chosen from the data itself. */
const knownRef = graph.nodes.find((n) => n.topicRef)!.topicRef!;
const nodesUnder = graph.nodes.filter((n) => n.topicRef === knownRef);

const asClass9Science = () => {
  localStorage.clear();
  profileStore.set({
    name: null,
    klass: 9,
    subjects: ['Science'],
    diagnostic: null,
    diagnosedAt: null,
  });
  settingsStore.update((s) => ({ ...s, klass: 9 }));
};

beforeEach(asClass9Science);

describe('outcomesForTopic', () => {
  it('gives the map\u2019s own words for a topic it covers', () => {
    const got = outcomesForTopic(knownRef);
    expect(got.length).toBeGreaterThan(0);

    // Every id must exist in the map, or the whole exercise is pointless.
    const real = new Set(graph.nodes.map((n) => n.id));
    for (const outcome of got) {
      expect(real.has(outcome.id)).toBe(true);
      expect(outcome.statement.length).toBeGreaterThan(0);
    }
  });

  it('returns only the nodes filed under that exact topic', () => {
    const got = outcomesForTopic(knownRef);
    const under = new Set(nodesUnder.map((n) => n.id));
    for (const outcome of got) expect(under.has(outcome.id)).toBe(true);
  });

  it('orders them easiest first, the order a class teaches them in', () => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n.difficulty]));
    const got = outcomesForTopic(knownRef).map((o) => byId.get(o.id)!);
    expect([...got].sort((a, b) => a - b)).toEqual(got);
  });

  it('never hands a planner a syllabus', () => {
    // A whole chapter is fifty outcomes; a four-minute class claiming all of
    // them is worse than one claiming none.
    for (const ref of new Set(graph.nodes.map((n) => n.topicRef))) {
      expect(outcomesForTopic(ref).length).toBeLessThanOrEqual(MAX_OUTCOMES);
    }
  });

  it('is empty, not wrong, when the map has never heard of the topic', () => {
    expect(outcomesForTopic('class9-science/no-such-chapter/no-such-topic')).toEqual([]);
  });

  it('is empty for a class with no map, so the prompt stays silent', () => {
    profileStore.update((p) => ({ ...p, klass: 3 }));
    settingsStore.update((s) => ({ ...s, klass: 3 }));
    expect(outcomesForTopic(knownRef)).toEqual([]);
  });

  it('is empty when the caller has no topicRef to join on', () => {
    expect(outcomesForTopic(undefined)).toEqual([]);
    expect(outcomesForTopic('')).toEqual([]);
  });
});
