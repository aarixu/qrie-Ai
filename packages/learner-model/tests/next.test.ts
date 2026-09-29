import { describe, expect, it } from 'vitest';
import { GraphIndex } from '@ai-tutor/knowledge-graph';
import { emptyConceptState, emptyModel, nextActivity, type ConceptState, type LearnerModel } from '../src/index';

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
