import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import { emptyConceptState, emptyModel, foldSession, nextActivity, type ConceptState, type LearnerModel } from '../src/index';

/**
 * E6-E8/F5: WHAT COMES NEXT, DECIDED FROM WHAT WE BELIEVE.
 *
 * Order: due reviews (at most three, never what they just did) → a shaky
 * prerequisite of what comes next → the next topic in the syllabus. Every
 * answer says why.
 */
const node = (id: string, prerequisites: string[] = []) => ({
  id, klass: 10, subject: 'Maths', chapter: 'ch', title: id.toUpperCase(), outcome: `can do ${id}`,
  prerequisites, difficulty: 2, topicRef: `x/ch/${id}`,
});
const index = new GraphIndex({ version: 1, nodes: [node('a'), node('b'), node('c'), node('d', ['a']), node('e')] } as never);
const NOW = '2026-09-29T10:00:00.000Z';
const state = (id: string, over: Partial<ConceptState>): ConceptState => ({ ...emptyConceptState(id), ...over });
const model = (...states: ConceptState[]): LearnerModel => ({
  ...emptyModel(),
  states: Object.fromEntries(states.map((s) => [s.outcomeId, s])),
});

describe('nextActivity', () => {
  it('reviews what is due first, most overdue first, at most three', () => {
    const m = model(
      state('a', { box: 1, nextReviewAt: '2026-09-27T10:00:00.000Z' }),
      state('b', { box: 0, nextReviewAt: '2026-09-28T10:00:00.000Z' }),
      state('c', { box: 2, nextReviewAt: '2026-09-20T10:00:00.000Z' }),
      state('e', { box: 3, nextReviewAt: '2026-09-29T09:00:00.000Z' }),
    );
    const next = nextActivity({ model: m, index, now: NOW, next: { outcomeIds: ['d'] } });
    expect(next.kind).toBe('review');
    if (next.kind === 'review') expect(next.outcomeIds).toEqual(['c', 'a', 'b']);
    expect(next.because).toMatch(/due/);
  });

  it('never reviews what they have just done', () => {
    const m = model(state('a', { box: 0, nextReviewAt: '2026-09-28T10:00:00.000Z' }));
    const next = nextActivity({ model: m, index, now: NOW, justDone: ['a'], next: { outcomeIds: ['e'] } });
    expect(next.kind).toBe('next');
  });

  it('does not review what is not yet due, or was never met', () => {
    const m = model(state('a', { box: 2, nextReviewAt: '2026-10-05T10:00:00.000Z' }), state('b', {}));
    expect(nextActivity({ model: m, index, now: NOW, next: { outcomeIds: ['e'] } }).kind).toBe('next');
  });

  it('reteaches a shaky prerequisite of what comes next before moving on', () => {
    const m = model(state('a', { unassistedObservations: 2, unassistedMastery: 0.3 }));
    const next = nextActivity({ model: m, index, now: NOW, next: { outcomeIds: ['d'] } });
    expect(next).toMatchObject({ kind: 'prerequisite', outcomeId: 'a' });
    expect(next.because).toMatch(/prerequisite/);
  });

  it('does not call a prerequisite shaky on no evidence', () => {
    const m = model(state('a', { unassistedObservations: 0, unassistedMastery: 0.3 }));
    expect(nextActivity({ model: m, index, now: NOW, next: { outcomeIds: ['d'] } }).kind).toBe('next');
  });

  it('otherwise goes on to the next topic, and says so', () => {
    const next = nextActivity({ model: emptyModel(), index, now: NOW, next: { outcomeIds: ['d'] } });
    expect(next.kind).toBe('next');
    expect(next.because.length).toBeGreaterThan(0);
  });
});

/**
 * lam-one-brain Task 6 (D12, D16): review splits into REMEDIAL (a wrong idea
 * they have shown and not cleared, or a due outcome they have failed cold)
 * before MAINTENANCE; prerequisites are walked through every ancestor; an
 * unexamined prerequisite of an outcome missed cold twice is checked first.
 */
