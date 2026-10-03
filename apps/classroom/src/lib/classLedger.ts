import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Lesson } from '@ai-tutor/lesson-format';
import {
  normaliseAnswer,
  normaliseTutorText,
  type AssistanceRung,
  type ReasoningVerdict,
  type Verdict,
} from '@ai-tutor/ledger';
import { answeredOutcomesAtBeat, outcomesAtBeat, outcomesOf } from '../stores/outcomes';
import { closeSession, logAnswer, logEvent, logReflection, openSession } from '../stores/ledger';
import type { WarmUpQuestion } from './warmUp';

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
  /** 'text': worked out in typed steps (T8.1). */
  surface: 'tap' | 'voice' | 'text';
  chosenIndex?: number | null;
  verdict?: Verdict;
  /** The raw words, for a spoken or typed answer. Normalised before storage. */
  answerText?: string | null;
  /** True when the safety screen stopped this turn — then nothing is kept. */
  flagged?: boolean;
  misconceptionId?: string;
  /**
   * When the answer actually LANDED, if that is not the moment of this call.
   *
   * The spoken path calls `answered` only after the judge has replied, so the
   * response time it recorded was the student's thinking PLUS a model round
   * trip — while a tapped answer has nothing in front of it. Spoken answers
   * therefore read systematically slower than tapped ones on a number the
   * learner model weighs as evidence about the student. The caller stamps the
   * moment the mic closed and hands it in here.
   */
  answeredAt?: number;
}

/**
 * WHAT CAME BACK WHEN SHE ASKED WHY — as one field, because it is one fact.
 *
 * This was two: `spoke: boolean` beside `held?: boolean`. Three of the six
 * combinations that shape allows are nonsense — `{ spoke: false, held: true }`
 * says a student who said nothing reasoned well — and `verdictOf` resolved
 * them with a precedence rule and ten lines of prose explaining why `held` is
 * silently discarded when `spoke` is false. A test even constructed
 * `{ spoke: false, held: false }`, a pair no caller can produce, which is the
 * shape admitting it is wrong. Making the bad state unrepresentable is cheaper
 * than the paragraph.
 *
 * The third case is not a tidying. `spoke: heard.text !== null` folded the
 * ear's 'error' into its 'silence': a mic the OS handed to an incoming call,
 * or an AudioContext suspended by a backgrounding, produced a `silent` verdict
 * — a hardware failure written down as a child who could not justify their own
 * right answer.
 */
export type Reasoning =
  /** They spoke. `held` is the close's judgement; absent means it made none. */
  | { said: 'words'; held?: boolean }
  /** The mic worked, and the room stayed quiet. */
  | { said: 'nothing' }
  /** The mic never opened, or the exchange was cancelled. Nobody heard anything. */
  | { said: 'unheard' };

/**
 * A right answer cross-questioned, and what came back.
 *
 * Deliberately not folded into `answered`. A reflection is a SECOND event
 * about the same question: the answer has been recorded — and very likely
 * already drained — by the time the student finishes reasoning about it, and
 * filing this as another `answered` would count one right answer twice in
 * every counter the learner model reads.
 */
export interface ReflectedInput {
  beatId: string;
  /** How the reasoning came: said with the mic on, or typed. Spoken when absent. */
  surface?: 'voice' | 'text';
  /** Her cross-question, verbatim. Composed at runtime, so it exists nowhere else. */
  prompt: string;
  /** The SCREENED reasoning — `close.heard`, never the raw transcript. */
  reasoningText?: string | null;
  /** True when the safety screen stopped this turn — then nothing is kept. */
  flagged?: boolean;
  /** What the ear got, and what the close made of it. */
  reasoning: Reasoning;
  /** When her cross-question finished being spoken and the mic opened. */
  askedAt: number;
  /** When the mic closed on their reasoning. */
  reasonedAt: number;
}

