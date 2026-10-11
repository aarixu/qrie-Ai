import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams, type Probe } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { emptyConceptState, emptyModel, foldSession } from '@ai-tutor/learner-model';
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

  // Second review: nextActivity keeps the three most overdue, and three with
  // no question in the bank stopped every warm-up for good.
  it('finds a question past overdue outcomes the bank cannot ask about', () => {
    const wide = new GraphIndex({ version: 1, nodes: [node('p'), node('q'), node('r'), node('a')] } as never);
    const model = {
      ...emptyModel(),
      states: {
        p: due('p', '2026-09-10T10:00:00.000Z'),
        q: due('q', '2026-09-11T10:00:00.000Z'),
        r: due('r', '2026-09-12T10:00:00.000Z'),
        a: due('a', '2026-09-20T10:00:00.000Z'),
      },
    };
    expect(pickWarmUp({ model, index: wide, probes, now, justDone: [] }).map((q) => q.nodeId)).toEqual(['a']);
  });

  /**
   * Task 16: a node may hold several questions. A review asks one the learner
   * has not answered (`askedItems`, learner-model v6), so it is a different
   * question when the bank has one; the retrieval count only turns among
   * questions not yet answered.
   */
  describe('a node with several questions', () => {
    const two = [probe('a-1', 'a'), probe('a-2', 'a')];

    it('gives a review on the second after the first was answered', () => {
      // The class taught `a` and its quiz asked a-1 straight after: listening,
      // not a retrieval, so the retrieval count stays 0 and turning by it
      // alone would ask a-1 again at the review.
      const at = '2026-09-20T10:00:00.000Z';
      const ev = (seq: number, kind: string, source: string, payload: object) =>
        ({ id: `e${seq}`, sessionId: 's1', seq, at, kind, source, surface: 'tap', outcomeIds: ['a'], payload }) as unknown as LedgerEvent;
      const model = foldSession(
        emptyModel(),
        { id: 's1', startedAt: at },
        [
          ev(0, 'taught', 'class', { beatId: 'b1' }),
          ev(1, 'answered', 'quiz', { probeId: 'a-1', correct: true, chosenIndex: 2, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 }),
        ],
        index,
        emptyParams(),
      );
      expect(model.states.a.retrievalCount).toBe(0);
      expect(model.states.a.nextReviewAt).not.toBeNull();
      expect(model.states.a.askedItems).toEqual(['probe:a-1']);
      const [review] = pickWarmUp({ model, index, probes: two, now, justDone: [] });
      expect(review.id).toBe('a-2');
    });

    it('asks the one answered longest ago once every question has been answered', () => {
      const state = { ...due('a', '2026-09-20T10:00:00.000Z', 0), askedItems: ['probe:a-2', 'probe:x-9', 'probe:a-1'] };
      const [review] = pickWarmUp({ model: { ...emptyModel(), states: { a: state } }, index, probes: two, now, justDone: [] });
      expect(review.id).toBe('a-2');
    });

    it('still asks the only question there is, answered or not', () => {
      const state = { ...due('b', '2026-09-20T10:00:00.000Z'), askedItems: ['probe:b-1'] };
      const [review] = pickWarmUp({ model: { ...emptyModel(), states: { b: state } }, index, probes, now, justDone: [] });
      expect(review.id).toBe('b-1');
    });
  });
});