describe('nextActivity reads what went wrong (Task 6)', () => {
  // f rests on d, which rests on a: a is two hops under f.
  const deep = new GraphIndex({
    version: 1,
    nodes: [node('a'), node('b'), node('c'), node('d', ['a']), node('e'), node('f', ['d']), node('w'), node('x', ['w'])],
  } as never);
  const idea = (over: Partial<import('../src/index').Misconception> = {}) => ({
    label: 'thinks sugar melts in water',
    count: 3,
    items: ['probe:p1', 'probe:p2'],
    sittings: ['s1', 's2'],
    firstAt: '2026-09-25T10:00:00.000Z',
    lastAt: '2026-09-27T10:00:00.000Z',
    clearedAt: null,
    clearing: [],
    ...over,
  });

  it('puts a confirmed wrong idea first, as remedial, even before a due review and when it is not due itself', () => {
    const m = model(
      state('a', { box: 2, nextReviewAt: '2026-09-20T10:00:00.000Z', masteredAt: '2026-09-01T10:00:00.000Z' }),
      state('b', { misconceptions: { 'thinks sugar melts in water': idea() } }),
    );
    const next = nextActivity({ model: m, index: deep, now: NOW, next: { outcomeIds: ['e'] } });
    expect(next).toMatchObject({ kind: 'remedial', outcomeIds: ['b'] });
    expect(next.because).toMatch(/wrong idea/);
  });

  it('a single slip, or a cleared idea, is not remedial: flipping the evidence flips the decision', () => {
    const slip = model(state('b', { misconceptions: { s: idea({ items: ['probe:p1'], sittings: ['s1'], count: 1 }) } }));
    expect(nextActivity({ model: slip, index: deep, now: NOW, next: { outcomeIds: ['e'] } }).kind).toBe('next');
    const cleared = model(state('b', { misconceptions: { s: idea({ clearedAt: '2026-09-28T10:00:00.000Z' }) } }));
    expect(nextActivity({ model: cleared, index: deep, now: NOW, next: { outcomeIds: ['e'] } }).kind).toBe('next');
  });

  it('a due outcome failed cold is remedial; a due outcome held is maintenance review', () => {
    const failed = state('a', { box: 0, nextReviewAt: '2026-09-28T10:00:00.000Z', unassistedObservations: 2, unassistedMastery: 0.2 });
    const held = state('c', { box: 2, nextReviewAt: '2026-09-27T10:00:00.000Z', unassistedObservations: 2, unassistedMastery: 0.85, masteredAt: '2026-09-10T10:00:00.000Z' });
    expect(nextActivity({ model: model(failed, held), index: deep, now: NOW, next: { outcomeIds: ['e'] } })).toMatchObject({
      kind: 'remedial',
      outcomeIds: ['a'],
    });
    expect(nextActivity({ model: model(held), index: deep, now: NOW, next: { outcomeIds: ['e'] } })).toMatchObject({
      kind: 'review',
      outcomeIds: ['c'],
    });
  });

  it('a due outcome not yet mastered but not failed cold is maintenance review, not remedial', () => {
    // One lucky right alone: nothing went wrong, it just is not mastered yet.
    // Spacing it out is how it gets mastered, so it is reviewed, and the
    // remedial card's "It tripped you up last time" is not said of it.
    const lucky = state('a', { box: 0, nextReviewAt: '2026-09-28T10:00:00.000Z', unassistedObservations: 1, unassistedMastery: 0.5, masteredAt: null });
    expect(nextActivity({ model: model(lucky), index: deep, now: NOW, next: { outcomeIds: ['e'] } })).toMatchObject({
      kind: 'review',
      outcomeIds: ['a'],
    });
  });

  it('never offers as remedial what they have just done', () => {
    const m = model(state('b', { misconceptions: { s: idea() } }));
    expect(nextActivity({ model: m, index: deep, now: NOW, justDone: ['b'], next: { outcomeIds: ['e'] } }).kind).toBe('next');
  });

  it('finds a shaky prerequisite two hops down, not only one', () => {
    const m = model(state('a', { unassistedObservations: 2, unassistedMastery: 0.3 }), state('d', { unassistedObservations: 1, unassistedMastery: 0.7 }));
    expect(nextActivity({ model: m, index: deep, now: NOW, next: { outcomeIds: ['f'] } })).toMatchObject({ kind: 'prerequisite', outcomeId: 'a' });
  });

  it('checks an unexamined prerequisite of an outcome missed cold twice', () => {
    const missed = state('x', { unassistedObservations: 2, unassistedMastery: 0.25, lastUnassistedSuccessAt: null });
    const next = nextActivity({ model: model(missed), index: deep, now: NOW, justDone: ['x'], next: { outcomeIds: ['e'] } });
    expect(next).toMatchObject({ kind: 'check-prerequisite', outcomeId: 'w' });
    expect(next.because).toMatch(/never been asked/);
  });

  it('does not check it once they have answered it, nor for a single cold miss, nor once they got it right cold', () => {
    const missed = state('x', { unassistedObservations: 2, unassistedMastery: 0.25 });
    const examined = state('w', { unassistedObservations: 1, unassistedMastery: 0.7 });
    expect(nextActivity({ model: model(missed, examined), index: deep, now: NOW, justDone: ['x'], next: { outcomeIds: ['e'] } }).kind).toBe('next');
    const once = state('x', { unassistedObservations: 1, unassistedMastery: 0.35 });
    expect(nextActivity({ model: model(once), index: deep, now: NOW, justDone: ['x'], next: { outcomeIds: ['e'] } }).kind).toBe('next');
    const recovered = state('x', { unassistedObservations: 3, unassistedMastery: 0.45, lastUnassistedSuccessAt: '2026-09-28T10:00:00.000Z' });
    expect(nextActivity({ model: model(recovered), index: deep, now: NOW, justDone: ['x'], next: { outcomeIds: ['e'] } }).kind).toBe('next');
  });
});