export interface ClassLedger {
  /** A question has surfaced and the class is holding on it. */
  asked(beatId: string, optionCount?: number): void;
  /** The student answered. */
  answered(input: AnsweredInput): void;
  /**
   * The same question is back in front of them, and the clock on it restarts.
   *
   * A wrong answer is followed by a spoken hint, and only when she stops
   * talking can the student try again — so `answered` restarting the clock at
   * its own call charged them the length of the hint. That is the same
   * systematic inflation `answeredAt` exists to remove, and worse, because a
   * hint runs longer than a judge round trip. A pause or a raised hand takes
   * the question away and gives it back the same way, and used to charge them
   * the whole interruption.
   */
  reopened(beatId: string, at: number): void;
  /** The answer was right, she asked why, and they reasoned. */
  reflected(input: ReflectedInput): void;
  /** A rung of the ladder was handed over. */
  helped(beatId: string, rung: AssistanceRung, requested: boolean, strategy?: string): void;
  /** A hand went up. */
  confused(beatId: string): void;
  /**
   * A warm-up question at the start of the class was answered. A review is
   * a cold retrieval of ANOTHER outcome: rung 0, first attempt, filed under
   * the question's own outcome and topic. A skipped warm-up files nothing —
   * wanting to get to the class is not forgetting.
   */
  warmedUp(question: WarmUpQuestion, chosenIndex: number, ms: number): void;
}

