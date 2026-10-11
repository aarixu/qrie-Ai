import { describe, expect, it } from 'vitest';
import {
  MODEL_VERSION,
  emptyConceptState,
  learnerProfile,
  type ConceptState,
  type LearnerModel,
  type Misconception,
} from '../src/index.ts';

/**
 * A BASIC UNDERSTANDING OF ONE LEARNER, from the model alone: no model call,
 * no clock but the one passed in, the same model always reads the same.
 */

const NOW = Date.parse('2026-10-11T06:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const state = (outcomeId: string, over: Partial<ConceptState>): ConceptState => ({
  ...emptyConceptState(outcomeId),
  ...over,
});

const idea = (label: string, over: Partial<Misconception> = {}): Misconception => ({
  label,
  count: 3,
  items: ['probe:a', 'probe:b'],
  sittings: ['s1', 's2'],
  firstAt: day(5),
  lastAt: day(1),
  clearedAt: null,
  clearing: [],
  ...over,
});

const model = (states: ConceptState[]): LearnerModel => ({
  states: Object.fromEntries(states.map((s) => [s.outcomeId, s])),
  foldedThrough: null,
  helpInFlight: null,
  version: MODEL_VERSION,
});

const titles: Record<string, string> = {
  frac: 'Adding fractions',
  ratio: 'Ratios',
  area: 'Area of a triangle',
  photo: 'Photosynthesis',
  cell: 'The cell',
};
const titleOf = (id: string) => titles[id];

const riya = model([
  // Secure: mastered on their own.
  state('photo', { unassistedMastery: 0.92, unassistedObservations: 4, answerObservations: 4, masteredAt: day(3), lastPracticedAt: day(3) }),
  // Needs work: cold answers, low on their own, and a confirmed wrong idea.
  state('frac', {
    unassistedMastery: 0.12, unassistedObservations: 5, answerObservations: 6, assistedPerformance: 0.4, lastPracticedAt: day(1),
    misconceptions: { 'frac#adds denominators': idea('Adds the denominators'), 'frac#slip': idea('Slip', { count: 1, items: ['probe:c'], sittings: ['s3'] }) },
  }),
  // Only with help: right when helped, never shown alone.
  state('area', { unassistedMastery: 0.5, unassistedObservations: 0, answerObservations: 4, assistedPerformance: 0.86, lastPracticedAt: day(2) }),
  // Due for review: mastered earlier, review time passed.
  state('cell', { unassistedMastery: 0.85, unassistedObservations: 3, answerObservations: 3, masteredAt: day(20), box: 2, nextReviewAt: day(1), lastPracticedAt: day(20) }),
  // Seen in class only (exposure), no answers: not judged either way.
  state('ratio', { answerObservations: 0, unassistedObservations: 0, taughtCount: 1, lastPracticedAt: day(4) }),
]);

describe('learnerProfile', () => {
  it('says what a learner holds, what needs work, what only help carries, the wrong ideas and what is due', () => {
    const p = learnerProfile(riya, { now: NOW, titleOf });
    expect(p.secure.map((o) => o.outcomeId)).toEqual(['photo', 'cell']);
    expect(p.needsWork.map((o) => o.outcomeId)).toEqual(['frac']);
    expect(p.withHelpOnly.map((o) => o.outcomeId)).toEqual(['area']);
    expect(p.wrongIdeas).toEqual([{ outcomeId: 'frac', title: 'Adding fractions', label: 'Adds the denominators', count: 3, items: 2 }]);
    expect(p.dueForReview.map((o) => o.outcomeId)).toEqual(['cell']);
    expect(p.outcomesSeen).toBe(4);
    expect(p.answersTotal).toBe(17);
    expect(p.answersOnOwn).toBe(12);
    expect(p.lastActiveAt).toBe(day(1));
  });

  it('writes one plain sentence a person can read, from the same facts', () => {
    const p = learnerProfile(riya, { now: NOW, titleOf });
    expect(p.summary).toBe(
      'Answered 17 questions (12 on their own) across 4 topics. ' +
        'Secure: Photosynthesis, The cell. ' +
        'Needs work: Adding fractions. ' +
        'Does it only with help: Area of a triangle. ' +
        'Keeps thinking: "Adds the denominators" (Adding fractions). ' +
        'Due for review: The cell.',
    );
  });

  it('is the same every time for the same model and clock (no randomness, no hidden clock)', () => {
    expect(learnerProfile(riya, { now: NOW, titleOf })).toEqual(learnerProfile(riya, { now: NOW, titleOf }));
  });

  it('does not call one wrong answer a wrong idea, nor a review due before its time', () => {
    const p = learnerProfile(riya, { now: Date.parse(day(2)), titleOf });
    expect(p.wrongIdeas.map((w) => w.label)).not.toContain('Slip');
    expect(p.dueForReview).toEqual([]);
  });

  it('flips with the evidence: the same outcome answered right on their own leaves "needs work"', () => {
    const better = model([
      state('frac', { unassistedMastery: 0.9, unassistedObservations: 5, answerObservations: 6, masteredAt: day(1), lastPracticedAt: day(1) }),
    ]);
    const p = learnerProfile(better, { now: NOW, titleOf });
    expect(p.needsWork).toEqual([]);
    expect(p.secure.map((o) => o.outcomeId)).toEqual(['frac']);
  });

  it('says plainly when there is nothing yet, and falls back to the outcome id without titles', () => {
    expect(learnerProfile(model([]), { now: NOW }).summary).toBe('No answers yet.');
    const p = learnerProfile(model([state('frac', { unassistedMastery: 0.1, unassistedObservations: 2, answerObservations: 2 })]), { now: NOW });
    expect(p.needsWork[0].title).toBeNull();
    expect(p.summary).toContain('Needs work: frac.');
  });

  it('caps each list so a long history stays a glance', () => {
    const many = model(
      Array.from({ length: 12 }, (_, i) =>
        state(`o${String(i).padStart(2, '0')}`, { unassistedMastery: 0.05 + i * 0.01, unassistedObservations: 2, answerObservations: 2 }),
      ),
    );
    const p = learnerProfile(many, { now: NOW, limit: 3 });
    expect(p.needsWork.map((o) => o.outcomeId)).toEqual(['o00', 'o01', 'o02']);
  });
});