/**
 * ANTI-ILLUSION THROUGH THE REAL FOLD (Task 6): the same wrong idea three times
 * across two sittings makes the next activity remedial; the same three answers
 * given right do not. Flip the answers, flip the decision.
 */
describe('nextActivity over folded evidence (Task 6)', () => {
  const graph = new GraphIndex({ version: 1, nodes: [node('b'), node('e')] } as never);
  let seq = 0;
  const answer = (sessionId: string, correct: boolean, probe: string) =>
    ({
      id: `e${seq}`, sessionId, seq: seq++, at: '2026-09-29T08:00:00.000Z', kind: 'answered', source: 'quiz', surface: 'tap',
      outcomeIds: ['b'],
      payload: {
        correct, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: correct ? 0 : 1, probeId: probe,
        ...(correct ? {} : { misconceptionId: 'thinks sugar melts in water' }),
      },
    }) as never;
  const run = (correct: boolean) => {
    const s1 = { id: 's1', startedAt: '2026-09-29T07:00:00.000Z' };
    const s2 = { id: 's2', startedAt: '2026-09-29T08:00:00.000Z' };
    let m = foldSession(emptyModel(), s1, [answer('s1', correct, 'p1'), answer('s1', correct, 'p2')], graph, emptyParams());
    m = foldSession(m, s2, [answer('s2', correct, 'p3')], graph, emptyParams());
    return nextActivity({ model: m, index: graph, now: NOW, next: { outcomeIds: ['e'] } });
  };

  it('the same wrong idea x3 is remedial; the same answers right are not', () => {
    expect(run(false)).toMatchObject({ kind: 'remedial', outcomeIds: ['b'] });
    expect(run(true).kind).not.toBe('remedial');
  });
});