interface AskState {
  askedAt: number;
  attempt: number;
  hintsShown: number;
  /**
   * The HIGHEST rung handed over on this question so far.
   *
   * Kept because `helped` is told the rung and used to throw it away: only the
   * COUNT of hints survived, and the rung for the next answer was re-derived
   * from that count as 0, 3 or 4. So a raised hand — a whole tutor
   * conversation about the question, recorded as rung 7 on its own event —
   * produced an answer filed at rung 3, and the judge's leading question
   * (rung 2) and the authored hint (rung 3) were indistinguishable once
   * counted. The ladder was being described correctly on one event and
   * flattened on the one that matters.
   */
  highestRung: AssistanceRung;
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
const rungOf = (state: AskState | undefined): AssistanceRung =>
  !state || state.hintsShown === 0 ? 0 : state.highestRung;

/**
 * ASK STATE THAT SURVIVES THE MOUNT, because the mount is not the question.
 *
 * A remount mid-question — the back button and a return, a bfcache miss, a
 * process restart on a cheap phone — kills BOTH carriers of "this answer was
 * helped" at once: the ask ref dies with the mount, and the fresh mount opens
 * a fresh sitting, so the durable helped row sits in a sitting the fold's
 * per-session help scoping will never read from. The answered row then filed
 * rung 0, and rung 0 is the only rung that mints unassisted mastery — the one
 * error deriveRung documents as uncorrectable downstream (2026-09-16 audit).
 *
 * sessionStorage, not localStorage: the tab is the scope this belongs to. A
 * COMPLETED class clears it (the `ended` effect), so a rewatch next week
 * re-earns rung 0 rather than inheriting a rung that would stop the outcome
 * ever producing an unassisted observation again.
 */
const ASK_MEMORY_KEY = 'ai-tutor:ask-memory';

const loadAskMemory = (lessonId: string): Map<string, AskState> => {
  try {
    const raw = sessionStorage.getItem(ASK_MEMORY_KEY);
    if (raw) {
      const kept = JSON.parse(raw) as { lessonId: string; asks: [string, AskState][] };
      if (kept.lessonId === lessonId) return new Map(kept.asks);
    }
  } catch {
    // Unreadable storage is a cold start, never a crash in a classroom.
  }
  return new Map();
};

const saveAskMemory = (lessonId: string, asks: Map<string, AskState>): void => {
  try {
    sessionStorage.setItem(ASK_MEMORY_KEY, JSON.stringify({ lessonId, asks: [...asks] }));
  } catch {
    // A blocked store loses the remount safety net, never the class.
  }
};

const clearAskMemory = (lessonId: string): void => {
  try {
    const raw = sessionStorage.getItem(ASK_MEMORY_KEY);
    if (!raw) return;
    if ((JSON.parse(raw) as { lessonId?: string }).lessonId !== lessonId) return;
    sessionStorage.removeItem(ASK_MEMORY_KEY);
  } catch {
    // Nothing readable, nothing to clear.
  }
};

/**
 * WHAT A CROSS-QUESTION CAME TO.
 *
 * Silence is decided HERE and outranks the model, because the model is not
 * told the difference: when the mic hears nothing the class sends it the
 * literal string "(said nothing)" so she still closes the loop warmly, and she
 * duly reports that as reasoning which did not hold. That is true and it is
 * not the same fact — a student who tried to justify and could not is not a
 * student who did not try, and folding one into the other would hide the
 * commonest outcome of a cross-question inside the rarest.
 *
 * Undefined is the third real answer and never a default for 'wobbled': a
 * model that failed, a turn the safety screen stopped, a reply that omitted
 * the field, AND a mic that never opened all mean NOBODY WEIGHED IT, and
 * replay moves no belief on that. The last of those is why 'unheard' exists
 * apart from 'nothing': the ear already carries the distinction, and reporting
 * a dead microphone as a student with nothing to say is a judgement about a
 * child made out of a hardware failure.
 */
const verdictOf = (reasoning: Reasoning): ReasoningVerdict | undefined => {
  if (reasoning.said === 'unheard') return undefined;
  if (reasoning.said === 'nothing') return 'silent';
  if (reasoning.held === undefined) return undefined;
  return reasoning.held ? 'held' : 'wobbled';
};

export function useClassLedger(lesson: Lesson, playing: boolean, ended: boolean): ClassLedger {
  const asks = useRef(new Map<string, AskState>());

  // TIME ON TASK. Not wall clock — the primary metric is per learning MINUTE,
  // and a class paused, backgrounded or left open on a table is not learning.
  const activeMs = useRef(0);
  const since = useRef<number | null>(null);
  const closed = useRef(false);
  /**
   * Whether THIS LESSON's `taught` has been filed — one latch per lesson, not
   * per sitting. Kept apart from `closed` because they answer different
   * questions and conflating them lost a whole finished class; reset when the
   * lesson changes, so a second lesson in the same mount files its own.
   */
  const taughtFiled = useRef(false);

  /**
   * What the effect below reads long after the render that set it up.
   *
   * Its listeners are registered once per lesson, so reading `playing` or
   * `ended` directly would answer "is the class running?" as of that one
   * frame, for the rest of the class.
   */
  const live = useRef({ playing, ended });
  live.current = { playing, ended };

  const settle = (): void => {
    if (since.current !== null) {
      activeMs.current += Date.now() - since.current;
      since.current = null;
    }
  };

  /**
   * End the sitting, once.
   *
   * The guard is the whole point rather than a formality: closing a tab fires
   * visibilitychange AND pagehide and then unmounts, so this is called three
   * times in one breath — and two `session-ended` events for one sitting would
   * double-count the denominator of every per-learning-minute figure.
   */
  const closeSitting = (completed: boolean): void => {
    if (closed.current) return;
    closed.current = true;
    settle();
    closeSession({ activeMs: activeMs.current, completed });
  };

  /**
   * A SITTING, not a mount.
   *
   * Every ref above outlives the effect below while that effect re-runs on a
   * new lesson — so a second lesson in the same mount inherited
   * `closed.current === true` from the first one's cleanup and emitted neither
   * `taught` nor `session-ended`, and inherited the first lesson's `activeMs`
   * on top of that. The whole second class went unrecorded.
   *
   * Out here rather than inside that effect because three other things now
   * need to reopen a sitting the browser closed: coming back on screen, a
   * bfcache restore, and anything at all that has an event to file.
   */
  const openSitting = useCallback((): void => {
    activeMs.current = 0;
    // The clock effect below only re-runs when `playing` changes, so a lesson
    // swapped mid-play never ticks it: this sitting starts its own clock or
    // its time on task stays zero for as long as it lasts.
    since.current =
      live.current.playing && document.visibilityState === 'visible' ? Date.now() : null;
    closed.current = false;
    openSession({ source: 'class', topicRef: lesson.topicRef, lessonId: lesson.id });
  }, [lesson.id, lesson.topicRef]);

  /**
   * A DESTINATION FOR THE NEXT EVENT, whatever the browser did in between.
   *
   * The package now refuses an event whose sitting has already ended, which
   * stops it being MIS-FILED. This is the other half, which stops it being
   * LOST: a student speaks, glances at a notification while the judge takes
   * its two to four seconds, and the backgrounding closes the sitting before
   * the answer and the reflection come back. Reopening here costs one extra
   * `session-started`; not reopening cost the answer, the reflection, and the
   * usage rows the relay stamps with `currentSessionId()`.
   */
  const ensureOpen = useCallback((): void => {
    if (closed.current) openSitting();
  }, [openSitting]);

  /** Persist the ask state a remount would otherwise lose. Called after every mutation of `asks`. */
  const remember = useCallback((): void => {
    saveAskMemory(lesson.id, asks.current);
  }, [lesson.id]);

  useEffect(() => {
    // Per LESSON, unlike the three above: a question standing when the student
    // switched apps is the same question when they come back, and resetting
    // this would hand its rung and its attempt count back to zero — filing an
    // answer that had already been helped as unassisted. Beat ids are only
    // unique within a lesson, so a new lesson must not see the old one's.
    // Loaded from the ask memory rather than started empty, so a REMOUNT of
    // the same lesson mid-question keeps its rung too — the memory answers
    // only for this lesson's id and is empty for any other.
    asks.current = loadAskMemory(lesson.id);
    taughtFiled.current = false;
    openSitting();

    /**
     * THE EXITS A REACT CLEANUP NEVER SEES.
     *
     * A tab closed, an app swiped away, a phone that kills the backgrounded
     * process, a reload: not one of them unmounts anything. So no
     * `session-ended` was ever queued, that sitting's time on task — the
     * DENOMINATOR of unassisted mastery gain per learning minute — was lost
     * for good, and the next `openSession` silently replaced a session still
     * recorded as open.
     *
     * `pagehide` is what a real navigation away fires; `visibilitychange` to
     * hidden is the only one mobile Safari reliably fires before the process
     * is frozen.
     *
     * COMING BACK needs both too, and used to be wired to only one. A page
     * restored from the back/forward cache — a tapped link, the back button,
     * the ordinary round trip this block was written for — is guaranteed to
     * fire `pageshow` and is NOT guaranteed to fire a visibility transition,
     * so on the browsers that do not, the sitting stayed closed for the rest
     * of the class: every remaining minute missing from `activeMs`, every
     * event attributed to a sitting already reported as abandoned. The two
     * handlers are idempotent against each other because `reopen` does nothing
     * unless the sitting is actually closed.
     */
    const onPageHide = (): void => closeSitting(false);
    const reopen = (): void => {
      // Back on screen with the class still to finish. This is a SECOND
      // sitting of the same lesson, not a resumption of one already filed:
      // without it every event after the first glance at WhatsApp would be
      // queued against a session that has already ended.
      if (closed.current && !live.current.ended) openSitting();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') closeSitting(false);
      else reopen();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', reopen);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', reopen);
      document.removeEventListener('visibilitychange', onVisibility);
      // A class left by the back button still happened. Closing on unmount
      // means an abandoned session is recorded as abandoned rather than as an
      // open session that never ends — which would quietly poison any average
      // built from `activeMs`.
      closeSitting(false);
    };
    // The lesson, not every render: a re-render must never file one class
    // under several sittings. The one thing that does open a second sitting is
    // the student coming back to a backgrounded class, above.
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

  /**
   * THIS CLASS IS OVER — which is not the same fact as "this sitting is closed".
   *
   * The guard here used to read `closed.current`, and that became wrong the
   * moment a backgrounding could close a sitting mid-class. A student on
   * Android swipes to WhatsApp during the last beat, the tutor is still
   * speaking so the tab keeps its audio exemption and the player runs on, the
   * class finishes hidden — and this effect bailed out permanently, because
   * its deps are `[ended, lesson]` and neither changes again. No `taught`
   * event for a single outcome the lesson had just taught, `completed: false`,
   * the whole class filed as abandoned: the exact 'a kind with no emitter'
   * defect this work exists to end, reintroduced on a different kind.
   */
  useEffect(() => {
    if (!ended || taughtFiled.current) return;
    taughtFiled.current = true;
    // The sitting the backgrounding closed cannot hold this; a new one can.
    ensureOpen();
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
    // After the taught event, so the sitting's last event is the one that ends it.
    closeSitting(true);
    // A finished class is a closed question. Clearing here — and only on the
    // COMPLETED close — is what lets a rewatch re-earn rung 0 while an
    // interrupted question keeps its rung across a remount.
    clearAskMemory(lesson.id);
  }, [ended, lesson, ensureOpen]);

  return useMemo<ClassLedger>(
    () => ({
      asked(beatId, optionCount) {
        ensureOpen();
        const prior = asks.current.get(beatId);
        const state: AskState = {
          askedAt: Date.now(),
          /**
           * A QUESTION PUT AGAIN IS A NEW TRY — fixed at the layer that can
           * tell, which is not this one.
           *
           * This briefly became `prior?.attempt ?? 1`, because a pause or a
           * raised hand re-surfaced a held ask and ClassRoom filed a second
           * `asked` for the same standing question, inflating the attempt a
           * first answer was recorded at. `askFiled` in ClassRoom now stops
           * that second event happening at all — the right layer, because only
           * the screen knows whether the question went away or merely blinked.
           *
           * With the duplicate gone this is correct again and the flattening
           * is not: the one case left that reaches here twice is a genuine
           * re-ask after a seek back, and after a right answer `answered`
           * never bumps, so two distinct answers to the same beat were both
           * being filed as attempt 1. A wrong answer bumps in `answered`, a
           * seek-back re-ask bumps here, and a pause bumps nothing.
           */
          attempt: (prior?.attempt ?? 0) + 1,
          hintsShown: prior?.hintsShown ?? 0,
          highestRung: prior?.highestRung ?? 0,
        };
        asks.current.set(beatId, state);
        remember();
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
        ensureOpen();
        const state = asks.current.get(input.beatId);
        const at = state?.askedAt ?? Date.now();
        logAnswer({
          surface: input.surface,
          outcomeIds: answeredOutcomesAtBeat(lesson, input.beatId),
          topicRef: lesson.topicRef,
          beatId: input.beatId,
          chosenIndex: input.chosenIndex,
          correct: input.correct,
          ms: Math.max(0, (input.answeredAt ?? Date.now()) - at),
          attempt: state?.attempt ?? 1,
          assistanceRung: rungOf(state),
          hintsShown: state?.hintsShown ?? 0,
          verdict: input.verdict,
          misconceptionId: input.misconceptionId,
          answerNormalised: normaliseAnswer(input.answerText, { flagged: input.flagged }),
        });
        /**
         * A wrong answer does not end the question — the chips stay and the
         * next try is attempt n+1.
         *
         * The clock is moved to the moment THEIR answer landed, not to now.
         * Now is the judge's return, which would put its two-to-four-second
         * round trip at the head of the retry — the same inflation
         * `answeredAt` exists to remove. It is a floor and not the answer:
         * what actually starts the retry is the mic reopening after she has
         * finished speaking the hint, and `reopened` stamps that. Without this
         * line a caller that forgot to call `reopened` would charge attempt 2
         * with the whole of attempt 1.
         */
        if (!input.correct && state) {
          asks.current.set(input.beatId, {
            ...state,
            askedAt: input.answeredAt ?? Date.now(),
            attempt: state.attempt + 1,
          });
          remember();
        }
      },

      reopened(beatId, at) {
        const state = asks.current.get(beatId);
        // No event: this moves the clock and says nothing about the student.
        // A beat with no ask state is one nobody has asked, and there is
        // nothing to restart.
        if (state) {
          asks.current.set(beatId, { ...state, askedAt: at });
          remember();
        }
      },

      reflected(input) {
        ensureOpen();
        // The same ask state the answer was filed under, deliberately read and
        // not advanced: this is evidence about THAT answer, so reasoning that
        // held after three hints must not read as unassisted mastery. Nothing
        // here mutates the map — a reflection is not another try.
        const state = asks.current.get(input.beatId);
        logReflection({
          surface: input.surface ?? 'voice',
          outcomeIds: answeredOutcomesAtBeat(lesson, input.beatId),
          topicRef: lesson.topicRef,
          beatId: input.beatId,
          // THE ONLY FREE TEXT HERE THAT USED TO SKIP NORMALISATION. Model
          // text composed at runtime about the student's own answer, so it can
          // quote them back — and it went into a jsonb column uncapped, with
          // its invisible characters unstripped, three lines above a
          // `reasoningNormalised` doing it correctly. `normaliseTutorText`
          // rather than `normaliseAnswer` because these are HER words: see
          // there for why a flagged turn keeps the question it asked.
          prompt: normaliseTutorText(input.prompt),
          // Her question landing to their reasoning landing. NOT `askedAt`
          // from the state above — that is the clock on the original question,
          // and reusing it would report the whole exchange as the time they
          // took to justify. The caller stamps both ends of this one.
          ms: Math.max(0, input.reasonedAt - input.askedAt),
          attempt: state?.attempt ?? 1,
          assistanceRung: rungOf(state),
          reasoningVerdict: verdictOf(input.reasoning),
          reasoningNormalised: normaliseAnswer(input.reasoningText, { flagged: input.flagged }),
        });
      },

      helped(beatId, rung, requested, strategy) {
        ensureOpen();
        const state = asks.current.get(beatId);
        if (state) {
          asks.current.set(beatId, {
            ...state,
            hintsShown: state.hintsShown + 1,
            // The highest, never the latest: help already given cannot be taken
            // back, so a small nudge after a full explanation does not return
            // the student to a lower rung.
            highestRung: (rung > state.highestRung ? rung : state.highestRung) as AssistanceRung,
          });
          remember();
        }
        logEvent({
          kind: 'helped',
          surface: 'tap',
          outcomeIds: answeredOutcomesAtBeat(lesson, beatId),
          topicRef: lesson.topicRef,
          payload: { beatId, rung, requested, ...(strategy ? { strategy } : {}) },
        });
      },

      confused(beatId) {
        ensureOpen();
        logEvent({
          kind: 'confused',
          surface: 'tap',
          outcomeIds: outcomesAtBeat(lesson, beatId),
          topicRef: lesson.topicRef,
          payload: { beatId, lessonId: lesson.id },
        });
      },

      warmedUp(question, chosenIndex, ms) {
        ensureOpen();
        const correct = chosenIndex === question.correctIndex;
        const named = correct ? undefined : question.misconceptions[chosenIndex];
        logAnswer({
          surface: 'tap',
          outcomeIds: [question.nodeId],
          topicRef: question.topicRef,
          probeId: question.id,
          chosenIndex,
          correct,
          ms: Math.max(0, ms),
          attempt: 1,
          assistanceRung: 0,
          hintsShown: 0,
          verdict: correct ? 'right' : 'wrong',
          misconceptionId: named && named.trim() !== '' ? named : undefined,
        });
      },
    }),
    [lesson, ensureOpen, remember],
  );
}
