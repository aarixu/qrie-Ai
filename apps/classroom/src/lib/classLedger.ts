import { useEffect, useMemo, useRef } from 'react';
import type { Lesson } from '@ai-tutor/lesson-format';
import { normaliseAnswer, type AssistanceRung, type Verdict } from '@ai-tutor/ledger';
import { answeredOutcomesAtBeat, outcomesAtBeat, outcomesOf } from '../stores/outcomes';
import { closeSession, logAnswer, logEvent, openSession } from '../stores/ledger';

/**
 * WHAT THE CLASSROOM TELLS THE LEDGER.
 *
 * The screen reports; it does not decide. Every rule about what an event means
 * — which outcomes an answer is evidence about, which rung of the assistance
 * ladder was in force, what counts as a minute of learning — lives here, so
 * that ClassRoom.tsx stays wiring and so that these rules can be read in one
 * place rather than inferred from a 78-line effect.
 *
 * This runs ALONGSIDE the existing outcome counters rather than replacing them.
 * Replacing the learner model is a later phase; this phase only has to start
 * capturing, because the one thing that cannot be recovered later is a day of
 * teaching that nobody wrote down.
 */

export interface AnsweredInput {
  beatId: string;
  correct: boolean;
  surface: 'tap' | 'voice';
  chosenIndex?: number | null;
  verdict?: Verdict;
  /** The raw words, for a spoken or typed answer. Normalised before storage. */
  answerText?: string | null;
  /** True when the safety screen stopped this turn — then nothing is kept. */
  flagged?: boolean;
  misconceptionId?: string;
}

export interface ClassLedger {
  /** A question has surfaced and the class is holding on it. */
  asked(beatId: string, optionCount?: number): void;
  /** The student answered. */
  answered(input: AnsweredInput): void;
  /** A rung of the ladder was handed over. */
  helped(beatId: string, rung: AssistanceRung, requested: boolean): void;
  /** A hand went up. */
  confused(beatId: string): void;
}

interface AskState {
  askedAt: number;
  attempt: number;
  hintsShown: number;
}

/**
 * The rung in force, derived from what has actually been given.
 *
 * The class does not yet withhold help at these rungs — it records which one it
 * was standing on. Today a wrong answer is followed by the authored hint, which
 * is rung 3: "a small hint". Nothing has been given before the first answer, so
 * that answer is rung 0, and rung 0 is the only one that can ever count as
 * unassisted mastery.
 */
const rungOf = (state: AskState | undefined): AssistanceRung => {
  if (!state || state.hintsShown === 0) return 0;
  return state.hintsShown === 1 ? 3 : 4;
};

export function useClassLedger(lesson: Lesson, playing: boolean, ended: boolean): ClassLedger {
  const asks = useRef(new Map<string, AskState>());

  // TIME ON TASK. Not wall clock — the primary metric is per learning MINUTE,
  // and a class paused, backgrounded or left open on a table is not learning.
  const activeMs = useRef(0);
  const since = useRef<number | null>(null);
  const closed = useRef(false);

  const settle = (): void => {
    if (since.current !== null) {
      activeMs.current += Date.now() - since.current;
      since.current = null;
    }
  };

  useEffect(() => {
    openSession({ source: 'class', topicRef: lesson.topicRef, lessonId: lesson.id });
    return () => {
      // A class left by the back button still happened. Closing on unmount
      // means an abandoned session is recorded as abandoned rather than as an
      // open session that never ends — which would quietly poison any average
      // built from `activeMs`.
      settle();
      if (!closed.current) {
        closed.current = true;
        closeSession({ activeMs: activeMs.current, completed: false });
      }
    };
    // One session per lesson mounted. Re-opening on a re-render would file the
    // same class under several sittings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  // The clock runs only while the class is genuinely playing AND on screen.
  useEffect(() => {
    const tick = (): void => {
      const on = playing && document.visibilityState === 'visible';
      if (on && since.current === null) since.current = Date.now();
      else if (!on) settle();
    };
    tick();
    document.addEventListener('visibilitychange', tick);
    return () => {
      document.removeEventListener('visibilitychange', tick);
      settle();
    };
  }, [playing]);

  useEffect(() => {
    if (!ended || closed.current) return;
    settle();
    closed.current = true;
    const ids = outcomesOf(lesson);
    if (ids.length > 0) {
      logEvent({
        kind: 'taught',
        surface: 'tap',
        outcomeIds: ids,
        topicRef: lesson.topicRef,
        payload: { lessonId: lesson.id },
      });
    }
    closeSession({ activeMs: activeMs.current, completed: true });
  }, [ended, lesson]);

  return useMemo<ClassLedger>(
    () => ({
      asked(beatId, optionCount) {
        const prior = asks.current.get(beatId);
        const state: AskState = {
          askedAt: Date.now(),
          attempt: (prior?.attempt ?? 0) + 1,
          hintsShown: prior?.hintsShown ?? 0,
        };
        asks.current.set(beatId, state);
        logEvent({
          kind: 'asked',
          surface: 'tap',
          outcomeIds: answeredOutcomesAtBeat(lesson, beatId),
          topicRef: lesson.topicRef,
          payload: {
            beatId,
            assistanceRung: rungOf(prior),
            attempt: state.attempt,
            optionCount,
          },
        });
      },

      answered(input) {
        const state = asks.current.get(input.beatId);
        const at = state?.askedAt ?? Date.now();
        logAnswer({
          surface: input.surface,
          outcomeIds: answeredOutcomesAtBeat(lesson, input.beatId),
          topicRef: lesson.topicRef,
          beatId: input.beatId,
          chosenIndex: input.chosenIndex,
          correct: input.correct,
          ms: Math.max(0, Date.now() - at),
          attempt: state?.attempt ?? 1,
          assistanceRung: rungOf(state),
          hintsShown: state?.hintsShown ?? 0,
          verdict: input.verdict,
          misconceptionId: input.misconceptionId,
          answerNormalised: normaliseAnswer(input.answerText, { flagged: input.flagged }),
        });
        // A wrong answer does not end the question — the chips stay and the
        // next try is attempt n+1, timed from now.
        if (!input.correct && state) {
          asks.current.set(input.beatId, { ...state, askedAt: Date.now(), attempt: state.attempt + 1 });
        }
      },

      helped(beatId, rung, requested) {
        const state = asks.current.get(beatId);
        if (state) asks.current.set(beatId, { ...state, hintsShown: state.hintsShown + 1 });
        logEvent({
          kind: 'helped',
          surface: 'tap',
          outcomeIds: answeredOutcomesAtBeat(lesson, beatId),
          topicRef: lesson.topicRef,
          payload: { beatId, rung, requested },
        });
      },

      confused(beatId) {
        logEvent({
          kind: 'confused',
          surface: 'tap',
          outcomeIds: outcomesAtBeat(lesson, beatId),
          topicRef: lesson.topicRef,
          payload: { beatId, lessonId: lesson.id },
        });
      },
    }),
    [lesson],
  );
}
