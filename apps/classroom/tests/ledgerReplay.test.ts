import { beforeEach, describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { replayCounters } from '@ai-tutor/ledger';
import {
  answeredOutcomesAtBeat,
  outcomeStore,
  outcomesAtBeat,
  outcomesOf,
  recordAnswerAtBeat,
  recordDoubtAtBeat,
  recordLessonTaught,
} from '../src/stores/outcomes';
import {
  closeSession,
  ledgerOutbox,
  logAnswer,
  logEvent,
  logReflection,
  openSession,
  resetLedgerOutbox,
} from '../src/stores/ledger';

/**
 * THE TEST THAT SAYS THE LEDGER IS A RECORD AND NOT A LOG.
 *
 * A ledger is only correct if the state it replaces can be rebuilt from it.
 * Reproducing the four counters is the FLOOR — the whole point of the ledger is
 * everything it holds that they cannot — but a ledger that cannot even
 * reproduce them is not ready to take over from them, and without this the
 * claim that it could is an opinion.
 *
 * Both paths are driven from the same three helpers the app uses, so a change
 * to what an event is evidence about moves both sides together or fails here.
 */

const lesson = {
  formatVersion: 1,
  id: 'class10-respiration',
  title: 'Respiration',
  language: 'en',
  topicRef: 'class10-science/life-processes/respiration',
  canvas: { w: 1000, h: 620 },
  elements: [],
  beats: [
    { id: 'hook', topic: 'h', narration: '', show: [], teaches: ['sci10-lp-respiration-vs-breathing'] },
    { id: 'equation', topic: 'e', narration: '', show: [], teaches: ['sci10-lp-respiration-equation'] },
    // checks wins over teaches: a question about something already covered is
    // evidence about THAT.
    { id: 'recap', topic: 'r', narration: '', show: [], teaches: ['sci10-lp-aerobic-vs-anaerobic'], checks: ['sci10-lp-respiration-vs-breathing'] },
    // A hook that lands nothing. Both sides must record nothing for it.
    { id: 'aside', topic: 'a', narration: '', show: [] },
  ],
} as unknown as Lesson;

beforeEach(() => {
  localStorage.clear();
  resetLedgerOutbox();
  outcomeStore.set({ taught: {}, confused: {}, answeredRight: {}, answeredWrong: {}, updatedAt: null });
});

/** Exactly the pairs ClassRoom makes, in the order it makes them. */
function aClassHappens(): void {
  openSession({ source: 'class', topicRef: lesson.topicRef, lessonId: lesson.id });

  const answer = (beatId: string, correct: boolean): void => {
    recordAnswerAtBeat(lesson, beatId, correct);
    logAnswer({
      surface: 'tap',
      outcomeIds: answeredOutcomesAtBeat(lesson, beatId),
      topicRef: lesson.topicRef,
      beatId,
      correct,
      ms: 3000,
      attempt: 1,
      assistanceRung: 0,
      hintsShown: 0,
    });
  };

  const doubt = (beatId: string): void => {
    recordDoubtAtBeat(lesson, beatId);
    logEvent({
      kind: 'confused',
      surface: 'tap',
      outcomeIds: outcomesAtBeat(lesson, beatId),
      payload: { beatId, lessonId: lesson.id },
    });
  };

  const reflect = (beatId: string, verdict: 'held' | 'wobbled' | 'silent'): void => {
    // Nothing to mirror on the counter side, deliberately. A reflection is a
    // second event about a question already answered, so a counter that moved
    // for it would be counting one right answer twice — and this is the test
    // that would notice.
    logReflection({
      surface: 'voice',
      outcomeIds: answeredOutcomesAtBeat(lesson, beatId),
      topicRef: lesson.topicRef,
      beatId,
      prompt: 'And why does that hold when the animal is asleep?',
      ms: 5000,
      attempt: 1,
      assistanceRung: 0,
      reasoningVerdict: verdict,
    });
  };

  answer('equation', false);
  doubt('equation');
  answer('equation', true);
  reflect('equation', 'held');
  answer('recap', true);
  reflect('recap', 'silent');
  // A hand raised during a story: neither side may attribute it to whatever
  // outcome happened to be nearby.
  doubt('aside');
  answer('aside', false);

  recordLessonTaught(lesson);
  logEvent({
    kind: 'taught',
    surface: 'tap',
    outcomeIds: outcomesOf(lesson),
    payload: { lessonId: lesson.id },
  });
  closeSession({ activeMs: 480_000, completed: true });
}

describe('replaying a class', () => {
  it('rebuilds the counters exactly', () => {
    aClassHappens();
    const stored = outcomeStore.get();
    const replayed = replayCounters(ledgerOutbox.get().pending);

    expect(replayed.taught).toEqual(stored.taught);
    expect(replayed.confused).toEqual(stored.confused);
    expect(replayed.answeredRight).toEqual(stored.answeredRight);
    expect(replayed.answeredWrong).toEqual(stored.answeredWrong);
  });

  it('actually recorded something, so the comparison is not two empties', () => {
    aClassHappens();
    const stored = outcomeStore.get();
    expect(Object.keys(stored.answeredRight).length).toBeGreaterThan(0);
    expect(Object.keys(stored.answeredWrong).length).toBeGreaterThan(0);
    expect(Object.keys(stored.confused).length).toBeGreaterThan(0);
    expect(Object.keys(stored.taught).length).toBeGreaterThan(0);
  });

  it('files a check against what the beat CHECKS, not what it teaches', () => {
    aClassHappens();
    const replayed = replayCounters(ledgerOutbox.get().pending);
    // The recap beat teaches aerobic-vs-anaerobic and checks
    // respiration-vs-breathing. The answer is evidence about the latter.
    expect(replayed.answeredRight['sci10-lp-respiration-vs-breathing']).toBe(1);
    expect(replayed.answeredRight['sci10-lp-aerobic-vs-anaerobic']).toBeUndefined();
  });

  it('attributes nothing to a beat that lands nothing', () => {
    aClassHappens();
    const replayed = replayCounters(ledgerOutbox.get().pending);
    const all = [
      ...Object.keys(replayed.answeredWrong),
      ...Object.keys(replayed.confused),
    ];
    expect(all).not.toContain('aside');
    // The wrong answer on `aside` moved nothing, so only the `equation` miss counted.
    expect(Object.values(replayed.answeredWrong).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('is order-independent, because counters are', () => {
    aClassHappens();
    const events = ledgerOutbox.get().pending;
    const forwards = replayCounters(events);
    const backwards = replayCounters([...events].reverse());
    expect(backwards).toEqual(forwards);
  });

  /**
   * The reflection is in `aClassHappens` precisely so the parity test above
   * has to survive it. A reflection that moved `answeredRight` would count the
   * same right answer twice, and the counters it is compared against have no
   * such event to move — so this is where that would be caught.
   */
  it('counts a justification as evidence about the student, never as a second right answer', () => {
    aClassHappens();
    const replayed = replayCounters(ledgerOutbox.get().pending);
    // Two right answers, two reflections about them.
    expect(Object.values(replayed.answeredRight).reduce((a, b) => a + b, 0)).toBe(2);
    // The held one is justification. The silence is its own counter and moves
    // neither of the other two: it is the ear's grace window expiring, and at
    // that layer a child still thinking and a dead mic are one signal.
    expect(replayed.justified['sci10-lp-respiration-equation']).toBe(1);
    expect(replayed.silentOnProbe['sci10-lp-respiration-vs-breathing']).toBe(1);
    expect(replayed.unjustified).toEqual({});
  });

  it('holds what the counters never could', () => {
    // The floor is matching them. This is the point of the exercise: the same
    // events also carry the timing, the attempt, the rung and the session.
    aClassHappens();
    const answered = ledgerOutbox.get().pending.filter((e) => e.kind === 'answered');
    expect(answered.length).toBeGreaterThan(0);
    for (const e of answered) {
      expect(e.payload).toMatchObject({ ms: 3000, attempt: 1, assistanceRung: 0 });
      expect(e.sessionId).toBeTruthy();
    }
    const ended = ledgerOutbox.get().pending.find((e) => e.kind === 'session-ended');
    expect(ended?.payload).toMatchObject({ activeMs: 480_000 });
  });
});
