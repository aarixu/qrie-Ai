import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { useClassLedger, type ClassLedger } from '../src/lib/classLedger';
import { ledgerOutbox, resetLedgerOutbox } from '../src/stores/ledger';

/**
 * THE RUNG IN FORCE WHEN AN ANSWER LANDS.
 *
 * Rung 0 — left alone — is the only rung the learner model will ever accept as
 * proof of mastery, and the assisted/unassisted split is the whole MVP scope
 * of the learner model. So the number on an `answered` row is not a detail: it
 * is the difference between a student who worked something out and a student
 * who was told.
 *
 * `helped` is handed the rung and used to throw it away. Only the COUNT of
 * hints survived, and the next answer's rung was re-derived from that count as
 * 0, 3 or 4 — so a raised hand, recorded as rung 7 on its own event, produced
 * an answer filed at rung 3, and the judge's leading question was
 * indistinguishable from the authored hint once counted. The ladder was
 * described correctly on one event and flattened on the one that matters.
 */

beforeEach(() => {
  localStorage.clear();
  resetLedgerOutbox();
});

const lesson = {
  id: 'l1',
  topicRef: 'class10-science/life-processes/respiration',
  title: 'Respiration',
  beats: [{ id: 'b1', topic: 'Breathing in' }],
  elements: [],
} as unknown as Lesson;

/** Mount the hook and hand back its recorder. */
const mounted = (): ClassLedger => {
  let api: ClassLedger | null = null;
  const Probe = (): null => {
    api = useClassLedger(lesson, false, false);
    return null;
  };
  const host = document.createElement('div');
  act(() => createRoot(host).render(<Probe />));
  if (!api) throw new Error('the hook did not run');
  return api;
};

const answersIn = (): Record<string, unknown>[] =>
  ledgerOutbox
    .get()
    .pending.filter((e) => e.kind === 'answered')
    .map((e) => e.payload as Record<string, unknown>);

describe('the rung an answer is recorded at', () => {
  it('is 0 when nothing has been given, which is the only rung that proves anything', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });
    expect(answersIn()[0]).toMatchObject({ assistanceRung: 0, hintsShown: 0, attempt: 1 });
  });

  it('is the rung she actually gave, not a count of how many times she gave one', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.answered({ beatId: 'b1', correct: false, surface: 'voice' });
    // The judge asked a leading question rather than giving the hint.
    ledger.helped('b1', 2, false);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'voice' });

    const [first, second] = answersIn();
    expect(first).toMatchObject({ assistanceRung: 0, attempt: 1 });
    // Was 3 — the count's value for "one hint" — whatever she had actually done.
    expect(second).toMatchObject({ assistanceRung: 2, hintsShown: 1, attempt: 2 });
  });

  it('carries a raised hand at its real weight, not at the count of one hint', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    // A hand up on a held question: a whole tutor conversation about it.
    ledger.helped('b1', 7, true);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 0 });

    expect(answersIn()[0]).toMatchObject({ assistanceRung: 7, hintsShown: 1 });
  });

  it('never walks the ladder back down, because help given cannot be taken back', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.helped('b1', 7, true); // the whole explanation
    ledger.helped('b1', 2, false); // then a small nudge
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 0 });

    expect(answersIn()[0]).toMatchObject({ assistanceRung: 7, hintsShown: 2 });
  });

  it('holds the rung across a re-ask of the same question', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.helped('b1', 3, false);
    ledger.asked('b1', 4); // the question surfaces again
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 0 });

    expect(answersIn()[0]).toMatchObject({ assistanceRung: 3 });
  });
});
