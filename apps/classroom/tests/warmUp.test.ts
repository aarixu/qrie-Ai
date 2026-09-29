import { describe, expect, it } from 'vitest';
import { GraphIndex, type Probe } from '@ai-tutor/knowledge-graph';
import { emptyConceptState, emptyModel } from '@ai-tutor/learner-model';
import { pickWarmUp, WARM_UP_MAX } from '../src/lib/warmUp';

const node = (id: string) => ({
  id, klass: 8, subject: 'Mathematics', chapter: 'ch', title: `Outcome ${id.toUpperCase()}`, outcome: id,
  prerequisites: [], difficulty: 2, topicRef: `x/ch/${id}`,
});
const index = new GraphIndex({ version: 1, nodes: [node('a'), node('b'), node('c'), node('t')] } as never);
const probe = (id: string, nodeId: string): Probe => ({
  id, nodeId, question: `Q ${id}?`, options: ['1', '2', '3', '4'], correctIndex: 2, misconceptions: ['m0', 'm1', '', 'm3'],
});
const probes = [probe('a-2', 'a'), probe('a-1', 'a'), probe('b-1', 'b'), probe('c-1', 'c'), probe('t-1', 't')];
const due = (id: string, when: string, retrievalCount = 1) => ({
  ...emptyConceptState(id), box: 1, nextReviewAt: when, retrievalCount,
});
const now = '2026-09-29T10:00:00.000Z';

describe('the class-start warm-up (E6-E8)', () => {
  it('asks nothing when nothing is due', () => {
    expect(pickWarmUp({ model: emptyModel(), index, probes, now, justDone: [] })).toEqual([]);
  });

  it('asks the most overdue outcomes first, at most two, each from its own probe', () => {
    const model = {
      ...emptyModel(),
      states: {
        a: due('a', '2026-09-27T10:00:00.000Z'),
        b: due('b', '2026-09-20T10:00:00.000Z'),
        c: due('c', '2026-09-25T10:00:00.000Z'),
      },
    };
    const picked = pickWarmUp({ model, index, probes, now, justDone: [] });
    expect(WARM_UP_MAX).toBe(2);
    expect(picked.map((q) => q.nodeId)).toEqual(['b', 'c']);
    expect(picked[0]).toMatchObject({ id: 'b-1', title: 'Outcome B', topicRef: 'x/ch/b', correctIndex: 2 });
  });

  it('never warms up on what this class is about to teach', () => {
    const model = { ...emptyModel(), states: { t: due('t', '2026-09-20T10:00:00.000Z') } };
    expect(pickWarmUp({ model, index, probes, now, justDone: ['t'] })).toEqual([]);
  });

  it('skips a due outcome the bank has no question for, and asks the next one', () => {
    const bare = new GraphIndex({ version: 1, nodes: [node('a'), node('z')] } as never);
    const model = {
      ...emptyModel(),
      states: { z: due('z', '2026-09-20T10:00:00.000Z'), a: due('a', '2026-09-25T10:00:00.000Z') },
    };
    expect(pickWarmUp({ model, index: bare, probes, now, justDone: [] }).map((q) => q.nodeId)).toEqual(['a']);
  });

  it('turns to a different question of the same outcome at the next review', () => {
    const at = (retrievals: number) =>
      pickWarmUp({
        model: { ...emptyModel(), states: { a: due('a', '2026-09-20T10:00:00.000Z', retrievals) } },
        index, probes, now, justDone: [],
      })[0].id;
    // Ordered by id, then turned by how often it has been retrieved.
    expect(at(2)).toBe('a-1');
    expect(at(3)).toBe('a-2');
  });
});
