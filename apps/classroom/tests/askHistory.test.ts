import { describe, expect, it } from 'vitest';
import { emptyConceptState, emptyModel, type ConceptState, type LearnerModel, type Misconception } from '@ai-tutor/learner-model';
import { decide, type AskInput } from '@ai-tutor/tutor-control';
import { HINT_ABUSE_ASKS, askHistory, askMastery, wrongOptionText } from '../src/lib/askHistory';

/**
 * WHAT THE CLASSROOM TELLS decide() ABOUT THE CHILD'S PAST (lam-one-brain Task 6).
 *
 * The learner model holds the wrong ideas, cold misses and mastery; the
 * sitting holds who keeps asking before trying. This turns both into
 * `DecideInput.history` and `.mastery` for the ask in front of her — and the
 * anti-illusion test runs it end to end: the same wrong idea three times
 * changes the next help move, flipping it to right answers flips it back.
 */

const ASK: AskInput = {
  question: 'Why does the sugar seem to disappear in water?',
  expect: 'it dissolves',
  whyProbe: {
    askedAs: 'open',
    options: [
      { text: 'it dissolves', correct: true, why: 'It breaks into pieces too small to see.' },
      { text: 'it melts', correct: false, why: 'Melting needs heat.', followUp: 'What would you need to melt something?' },
    ],
  },
  alternates: [{ mode: 'everyday', say: 'Stir salt into dal: you taste it everywhere, but you cannot see a grain.' }],
};

const idea = (over: Partial<Misconception> = {}): Misconception => ({
  label: 'it melts',
  count: 1,
  items: ['beat:sci/ch/b4'],
  sittings: ['earlier'],
  firstAt: '2026-10-01T10:00:00.000Z',
  lastAt: '2026-10-01T10:00:00.000Z',
  clearedAt: null,
  clearing: [],
  ...over,
});

const model = (...states: ConceptState[]): LearnerModel => ({
  ...emptyModel(),
  states: Object.fromEntries(states.map((s) => [s.outcomeId, s])),
});
const state = (over: Partial<ConceptState>): ConceptState => ({ ...emptyConceptState('o1'), ...over });

describe('wrongOptionText', () => {
  it('names the wrong option decide() will read, and nothing for a right one or none', () => {
    expect(wrongOptionText(ASK, 1)).toBe('it melts');
    expect(wrongOptionText(ASK, 0)).toBeUndefined();
    expect(wrongOptionText(ASK, undefined)).toBeUndefined();
    expect(wrongOptionText(ASK, 9)).toBeUndefined();
  });
});

describe('askHistory', () => {
  it('is empty for a learner with no past', () => {
    expect(askHistory({ model: emptyModel(), outcomeIds: ['o1'], wrongOption: 'it melts', sessionId: 'now' })).toEqual({});
  });

  it('names a wrong idea shown in an earlier sitting, by its own label or a near wording', () => {
    const m = model(state({ misconceptions: { 'it melts': idea() } }));
    expect(askHistory({ model: m, outcomeIds: ['o1'], wrongOption: 'it melts', sessionId: 'now' })).toEqual({
      repeatedMisconception: 'it melts',
    });
    const quiz = model(state({ misconceptions: { 'thinks sugar melts in water': idea({ label: 'Thinks sugar melts in water' }) } }));
    expect(askHistory({ model: quiz, outcomeIds: ['o1'], wrongOption: 'the sugar melts in water', sessionId: 'now' }).repeatedMisconception).toBe(
      'Thinks sugar melts in water',
    );
  });

  it('does not count this very sitting as "before", nor another outcome, nor another idea', () => {
    const now = model(state({ misconceptions: { 'it melts': idea({ sittings: ['now'] }) } }));
    expect(askHistory({ model: now, outcomeIds: ['o1'], wrongOption: 'it melts', sessionId: 'now' })).toEqual({});
    const elsewhere = model(state({ outcomeId: 'o2', misconceptions: { 'it melts': idea() } }));
    expect(askHistory({ model: elsewhere, outcomeIds: ['o1'], wrongOption: 'it melts', sessionId: 'now' })).toEqual({});
    const other = model(state({ misconceptions: { 'light travels in curves': idea({ label: 'light travels in curves' }) } }));
    expect(askHistory({ model: other, outcomeIds: ['o1'], wrongOption: 'it melts', sessionId: 'now' })).toEqual({});
  });

  it('reads wheel-spinning as three cold answers and not one right', () => {
    const spinning = model(state({ unassistedObservations: 3, unassistedMastery: 0.2, lastUnassistedSuccessAt: null }));
    expect(askHistory({ model: spinning, outcomeIds: ['o1'], sessionId: 'now' })).toEqual({ wheelSpin: true });
    const twice = model(state({ unassistedObservations: 2, unassistedMastery: 0.3 }));
    expect(askHistory({ model: twice, outcomeIds: ['o1'], sessionId: 'now' })).toEqual({});
    const gotOne = model(state({ unassistedObservations: 4, unassistedMastery: 0.4, lastUnassistedSuccessAt: '2026-10-01T10:00:00.000Z' }));
    expect(askHistory({ model: gotOne, outcomeIds: ['o1'], sessionId: 'now' })).toEqual({});
  });

  it(`flags asking before trying from the ${HINT_ABUSE_ASKS}th earlier ask of the sitting`, () => {
    expect(askHistory({ model: emptyModel(), outcomeIds: ['o1'], sessionId: 'now', pulledBeforeTrying: HINT_ABUSE_ASKS - 1 })).toEqual({});
    expect(askHistory({ model: emptyModel(), outcomeIds: ['o1'], sessionId: 'now', pulledBeforeTrying: HINT_ABUSE_ASKS })).toEqual({ hintAbuse: true });
  });
});

describe('askMastery', () => {
  it('is unknown when nothing was asked cold, else the weakest cold belief', () => {
    expect(askMastery(model(state({ unassistedMastery: 0.9 })), ['o1'])).toBeUndefined();
    const m = model(
      state({ unassistedObservations: 2, unassistedMastery: 0.8 }),
      { ...emptyConceptState('o2'), unassistedObservations: 1, unassistedMastery: 0.3 },
    );
    expect(askMastery(m, ['o1', 'o2'])).toEqual({ unassisted: 0.3 });
  });
});

describe('anti-illusion, end to end: model -> history -> decide()', () => {
  const wrongAt = (m: LearnerModel) =>
    decide({
      verdict: 'wrong',
      attempt: 1,
      rungSoFar: 0,
      ask: ASK,
      matchedOption: 1,
      history: askHistory({ model: m, outcomeIds: ['o1'], wrongOption: wrongOptionText(ASK, 1), sessionId: 'now' }),
      lang: 'en',
      now: 0,
    });

  it('the same wrong idea three times changes the next help move; right answers in its place do not', () => {
    const repeated = model(state({ misconceptions: { 'it melts': idea({ count: 3, sittings: ['s1', 's2', 's3'] }) } }));
    const rightInstead = model(state({ unassistedObservations: 3, unassistedMastery: 0.85, lastUnassistedSuccessAt: '2026-10-01T10:00:00.000Z' }));
    expect(wrongAt(repeated).kind).toBe('explainAgain');
    expect(wrongAt(rightInstead)).toMatchObject({ kind: 'rethink', followUp: true });
    expect(wrongAt(emptyModel())).toEqual(wrongAt(rightInstead));
  });
});
