import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Beat, Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '@ai-tutor/stage';
import { usePlayer, type TtsAdapter } from '@ai-tutor/player';
import {
  buildContext,
  createHandoff,
  createStubAgent,
  type HandoffState,
} from '@ai-tutor/doubt-session';
import { findEntry, fetchLesson, type CatalogEntry } from '../lib/content';
import { useLessonVoice } from '../lib/lessonVoice';
import { useLessonAssets } from '../lib/diagrams';
import { buildStudentContext, firstName } from '../lib/student';
import { createGeminiAgent, type TurnUsage } from '../lib/geminiAgent';
import { createLiveAgent, type LiveState, type TranscriptLine } from '../lib/liveAgent';
import {
  micExplained,
  micStatus,
  rememberMicExplained,
  requestMic,
  type MicStatus,
} from '../lib/mic';
import { listenOnce } from '../lib/ear';
import { resolveCrossQuestion, resolveSpokenAnswer } from '../lib/judge';
import { progressStore, saveBeat, markCompleted, isCompleted } from '../stores/progress';
import { doubtLogStore, logDoubt } from '../stores/doubtLog';
import {
  outcomesOf,
  recordAnswerAtBeat,
  recordDoubtAtBeat,
  recordLessonTaught,
} from '../stores/outcomes';
import { masteryFromModel } from '../lib/learnerModel';
import { useClassLedger } from '../lib/classLedger';
import { profileStore } from '../stores/profile';
import { settingsStore } from '../stores/settings';
import { preferencesStore, setPreference } from '../stores/preferences';
import { useStore } from '../stores/localStore';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/States';
import { createSessionHalt } from '../lib/sessionHalt';
import { useBoardSession } from '../lib/boardSession';
import { createDoubtBoard } from '../lib/doubtBoard';
import { sayRevealing } from '../lib/voiceStart';
import { tutorLanguage } from '../lib/workspace';
import { LINES, asksForHint, asksToExplainAgain, decide } from '@ai-tutor/tutor-control';
import { fromStudent, inLanguage } from '../lib/safety';
import { screen } from '@ai-tutor/safety';
import {
  clearCommitment,
  greetingMemory,
  markStruggleMentioned,
  memoryNotes,
  recordDoubtTopic,
  recordStruggle,
  recordWin,
  setLastSession,
} from '../lib/studentMemory';
import type { AssistanceRung } from '@ai-tutor/ledger';
import { track } from '../lib/telemetry';
import { ReportSheet } from '../ui/ReportSheet';
import { MicRationale } from '../ui/MicRationale';
import { TutorTile, type TutorMode } from '../ui/TutorTile';
import type { ClipManifest } from '@ai-tutor/teacher-clone';
import { DoubtPanel } from '../ui/DoubtPanel';
import { SupportScreen } from '../ui/SupportScreen';
import { WorkPanel, type WorkedStep } from '../ui/WorkPanel';
import { mathPlain } from '@ai-tutor/lesson-format';
import { equationIn, sameEquation } from '@ai-tutor/maths-check';

/**
 * How long the controls stay after the last touch. Long enough to find the
 * raise-hand button without hunting, short enough that the class is not
 * competing with its own toolbar for the screen.
 */
const CONTROLS_IDLE_MS = 3_500;

/**
 * The joining pause before the class starts itself. A student does not press
 * play on a live class — they arrive, the room readies itself, the teacher
 * begins. The wait is also real headroom: the recorded take's first audio
 * fetch and the speech pipeline warm up behind it.
 */
const PREPARE_MS = 5_000;

/**
 * How long a held question sits quiet before she nudges. Silence is thinking
 * (persona `moments.ts`); the endpointer's few seconds are only how long one
 * listen waits. A placeholder, like FAST_WRONG_MS: nobody has measured how
 * long a Class 6-10 student thinks before they are stuck (UNVERIFIED).
 */
const QUIET_BEFORE_NUDGE_MS = 20_000;

/** Route wrapper: /lesson/:lessonId → load + validate, then hand to the classroom. */
export function LessonRoute() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A lesson that would not load left "Back home" as the only way out, which
  // turns one failed request into a class the student does not get to have.
  const [attempt, setAttempt] = useState(0);
  const preferences = useStore(preferencesStore);

  // Resolved HERE rather than inside the classroom because usePlayer rebuilds
  // its controller when the adapter's identity changes: a voice that arrived a
  // moment late would restart the class from the top.
  const tts = useLessonVoice(entry, lesson, { enabled: preferences.voice });
  // Resolved here for the same reason the voice is: the classroom should not
  // remount because a picture arrived a moment after the lesson did.
  const diagrams = useLessonAssets(entry, lesson);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      const found = lessonId ? await findEntry(lessonId) : null;
      if (!found) throw new Error('This lesson does not exist.');
      const loaded = await fetchLesson(found);
      if (!cancelled) {
        setEntry(found);
        setLesson(loaded);
      }
    })().catch((e) => {
      if (!cancelled) setError(String(e instanceof Error ? e.message : e));
    });
    return () => {
      cancelled = true;
    };
  }, [lessonId, attempt]);

  if (error) {
    return (
      <div className="bg-background min-h-screen grid place-items-center px-margin-mobile font-body-md">
        <div className="text-center flex flex-col items-center gap-4">
          <Icon name="error" className="text-4xl text-on-surface-variant" />
          <p className="font-headline-md text-[18px] leading-6 text-on-surface">{error}</p>
          <div className="flex items-center gap-3">
            {/* A lesson that does not exist is the one failure another go
                cannot fix; anything else is worth pressing once more. */}
            {error !== 'This lesson does not exist.' && (
              <button
                onClick={() => setAttempt((n) => n + 1)}
                className="bg-stage-primary text-on-stage-primary rounded-full px-6 py-3 font-label-md text-label-md font-semibold border-b-4 border-stage-primary-edge active:border-b-0 active:translate-y-1 transition-all"
              >
                Try again
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="text-on-surface-variant font-label-md text-label-md px-5 py-3 rounded-full hover:bg-surface-container-high transition-colors"
            >
              Back home
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!lesson || !tts) {
    return (
      <div
        role="status"
        aria-busy="true"
        className="bg-background min-h-screen grid place-items-center font-body-md px-margin-mobile"
      >
        <div className="w-full max-w-[560px] flex flex-col items-center gap-4">
          <span className="sr-only">Opening your class</span>
          {/* The shape of the room, not a spinner: the board, then the strip of
              controls under it. Nothing moves when the real thing arrives. */}
          <Skeleton className="w-full aspect-video rounded-[24px]" />
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-full" />
            <Skeleton className="w-12 h-12 rounded-full" />
            <Skeleton className="w-12 h-12 rounded-full" />
          </div>
        </div>
      </div>
    );
  }
  return <ClassRoom lesson={lesson} tts={tts} diagrams={diagrams} onExit={() => navigate("/")} />;
}

/** m:ss, the way a call timer reads. */
const formatClock = (totalSeconds: number): string => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** One round Meet-style control. */
function ToolButton({
  icon,
  label,
  onClick,
  disabled = false,
  tone = 'plain',
  big = false,
}: {
  icon: string;
  label: string;
  onClick(): void;
  disabled?: boolean;
  tone?: 'plain' | 'primary' | 'green' | 'red' | 'lit';
  big?: boolean;
}) {
  const tones: Record<string, string> = {
    plain: 'bg-stage-surface text-stage-ink',
    primary: 'bg-stage-primary text-on-stage-primary',
    green: 'bg-[#188038] text-white',
    red: 'bg-stage-red text-white',
    lit: 'bg-stage-blue text-stage',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`rounded-full grid place-items-center shadow-md transition-transform active:scale-95 disabled:opacity-40 ${
        big ? 'w-[62px] h-[62px]' : 'w-[50px] h-[50px]'
      } ${tones[tone]}`}
    >
      <Icon name={icon} filled className={big ? 'text-[28px]' : 'text-[22px]'} />
    </button>
  );
}

/**
 * The classroom — laid out the way Meet lays out a call with a presentation,
 * because "a Google Meet where an AI teacher is taking a live class" is the
 * product. The board is the shared screen and takes everything; Meera is a
 * participant tile (side rail on wide screens, PiP on a phone); the top bar
 * says whose class this is and whether it is the recording or the live tutor;
 * the toolbar holds the controls and fades away like Meet's.
 *
 * Wiring only — every decision this screen appears to make is actually made
 * inside a package:
 *   what's on the canvas   → stage (computeVisible / Scene)
 *   when beats advance     → player
 *   the raise-hand handoff → doubt-session
 *   when the class stops   → lib/sessionHalt (distress in the student's words or a model's)
 */
export function ClassRoom({
  lesson,
  tts,
  diagrams,
  clone,
  onExit,
  warm = false,
  remember = true,
}: {
  lesson: Lesson;
  /**
   * A real teacher, lip-dubbed, instead of Qrie own penguin. Absent for
   * every ordinary class - this is the client-clone path, and the room is
   * otherwise identical either way.
   */
  clone?: { manifest: ClipManifest; baseUrl: string; name: string };
  /** Resolved by the route: the recorded take, her live voice, or the browser's. */
  tts: TtsAdapter;
  /** SVG markup for the lesson's `diagram` elements, keyed by element id. */
  diagrams: Record<string, string>;
  onExit(): void;
  /**
   * The student has ALREADY been through a getting-ready screen.
   *
   * A live class hands the room over the moment the teaching holds, having
   * shown the student a full minute of "Meera is preparing your class". Making
   * them sit through this room's own five-second version too is the same wait
   * twice, with near-identical copy and the same animation — and warm entry
   * exists precisely to make the wait shorter, not to move it.
   */
  warm?: boolean;
  /**
   * Whether her notebook (lib/studentMemory.ts) may note this class. False for
   * a free-text or brought-in-page class: its titles and topics are built from
   * the child's own words, which the notebook never keeps.
   */
  remember?: boolean;
}) {
  const navigate = useNavigate();
  const player = usePlayer(lesson, tts);

  /**
   * THE LIVE BOARD (T2.3, 2026-09-29): the lesson Scene draws, with this
   * session's live ink laid over it — what Meera writes and marks during a
   * doubt, and at a held question. It is NEVER handed to the player: the
   * player rebuilds on a new lesson identity, which would restart the class.
   */
  const board = useBoardSession(lesson);
  const boardRef = useRef(board);
  boardRef.current = board;
  /** The question the class was holding when the hand went up — its answer must not be given away. */
  const heldAskRef = useRef<Beat['ask'] | null>(null);

  /**
   * The ledger runs alongside the outcome counters, not instead of them.
   *
   * The counters say a student got something right; the ledger says which
   * option, how long they took, which try it was, and whether a hint had
   * already been handed over. Swapping the model onto it is a later phase —
   * this one only has to start writing things down, because a class taught
   * before the record exists is a class nobody can ever learn from.
   */
  const ledger = useClassLedger(lesson, player.state === 'playing', player.state === 'ended');

  // Refs so the (stable) handoff and the halt always reach the latest controls.
  const playerRef = useRef(player);
  playerRef.current = player;
  const ttsRef = useRef(tts);
  ttsRef.current = tts;
  const lessonIdRef = useRef(lesson.id);
  lessonIdRef.current = lesson.id;

  /**
   * THE SUPPORT LINE, once the class has halted — and then the room is
   * replaced by the support screen. Null for every ordinary moment of a class.
   */
  const [support, setSupport] = useState<string | null>(null);

  /**
   * ONE HALT, FOR EVERY WAY INTO THE CLASS, AND EVERYTHING SHE SAYS GOES
   * THROUGH IT.
   *
   * `halt.say` is the screened voice: her words are looked at before the
   * student hears them, and a line the screen replaces with the support reply
   * stops the class. `halt.heard` and `halt.typedDoubt` do the same for the
   * student's own words. Whichever path finds distress, the same thing
   * happens (lib/sessionHalt.ts): the doubt ends with no exit line, the ear
   * closes, the recording pauses, she stops mid-sentence, the support line is
   * said, and this room becomes the support screen. Nothing resumes it.
   *
   * WHAT IT SCREENS. Her words where a model wrote them and they are said
   * NOW — the doubt tutor, the judge's and the close's replies to a spoken
   * answer — through `halt.say`, where a line the screen replaces halts the
   * class.
   *
   * THE LESSON'S OWN WORDS said now — the why or hint for a tapped option, a
   * whyProbe's reply matched on the device — go through `halt.sayAuthored`
   * instead. Refused after a halt like everything else, but a line there that
   * trips the screen is WITHHELD and the class carries on: those lines were
   * screened where the lesson was made, by a screen with a reader that lets a
   * curriculum line through (a character in a story saying something
   * distressing; class-prep's distressReading.ts), and this screen has no
   * reader. Halting on one put a student who had only tapped onto the
   * helpline screen. lib/sessionHalt.ts has the rest.
   *
   * The narration the player speaks beat by beat does not come through here.
   * It is screened where it is made: `prepareClass` runs `screenSpine` over
   * the whole lesson before the draft reaches the first student
   * (packages/class-prep/src/prepare.ts), and the relay runs its check again
   * when a class is kept (`checkSavedClass`, packages/relay/src/relays.ts).
   *
   * Made ONCE per room, not per render: `halted` is the one fact about this
   * class that must never be forgotten by a re-render. It reaches the player,
   * the voice, the handoff and the ear through refs, so it always acts on the
   * current ones.
   */
  const [halt] = useState(() =>
    createSessionHalt({
      tts: {
        speak: (text) => ttsRef.current.speak(text),
        cancel: () => ttsRef.current.cancel(),
        // The line primed for the next beat, on a voice that primes.
        drop: () => ttsRef.current.drop?.(),
      },
      player: { pause: () => playerRef.current.pause() },
      // The listen in flight polls `halt.halted` on every chunk (see the ear
      // below) and closes the mic on the next one; this clears its status.
      ear: { close: () => setEar('off') },
      doubt: { halt: () => handoffRef.current.halt() },
      // No ink is written, drawn or recalled after a halt.
      board: { freeze: () => boardRef.current.freeze() },
      showSupport: (line) => setSupport(line),
      lessonId: () => lessonIdRef.current,
    }),
  );

  /**
   * HER OWN LINES — the greeting, praise, hints, nudges, replies to a spoken
   * answer — as distinct from the narration the player speaks.
   *
   * Captioned while they are said: the caption used to keep showing the
   * question's narration while she said "not quite" or "take your time", so a
   * student with the sound low never saw them. And counted, so the
   * quiet-tapper timer never talks over one (overnight review #25, #34).
   * `modelCause` marks a model's words, which get the halting screen; the rest
   * are the lesson's or fixed persona lines (`sayAuthored`).
   */
  const [tutorLine, setTutorLine] = useState<string | null>(null);
  const speaking = useRef(0);
  const sayLine = async (text: string, modelCause?: 'ear'): Promise<{ halted: boolean; said: string }> => {
    speaking.current += 1;
    try {
      return modelCause
        ? await halt.say(text, modelCause, setTutorLine)
        : await halt.sayAuthored(text, setTutorLine);
    } finally {
      speaking.current -= 1;
      if (speaking.current === 0) setTutorLine(null);
    }
  };

  /**
   * Bumped by every tap and hint request on a held question. The ear's listen
   * polls it, so a tap closes the open mic at once — its silence timer used to
   * run on under her feedback and the silence nudge cut her off mid-sentence
   * (overnight review #20). `tapSettled` resolves when her reply to the tap is
   * over, which is when the ear may listen again.
   */
  const tapEpoch = useRef(0);
  /** The held question whose last line was a C7 follow-up, waiting on their reasoning. */
  const followUpOpen = useRef<string | null>(null);
  const tapSettled = useRef<Promise<void>>(Promise.resolve());
  const beginTap = (): (() => void) => {
    tapEpoch.current += 1;
    let settle: () => void = () => undefined;
    tapSettled.current = new Promise<void>((resolve) => {
      settle = resolve;
    });
    return settle;
  };

  /** The held question's answer as an option index, for a gate she closes herself. */
  const correctIndex = (ask: { options?: readonly { correct?: boolean }[] }): number =>
    // -1 when no option is marked: the player reads that as an open question and resolves it.
    (ask.options ?? []).findIndex((o) => o.correct === true);

  /**
   * The student answers a held question.
   *
   * Order matters on a RIGHT answer: the why is spoken while the class is
   * still holding, THEN the gate opens — answering first would start the next
   * beat's line and cancel the why mid-sentence. A wrong answer resolves
   * nothing: the hint is spoken and the chips stay, because wrong gets a
   * nudge and another try, never the solution on the first miss.
   */
  /**
   * "Give me a hint" (a quick reply). The next rung up to the hint, decided by
   * decide() like every other help, filed as ASKED-FOR help before it is said,
   * and written into the question's work area.
   */
  /**
   * "Explain it another way" (H4) goes the same road as a hint asked for:
   * decide() picks an authored re-explanation that does not give the answer
   * away, files it as the L7 it is, and the ladder does not climb.
   */
  const requestHint = () => requestHelp('hintRequest');
  const requestExplain = () => requestHelp('explainRequest');
  const requestHelp = async (verdict: 'hintRequest' | 'explainRequest') => {
    if (halt.halted) return;
    const ask = player.pendingAsk;
    if (!ask || !player.beat) return;
    const beatId = player.beat.id;
    setAskBusy(true);
    const settle = beginTap();
    try {
      const action = decide({
        verdict,
        attempt: (tapTries.current.get(beatId) ?? 0) + 1,
        rungSoFar: tapRung.current.get(beatId) ?? 0,
        ask,
        lang: tutorLanguage(),
        now: Date.now(),
        recentLines: recentLines.current,
      });
      tapRung.current.set(beatId, action.rung);
      if (action.helped !== null) ledger.helped(beatId, action.helped, true, action.strategy);
      followUpOpen.current = null;
      // Only what decide() approved goes on the board: it has refused an
      // authored hint that gives the answer away, and falling back to that
      // hint here put the answer up anyway (overnight review #11/#22).
      const hintText = action.boardIntent?.text;
      if (hintText) board.writeHeld(beatId, [{ author: 'lesson', steps: [{ say: '', ink: [{ op: 'note', text: hintText }] }] }]);
      if (action.say) {
        recentLines.current = [...recentLines.current.slice(-8), action.say];
        const spoken = await sayLine(action.say);
        if (spoken.halted) return;
      }
      ledger.reopened(beatId, Date.now());
    } finally {
      setAskBusy(false);
      settle();
    }
  };

  /**
   * WORKING IT OUT, STEP BY STEP (T8.1). On an open question whose board form
   * holds an equation, the student can type their working a line at a time;
   * each step is checked against the last (maths-check `checkStep`), written
   * on the board in their name with a tick or a cross, and answered in her
   * words. A step that solves it is their answer, recorded as typed.
   */
  const [working, setWorking] = useState(false);
  const workStart = useMemo(() => {
    const written = player.pendingAsk?.written;
    const eq = written?.match(/\$([^$]*=[^$]*)\$/)?.[1];
    return eq ? mathPlain(`$${eq}$`) : null;
  }, [player.pendingAsk]);
  const workable = Boolean(player.pendingAsk && !(player.pendingAsk.options ?? []).length && workStart);
  useEffect(() => setWorking(false), [player.beat?.id]);

  const onWorkedStep = async (step: WorkedStep) => {
    if (halt.halted) return;
    const ask = player.pendingAsk;
    if (!ask || !player.beat) return;
    const beatId = player.beat.id;
    const hi = tutorLanguage() === 'hi-en';
    const v = step.verdict;
    const mark = v.ok === true ? '✓' : v.ok === false ? '✗' : '?';
    board.writeHeld(beatId, [{ author: 'student', steps: [{ say: '', ink: [{ op: 'write', text: `${mark} ${step.text}` }] }] }]);
    const settle = beginTap();
    // The step IS the answer when it solves the equation, or when it is the
    // equation the question asks for ("what remains on each side?" — the
    // expected answer is itself an equation, and a step equal to it is it).
    const expectedEq = ask.expect ? equationIn(ask.expect) : null;
    const isTheAnswer = v.ok === true && (Boolean(v.solved) || (expectedEq !== null && sameEquation(expectedEq, step.text)));
    try {
      if (isTheAnswer) {
        // Solved: their answer, worked out and checked line by line.
        recordAnswerAtBeat(lesson, beatId, true);
        ledger.answered({ beatId, correct: true, surface: 'text', answerText: step.text });
        const praise = decide({
          verdict: 'right',
          attempt: (tapTries.current.get(beatId) ?? 0) + 1,
          rungSoFar: tapRung.current.get(beatId) ?? 0,
          ask,
          lang: tutorLanguage(),
          now: Date.now(),
          recentLines: recentLines.current,
        });
        setWorking(false);
        if (praise.say) {
          const spoken = await sayLine(praise.say);
          if (spoken.halted) return;
        }
        player.answer(correctIndex(ask));
        return;
      }
      const line =
        v.ok === true
          ? hi ? 'Haan, yeh step sahi hai. Aage badho.' : 'Good — that step holds. Keep going.'
          : v.ok === false && v.kind === 'arithmetic'
            ? hi ? 'Method theek hai, par ek calculation galat hai — use dobara nikaalo.' : 'Your method is fine, but one calculation is off — work it out again.'
            : v.ok === false
              ? hi ? 'Hmm, isse equation badal gaya. Jo ek side ke saath karo, wahi doosri side ke saath bhi karo.' : 'Hmm, that changes the equation. Whatever you do to one side, do to the other.'
              : hi ? 'Yeh step main padh nahi paayi — aise likho: 3x + 12 = 21.' : "I couldn't read that step — write it like 3x + 12 = 21.";
      await sayLine(line);
    } finally {
      settle();
    }
  };

  /** Per held question: taps so far, and the highest ladder rung delivered (decide()). */
  const tapTries = useRef(new Map<string, number>());
  /** Held questions the student raised a hand on — help, so no "win" is noted there. */
  const helpedByDoubt = useRef(new Set<string>());
  const tapRung = useRef(new Map<string, AssistanceRung>());
  /** Her recent fixed lines, so decide() never says the same one twice in a row. */
  const recentLines = useRef<string[]>([]);

  // True while an answer is being weighed or spoken about — the choices hide
  // AT ONCE on a tap or a heard answer, so nothing on screen suggests the
  // class did not register it. They return only if the answer was wrong.
  const [askBusy, setAskBusy] = useState(false);

  /**
   * A TAP NEVER COST ANYTHING AND STILL DOES NOT.
   *
   * The whyProbe change below is about the SPOKEN path: a tapped chip already
   * names its option, so `option.why` was always spoken with no model in the
   * loop. A probe on the same beat mirrors those options rather than replacing
   * them (`askedAs: 'options'` is the confusable-pairs exception), so there is
   * nothing here to rewire.
   */
  const answerAsk = async (index: number) => {
    if (halt.halted) return;
    const ask = player.pendingAsk;
    if (!ask || !player.beat) return;
    const option = ask.options?.[index];
    const correct = option ? option.correct === true : true;
    const beatId = player.beat.id;
    /**
     * An OPEN ask has no options, and its button is a "carry on" — the
     * player's gate resolution, not an answer. It used to be recorded as a
     * correct answer at rung 0, which is the strongest evidence this system
     * can hold, invented from a tap that said nothing about what the student
     * knows. An open question is answered by SPEAKING, and the ear's path
     * records that; a student with no microphone records nothing here, which
     * is the honest outcome.
     */
    const isEvidence = Boolean(option);
    if (isEvidence) {
      recordAnswerAtBeat(lesson, beatId, correct);
      ledger.answered({ beatId, correct, surface: 'tap', chosenIndex: index });
    }
    setAskBusy(true);
    const settle = beginTap();
    try {
      // An open ask's "carry on" is not an answer: it only opens the gate.
      if (!option) {
        player.answer(index);
        return;
      }
      /**
       * THE LADDER, DECIDED BY THE LAM, NOT BY A LITERAL (E2/E3, 2026-09-29).
       *
       * `decide()` (@ai-tutor/tutor-control) picks the action from this ask's
       * attempt and the help already given: a first miss gets a content-free
       * "look again" (L1), a second the authored hint (L3), a third the answer
       * and why (L8); a right answer gets brief praise with the authored why.
       * Its words are the lesson's own or fixed persona lines — never invented
       * — in the child's language. The help is filed BEFORE it is said or
       * written, so the next attempt already stands on the right rung.
       *
       * They go through the halt's voice for the lesson (`sayAuthored`):
       * refused once the class has halted, and a line that trips the distress
       * screen is withheld rather than said (lib/sessionHalt.ts).
       */
      const attempt = (tapTries.current.get(beatId) ?? 0) + 1;
      tapTries.current.set(beatId, attempt);
      const action = decide({
        verdict: correct ? 'right' : 'wrong',
        attempt,
        rungSoFar: tapRung.current.get(beatId) ?? 0,
        ask,
        matchedOption: index,
        lang: tutorLanguage(),
        now: Date.now(),
        recentLines: recentLines.current,
      });
      tapRung.current.set(beatId, action.rung);
      if (action.helped !== null) ledger.helped(beatId, action.helped, action.requested, action.strategy);
      if (action.say) recentLines.current = [...recentLines.current.slice(-8), action.say];
      // A follow-up asked about their pick: what they say next is reasoning.
      followUpOpen.current = action.followUp ? beatId : null;
      // Her notebook (lib/studentMemory.ts): a miss marks the topic hard; a
      // right answer with no help at all marks it a win.
      const where = { topic: player.beat.topic, lessonId: lesson.id };
      if (remember && !correct) recordStruggle(where);
      else if (remember && (tapRung.current.get(beatId) ?? 0) === 0 && attempt === 1 && !helpedByDoubt.current.has(beatId))
        recordWin(where);
      if (correct) {
        if (action.say) {
          const spoken = await sayLine(action.say);
          if (spoken.halted) return;
        }
        player.answer(index);
      } else {
        player.answer(index);
        /**
         * THE BOARD AT A HELD QUESTION (T2.5): their pick goes into the work
         * area under the question, and the hint or the answer beside it — the
         * way a tutor writes the student's attempt down before helping with it.
         * Only what decide() approved: its leak check has already refused a
         * hint that gives the answer away (overnight review #11/#22).
         */
        const written = action.boardIntent?.text;
        board.writeHeld(beatId, [
          { author: 'student', steps: [{ say: '', ink: [{ op: 'write', text: `✗ ${option.text}` }] }] },
          ...(written ? [{ author: 'lesson' as const, steps: [{ say: '', ink: [{ op: 'note', text: written }] }] }] : []),
        ]);
        if (action.say) {
          const spoken = await sayLine(action.say);
          if (spoken.halted) return;
        }
        /**
         * "LET'S KEEP GOING" HAS TO MEAN IT (overnight review #10/#26). After
         * the reveal, decide() moves on and schedules a retest; she says so,
         * and the class used to stay on the question with the chips back.
         * The gate opens on the answer she has already shown — nothing new is
         * recorded, the miss above stands.
         */
        if (action.kind === 'moveOn') {
          player.answer(correctIndex(ask));
          return;
        }
        // And the clock on the retry starts when she stops, not when they
        // missed: the chips come back now. Same rule as the spoken path.
        ledger.reopened(beatId, Date.now());
      }
    } finally {
      setAskBusy(false);
      settle();
    }
  };

  const [handoffState, setHandoffState] = useState<HandoffState>('PLAYING');
  /**
   * "I'M NOT SURE" MEANS SOMETHING, SO THE CHIP SAYS IT (overnight review #28).
   *
   * It used to raise a hand and stop: Meera asked "what's your doubt?" and
   * waited on typing, and on a phone the input stayed hidden behind the
   * keyboard button. Now the chip's own words go to her as the student's
   * first message once the doubt is live — she already knows the question
   * that is holding and must not answer it (geminiAgent's board brief) — and
   * the typing row is opened for whatever they say next.
   */
  const notSureOpener = useRef<string | null>(null);
  const sendTextRef = useRef<(text: string, opts?: { opener?: boolean }) => void>(() => undefined);
  const [textLines, setTextLines] = useState<TranscriptLine[]>([]);
  const [, setRecallBeatId] = useState<string | null>(null);

  // Live-voice session state, fed by the live agent's callbacks.
  const [liveState, setLiveState] = useState<LiveState>('connecting');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [muted, setMuted] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  // The controls fade out of a class in progress and come back on any touch,
  // exactly as Meet's do. The board never moves when they go — they only fade —
  // so the camera is not re-framing every 3.5 seconds.
  const [controlsShown, setControlsShown] = useState(true);
  // A student must always have a way to say "this was wrong". It lives in the
  // room rather than in Settings, because the moment they want it is the
  // moment it happened.
  const [reporting, setReporting] = useState(false);

  /**
   * THE WARM ASK, IN FRONT OF THE SYSTEM ONE.
   *
   * Held as the resolver of a promise rather than a boolean, because the ear
   * is in the middle of an async sequence when it needs an answer: it asks,
   * waits for the student, and carries on with whatever they said. A flag
   * would need the whole sequence rewritten around a re-render.
   */
  const [micAsk, setMicAsk] = useState<((allowed: boolean) => void) | null>(null);

  /**
   * Ask for the mic, explaining first if we never have.
   *
   * On the web a refused prompt costs little — it comes back next time. On a
   * phone it does not: two refusals on Android and one on iOS and the prompt
   * never appears again. So the student meets a sentence they understand
   * before they meet a system dialog, and "not now" is a real answer that
   * costs nothing — the chips under her question still work.
   */
  const askForMic = async (): Promise<MicStatus> => {
    if (micStatus() === 'granted') return 'granted';
    if (micExplained()) return requestMic();

    const allowed = await new Promise<boolean>((resolve) => setMicAsk(() => resolve));
    rememberMicExplained();
    setMicAsk(null);
    return allowed ? requestMic() : 'denied';
  };
  // Typed-doubt input on a phone, where there is no side panel to type into.
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  // The live session polls this per audio chunk, so it must read the latest
  // value rather than the one captured when the agent was built.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  /**
   * Three tutors behind one interface, best first:
   *   voice  — Gemini Live, the student speaks and she speaks back (needs a key + mic)
   *   text   — Gemini over REST, the student types (key, no mic)
   *   stub   — a scripted script (no key at all), so the app always runs
   */
  /**
   * THE LIVE VOICE KEY, AND WHY IT IS THE ONLY ONE LEFT.
   *
   * Gemini's Live API opens a socket from the browser and authenticates it
   * with a raw key, so there is no way to speak to it without one in the
   * page. Vite inlines every VITE_ variable, which means a key read here is a
   * key printed into dist/assets/index-*.js for anyone who unzips the APK —
   * so this read is fenced to DEV and voice doubts simply do not exist in a
   * production build.
   *
   * Nothing is lost by that today: the TYPED doubt path is the same tutor,
   * the same persona and the same recall, and it goes through /api/llm where
   * the credential belongs. Voice comes back when the server can mint an
   * ephemeral token for it.
   */
  const liveVoiceKey = import.meta.env.DEV
    ? (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)
    : undefined;


  const profile = useStore(profileStore);
  const settings = useStore(settingsStore);
  const doubts = useStore(doubtLogStore);
  const preferences = useStore(preferencesStore);

  // What she is told about this student. Absent signals stay absent — see
  // lib/student.ts for why a default here would be worse than silence.
  const student = useMemo(
    () =>
      buildStudentContext({
        profile,
        klass: settings.klass,
        progress: progressStore.get(),
        doubts,
        lessonId: lesson.id,
        // The lesson's own outcomes against the MODEL's belief — the first
        // time this signal has been real: nodeIds were never passed, so the
        // persona's mastery line was structurally absent while the code that
        // would have fed it read the stale placement blob.
        nodeIds: outcomesOf(lesson),
        mastery: masteryFromModel(),
        // What she remembers about them (lib/studentMemory.ts): interests,
        // hard topics, wins, past doubts, last class, their commitment.
        notes: memoryNotes(tutorLanguage()),
      }),
    [profile, settings.klass, doubts, lesson.id],
  );

  /**
   * The board as the typed tutor sees it: what is on screen, the question
   * being held, and every reply's steps checked (safety, answer leak, maths)
   * and laid out before a word is said (lib/doubtBoard.ts).
   */
  const doubtBoard = useMemo(
    () =>
      createDoubtBoard({
        session: board,
        halt,
        heldAsk: () => heldAskRef.current,
        lang: tutorLanguage,
        lessonId: () => lesson.id,
      }),
    [board, halt, lesson.id],
  );

  const agent = useMemo(() => {
    // No class on file means nothing true to tell her about the student, and a
    // guessed class is a tutor pitching a lesson at a child who is not there.
    if (student === null) return createStubAgent();
    if (voiceMode && liveVoiceKey) {
      return createLiveAgent({
        apiKey: liveVoiceKey,
        student,
        onState: setLiveState,
        isMuted: () => mutedRef.current,
        onTranscript: (line) =>
          // Non-final lines arrive as the whole line so far — replace the last
          // entry in place rather than appending a growing pile of fragments.
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === line.role && !last.final) {
              return [...prev.slice(0, -1), line];
            }
            return [...prev, line];
          }),
      });
    }
    // Same origin, no key: the server holds the credential and decides what
    // this student may spend.
    //
    // The scripted tutor stays the FLOOR beneath it. The relay is not live in
    // a deployed build until the Edge Function ships, and a raised hand that
    // ends in "having trouble connecting" is worse than a short scripted
    // answer that at least belongs to the lesson. It is started only when a
    // call fails, and with no opening of its own: by then the bridge line has
    // been said and the student has already asked.
    return createGeminiAgent({
      student,
      fallback: createStubAgent({ opening: false }),
      // She writes and marks on the board while she explains (T2.4).
      board: doubtBoard,
      // What each typed turn cost, in the dev console only. Counts come from
      // the relay's reply; a turn whose reply carried none prints nothing.
      ...(import.meta.env.DEV
        ? { onUsage: (usage: TurnUsage) => console.info('[doubt] tokens this turn', usage) }
        : {}),
    });
  }, [liveVoiceKey, voiceMode, student, doubtBoard]);

  const handoff = useMemo(
    () =>
      createHandoff({
        agent,
        // Her lines go through the halt's screened voice. The SCREENED line
        // goes back through `onSaid`, so the caption and the text-mode
        // transcript show what the room actually heard, and `{ halted }` goes
        // back to the machine, which stops on it: no agent line after the
        // support reply, no exit bridge, no resume.
        // `onStart`, when the tutor passed one, draws that sentence's ink on
        // the board as her voice starts it (lib/voiceStart.ts).
        speak: (text, onSaid, onStart) =>
          sayRevealing((t) => halt.say(t, 'model-reply', onSaid), text, onStart, () => halt.halted),
        onPause: () => playerRef.current.pause(),
        prime: (text) => ttsRef.current.prime?.(text),
        onResume: () => {
          // Recall view ends with the doubt; play() re-speaks the current beat,
          // which doubles as a natural re-anchor into the lesson. The doubt's
          // ink stays on the board, off to the side (TD13).
          setRecallBeatId(null);
          heldAskRef.current = null;
          boardRef.current.endDoubt();
          // A doubt step primed but never said is not what plays next (fifth review).
          ttsRef.current.drop?.();
          playerRef.current.play();
        },
        onRecall: (beatId) => {
          setRecallBeatId(beatId);
          boardRef.current.recall(beatId);
        },
      }),
    [agent, halt],
  );

  // raiseHand defers by a tick so the freshly-selected agent is in place; it
  // must reach the handoff built from THAT agent, not the one it closed over.
  const handoffRef = useRef(handoff);
  handoffRef.current = handoff;

  useEffect(() => {
    const offState = handoff.on('statechange', () => {
      setHandoffState(handoff.state);
      // The "I'm not sure" chip's words, said for them the moment she is
      // there to hear them (overnight review #28).
      if (handoff.state === 'LIVE' && notSureOpener.current !== null) {
        const opener = notSureOpener.current;
        notSureOpener.current = null;
        sendTextRef.current(opener, { opener: true });
      }
      if (handoff.state === 'PLAYING') notSureOpener.current = null;
      if (handoff.state === 'PLAYING') {
        // Doubt over — clear the room so the next one starts fresh.
        setTextLines([]);
        setTranscript([]);
        setMuted(false);
        setTyping(false);
        setDraft('');
      }
    });
    const offSay = handoff.on('agent-say', (line) => {
      if (line) setTextLines((prev) => [...prev, { role: 'tutor', text: line, final: true }]);
    });
    return () => {
      offState();
      offSay();
    };
  }, [handoff]);

  const inDoubt = handoffState !== 'PLAYING';


  /**
   * THE EAR. When she asks, the mic opens on its own, waits for the spoken
   * answer, and closes when it lands — the raise-hand button stays for the
   * doubts the STUDENT starts. The chips stay tappable underneath as the
   * fallback for a denied mic, a silent room, or a dead network.
   *
   * Two rounds at most: an answer, and after a hint one more try. Then the
   * ear rests and the chips carry it — a mic that reopens forever nags.
   */
  const [ear, setEar] = useState<'off' | 'listening' | 'thinking'>('off');
  /** Her cross-question about a right spoken answer is waiting on their reasoning. */
  const [probing, setProbing] = useState(false);
  // A halted class holds no question: blanking it here is also what runs the
  // ear effect's cleanup below.
  const heldAskBeat =
    player.pendingAsk && !inDoubt && support === null ? (player.beat?.id ?? null) : null;

  /**
   * The beat whose question has already been filed as asked.
   *
   * `heldAskBeat` goes null and back on things that are not a new question:
   * pausing cancels the held ask and resuming re-speaks the beat and reveals
   * it again, and a raised hand blanks it for the length of the doubt. Each
   * return filed a second `asked` for one question — inflating the count of
   * questions put, and with it the attempt a first answer was recorded at.
   */
  const askFiled = useRef<string | null>(null);
  /** The held question the ear has taken (mic granted): its silences are the ear's to nudge. */
  const earHeld = useRef<string | null>(null);

  // The question surfacing is what starts the clock on an answer. It is its own
  // effect because the ear's effect returns early on a denied mic, and a
  // student without a microphone still answers by tapping.
  useEffect(() => {
    // The class moved on: whatever was standing is over, and if that beat
    // comes round again — a seek back — it is genuinely being asked afresh.
    if (askFiled.current !== null && askFiled.current !== player.beat?.id) askFiled.current = null;
    if (!heldAskBeat) return;
    if (askFiled.current === heldAskBeat) {
      // The same question, back after a pause or a raised hand. No second
      // `asked` — but the clock has to restart, or the minutes the student
      // spent watching a doubt explained are charged to their thinking on this
      // question. `asked` is the only other place that stamps it, and with the
      // guard above it now runs exactly once per beat.
      ledger.reopened(heldAskBeat, Date.now());
      return;
    }
    askFiled.current = heldAskBeat;
    ledger.asked(heldAskBeat, player.pendingAsk?.options?.length);
    // Once per held question; `ledger` is memoised on the lesson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldAskBeat, player.beat?.id]);

  useEffect(() => {
    if (!heldAskBeat) return;
    let cancelled = false;
    /**
     * Over when this effect is torn down OR the class has halted. The halt
     * is checked on its own as well because it can land in the middle of an
     * await — a model call, her line — before React has re-rendered and run
     * the cleanup, and nothing after a halt may open the mic, call the judge
     * or speak.
     */
    const over = (): boolean => cancelled || halt.halted;
    // Whether the ear said a nudge on this question. If it gives up without
    // one — a mic that will not open, a judge that failed — the quiet-tapper
    // timer takes the question back (second review, 2026-09-29).
    let nudged = false;
    if (earHeld.current === heldAskBeat) earHeld.current = null;
    // A follow-up is a window of one reply, and a new ear starts with none.
    followUpOpen.current = null;
    (async () => {
      if ((await askForMic()) !== 'granted') return;
      if (over()) return;
      // The ear has this question: its nudges, not the quiet-tapper timer's.
      earHeld.current = heldAskBeat;
      /**
       * The exchange, Aarav's shape: a wrong answer gets a hint and another
       * try; a RIGHT answer is not the exit either — she asks one why/how/
       * when about their own answer, hears the reasoning, closes the loop,
       * and only then the class moves. Thinking is the point, both ways.
       */
      let probe: { answer: string; question: string; askedAt: number } | null = null;
      let tries = 0;
      let silences = 0;
      /**
       * When the quiet began: the question surfacing, or her last line.
       * The endpointer gives up on a listen after a few seconds of silence,
       * and that is not a stuck student — "take your time" at seven seconds
       * contradicted itself. A quiet listen before QUIET_BEFORE_NUDGE_MS
       * re-arms without a word (overnight review #24).
       */
      let quietSince = Date.now();
      // Her last nudge offered a hint, so a bare "haan" now means yes please.
      let offeredHint = false;
      let epoch = tapEpoch.current;
      while (!over()) {
        const ask = playerRef.current.pendingAsk;
        if (!ask) return;
        if (tapEpoch.current !== epoch) {
          // A tap took this turn. Wait out her reply to it, then listen afresh.
          setEar('off');
          await tapSettled.current;
          if (over()) return;
          epoch = tapEpoch.current;
          quietSince = Date.now();
          offeredHint = false;
          continue;
        }
        setEar('listening');
        // Polled on every chunk: a halt, or a tap, closes the mic on the next one.
        const heard = await listenOnce({ isCancelled: () => over() || tapEpoch.current !== epoch });
        // A tap landed while the mic was open or the words were being heard:
        // the tap is the answer, and this one is dropped rather than recorded
        // on top of it (second review, 2026-09-29).
        if (!over() && (heard.reason === 'cancelled' || tapEpoch.current !== epoch)) {
          // Words that were transcribed before the tap landed are dropped as
          // an answer but still screened: distress in them stops the class
          // (third review). A listen the tap CANCELLED was never transcribed,
          // so there are no words to screen — that audio is discarded.
          if (heard.text && fromStudent(heard.text, lesson.id).say !== null && halt.heard(heard.text, 'ear')) return;
          continue;
        }
        /**
         * WHEN THE ANSWER LANDED — not when the judge had finished with it.
         *
         * `ledger.answered` is reached seconds later, on the far side of a
         * model round trip, and it timed the answer from the moment it was
         * called. So every spoken answer was recorded as that much slower than
         * a tapped one, on a number the learner model weighs as evidence about
         * the student. This is the mic closing: the judge's round trip is out
         * of it. What is still inside is the transcription `listenOnce` does
         * before it returns — the end-of-speech mark itself lives in the
         * endpointer, and only `Heard` could carry it out here.
         */
        const heardAt = Date.now();
        if (over()) return;

        if (probe) {
          // Their reasoning — or their silence — closes it either way. The
          // cross-question deepens a right answer; it never blocks the class.
          setEar('thinking');
          const close = await resolveCrossQuestion(
            ask,
            probe.answer,
            probe.question,
            heard.text ?? '(said nothing)',
          ).catch(() => null);
          setEar('off');
          if (over()) return;
          /**
           * THE ONLY EVIDENCE THIS SYSTEM EVER GETS THAT THEY CAN JUSTIFY IT.
           *
           * A right answer says they produced it; this says whether they can
           * say why — mastery against recall, which is the whole reason the
           * cross-question exists. It was being spoken, screened, sent to a
           * model and then dropped on the floor.
           *
           * Filed BEFORE she speaks, like `helped`, and on every path that
           * reaches here: a model that failed (`close === null`) and a turn
           * the screen halted are both still a student who reasoned, and both
           * are about to end this exchange early.
           *
           * `close.heard` is the SCREENED reasoning and the only copy this
           * scope has — reaching for `heard.text` is how the raw transcript
           * ends up in a column, exactly as it did on the answer path.
           */
          ledger.reflected({
            beatId: heldAskBeat,
            prompt: probe.question,
            /**
             * THE EAR'S REASON, not `heard.text !== null`.
             *
             * `listenOnce` returns `{ text: null, reason: 'error' }` when the
             * mic will not open — the OS handed it to an incoming call, or the
             * AudioContext was suspended by a backgrounding — and that used to
             * be indistinguishable here from a quiet room. The class then filed
             * `reasoningVerdict: 'silent'`, so a hardware failure was written
             * down as a child who could not justify their own right answer.
             * `Heard` carried the distinction one function call away.
             */
            reasoning:
              heard.reason === 'heard'
                ? { said: 'words', held: close?.held }
                : heard.reason === 'silence'
                  ? { said: 'nothing' }
                  : { said: 'unheard' },
            reasoningText: close?.heard,
            flagged: close?.halt === true,
            askedAt: probe.askedAt,
            reasonedAt: heardAt,
          });
          // Distress in their reasoning stops the whole class, on the one halt
          // every path shares — which says the support line itself. `close.halt`
          // alone is not that: an off-limits reply sets it too, and that only
          // ends this exchange. The flag was written by the screen inside
          // resolveCrossQuestion; `heard` only asks which of the two it was.
          if (close?.halt && heard.text !== null && halt.heard(heard.text, 'ear')) return;
          const spoken = close ? await sayLine(inLanguage(close.say, tutorLanguage()), 'ear') : null;
          if (over()) return;
          // She has just declined to go somewhere (close.halt), or her own
          // reply was swapped for the support line and the class has halted
          // (spoken.halted). Resolving the question and moving the class on
          // would be the app talking over either.
          if (close?.halt || spoken?.halted) return;
          playerRef.current.answer(Math.max(0, correctIndex(ask)));
          return;
        }

        if (heard.text === null) {
          /**
           * SILENCE GETS A GENTLE NUDGE, NOT A DEAD END (E4, 2026-09-29).
           *
           * A tutor who asked and heard nothing does not just wait forever: she
           * says "take your time — want a hint?" once (content-free, filed as
           * L1 help), listens again, and on a second silence gives the authored
           * hint (L3). After that the chips carry it. A mic that failed
           * ('error') is not a quiet student and gets no nudge.
           */
          if (heard.reason !== 'silence') return;
          if (Date.now() - quietSince < QUIET_BEFORE_NUDGE_MS) continue;
          if (silences >= 2) return;
          silences += 1;
          const nudge = decide({
            verdict: silences === 1 ? 'silent' : 'hintRequest',
            attempt: (tapTries.current.get(heldAskBeat) ?? 0) + 1,
            rungSoFar: tapRung.current.get(heldAskBeat) ?? 0,
            ask,
            lang: tutorLanguage(),
            now: Date.now(),
            recentLines: recentLines.current,
          });
          tapRung.current.set(heldAskBeat, nudge.rung);
          // Help they did not ask for: silence is not a request, even when
          // decide() was asked for the hint on its behalf.
          if (nudge.helped !== null) ledger.helped(heldAskBeat, nudge.helped, false, nudge.strategy);
          // A nudge closes a follow-up's window: what they say next is an answer.
          followUpOpen.current = null;
          const nudgeHint = nudge.boardIntent?.text;
          if (nudgeHint) board.writeHeld(heldAskBeat, [{ author: 'lesson', steps: [{ say: '', ink: [{ op: 'note', text: nudgeHint }] }] }]);
          if (!nudge.say) return;
          recentLines.current = [...recentLines.current.slice(-8), nudge.say];
          setEar('off');
          const spokenNudge = await sayLine(nudge.say);
          if (over() || spokenNudge.halted) return;
          ledger.reopened(heldAskBeat, Date.now());
          quietSince = Date.now();
          nudged = true;
          // Only a line that actually offered one makes a bare "haan" a yes.
          offeredHint = silences === 1 && /hint/i.test(nudge.say);
          continue;
        }

        /**
         * "HINT DO" IS A REQUEST, NOT AN ANSWER (overnight review #21).
         *
         * Her nudge offers a hint out loud; the reply used to go to the judge
         * as the child's answer to the question. A short ask for help — or a
         * bare "haan" right after she offered — gets the hint, filed as asked
         * for. The pure screen first, which records nothing: anything it does
         * not simply allow goes the ordinary way, through the screen that
         * files and halts.
         */
        const explainAsked = screen(heard.text, 'from-student').kind === 'allow' && asksToExplainAgain(heard.text);
        if (
          explainAsked ||
          (screen(heard.text, 'from-student').kind === 'allow' &&
            asksForHint(heard.text, { afterOffer: offeredHint, answers: (ask.options ?? []).map((o) => o.text) }))
        ) {
          offeredHint = false;
          const help = decide({
            // "Phir se samjhao" is asking for another way to see it (H4).
            verdict: explainAsked ? 'explainRequest' : 'hintRequest',
            attempt: (tapTries.current.get(heldAskBeat) ?? 0) + 1,
            rungSoFar: tapRung.current.get(heldAskBeat) ?? 0,
            ask,
            lang: tutorLanguage(),
            now: Date.now(),
            recentLines: recentLines.current,
          });
          tapRung.current.set(heldAskBeat, help.rung);
          if (help.helped !== null) ledger.helped(heldAskBeat, help.helped, true, help.strategy);
          followUpOpen.current = null;
          const helpText = help.boardIntent?.text;
          if (helpText) board.writeHeld(heldAskBeat, [{ author: 'lesson', steps: [{ say: '', ink: [{ op: 'note', text: helpText }] }] }]);
          setEar('off');
          if (help.say) {
            recentLines.current = [...recentLines.current.slice(-8), help.say];
            const spokenHelp = await sayLine(help.say);
            if (over() || spokenHelp.halted) return;
          }
          ledger.reopened(heldAskBeat, Date.now());
          quietSince = Date.now();
          continue;
        }
        offeredHint = false;
        /**
         * THEIR REPLY TO A FOLLOW-UP QUESTION IS REASONING, NOT AN ANSWER
         * (C7; third review, 2026-09-29). She asked why they chose what they
         * did; judging the reply against the held question filed a second
         * miss and climbed the ladder for answering what she asked. Heard,
         * screened, thanked — and the question is theirs to try again.
         */
        /**
         * A reply that says the answer itself ("oh, it's four") is an answer,
         * judged like any other, not reasoning to thank them for (fifth review).
         */
        const saysAnswer = (text: string): boolean => {
          const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          const said = ` ${norm(text)} `;
          const answers = [ask.expect, ...(ask.options ?? []).filter((o) => o.correct === true).map((o) => o.text)];
          return answers.some((a) => a !== undefined && norm(a) !== '' && said.includes(` ${norm(a)} `));
        };
        if (followUpOpen.current === heldAskBeat && !saysAnswer(heard.text)) {
          followUpOpen.current = null;
          const screened = fromStudent(heard.text, lesson.id);
          if (screened.say !== null) {
            if (halt.heard(heard.text, 'ear')) return;
            // Off-limits: her redirect, not "thanks" (fifth review). The ear
            // rests; the chips carry the question.
            setEar('off');
            await sayLine(inLanguage(screened.say, tutorLanguage()));
            return;
          }
          const thanks = LINES.afterFollowUp[tutorLanguage()];
          const line = thanks.find((l) => !recentLines.current.includes(l)) ?? thanks[0];
          recentLines.current = [...recentLines.current.slice(-8), line];
          setEar('off');
          const spokenThanks = await sayLine(line);
          if (over() || spokenThanks.halted) return;
          ledger.reopened(heldAskBeat, Date.now());
          quietSince = Date.now();
          continue;
        }
        followUpOpen.current = null;
        setEar('thinking');
        /**
         * THE CLASS JUDGES ITS OWN ASK WHEN IT CAN AFFORD TO.
         *
         * A beat carrying a whyProbe is a beat whose judgement was authored at
         * prep time, and `resolveSpokenAnswer` reads the student's words
         * against it locally — no model, no money. It falls back to the judge
         * whenever the local read is not confident, which is the whole of the
         * contract; see lib/judge.ts for what that buys and what it gives up.
         */
        const resolved = await resolveSpokenAnswer(ask, heard.text).catch(() => null);
        if (over()) return;
        // Distress first, then a tap that landed meanwhile (third review).
        if (resolved?.verdict.halt && halt.heard(heard.text, 'ear')) return;
        if (tapEpoch.current !== epoch) continue;
        // A judge that failed says nothing and leaves the chips standing.
        if (resolved === null) return;
        const judged = resolved.verdict;
        /**
         * DISTRESS IN THE ANSWER STOPS THE CLASS HERE, before anything is
         * tracked or said, on the one halt every path shares — which says the
         * support line itself. `judged.halt` alone is not that: an off-limits
         * answer sets it too, and that only rests the ear (below). The screen
         * inside resolveSpokenAnswer wrote the flag and made no model call;
         * `heard` only asks which of the two it was.
         */
        if (judged.halt && halt.heard(heard.text, 'ear')) return;
        /**
         * WHICH PATH RESOLVED IT — so the saving is measured rather than
         * asserted. Enums and our own lesson id only; `clean()` drops anything
         * longer than an id, and the student's words are not here to drop.
         */
        track('answer_resolved', {
          lessonId: lesson.id,
          path: resolved.path,
          reading: resolved.reading ?? 'none',
          verdict: judged.verdict,
          probed: ask.whyProbe !== undefined,
        });
        /**
         * One count of tries per question, whichever way they answered: a
         * spoken miss used to be invisible to the tap ladder, so a tap after
         * it was read as a first attempt at rung 0 (overnight review #16).
         */
        const priorTries = tapTries.current.get(heldAskBeat) ?? 0;
        if (judged.verdict !== 'unclear') tapTries.current.set(heldAskBeat, priorTries + 1);
        // "unclear" is not evidence about the student — nothing is recorded.
        // Her notebook: the same marks for a spoken answer as for a tap.
        {
          const where = { topic: playerRef.current.beat?.topic ?? lesson.title, lessonId: lesson.id };
          if (remember && judged.verdict === 'wrong') recordStruggle(where);
          else if (
            remember &&
            judged.verdict === 'right' &&
            priorTries === 0 &&
            (tapRung.current.get(heldAskBeat) ?? 0) === 0 &&
            !helpedByDoubt.current.has(heldAskBeat)
          )
            recordWin(where);
        }
        // A right answer is on record from here: the chips step aside now,
        // not after her reply, or a tap during it filed a second answer.
        if (judged.verdict === 'right') setProbing(true);
        if (judged.verdict !== 'unclear') {
          recordAnswerAtBeat(lesson, heldAskBeat, judged.verdict === 'right');
          // The ledger keeps what the counter cannot: their actual words, the
          // verdict the judge reached, and how long the thinking took. A turn
          // the safety screen stopped is dropped entirely rather than trimmed.
          ledger.answered({
            beatId: heldAskBeat,
            correct: judged.verdict === 'right',
            surface: 'voice',
            verdict: judged.verdict,
            // THE SCREENED WORDS, never `heard.text`. The screen had already
            // found and removed whatever a child should not have had to put in
            // an answer — and then this line wrote the original down anyway,
            // because a `clean` verdict deliberately does not stop the class
            // and so never set `halt`. `judged.heard` is the only copy the
            // judge hands back now, which is what makes this hard to get wrong
            // again. Undefined means the screen stopped the turn entirely, and
            // normaliseAnswer stores nothing for it.
            answerText: judged.heard,
            flagged: judged.halt === true,
            answeredAt: heardAt,
          });
        }
        setEar('off');
        /**
         * SHE IS ABOUT TO HELP, AND THE LEDGER HAS TO KNOW.
         *
         * On a wrong answer `judged.say` is not commentary — the prompt tells
         * her to "Ask ONE why/how/when question, or give the hint", and
         * `judged.gave` says which she chose. Without this the next spoken
         * answer was filed at rung 0, unassisted, which is the one rung the
         * learner model treats as proof of mastery. Recorded BEFORE it is
         * spoken, exactly as the tap path does it, so the retry is already
         * standing on the right rung.
         */
        /**
         * A WRONG SPOKEN ANSWER CLIMBS THE SAME LADDER AS A TAP (E2, 2026-09-29).
         *
         * The judge only CLASSIFIES here; `decide()` chooses the help — look
         * again (L1), the authored hint (L3), the answer and why (L8) — so a
         * spoken answer and a tapped one get the same tutor, in the child's
         * language, never with a model-invented hint. Filed before it is said,
         * and their (screened) answer and the hint are written in the
         * question's work area. When decide() has nothing authored to say, the
         * judge's own line is the fallback, screened as a model's.
         */
        let ladderLine: string | null = null;
        let movingOn = false;
        if (judged.verdict === 'wrong') {
          const action = decide({
            verdict: 'wrong',
            attempt: priorTries + 1,
            rungSoFar: tapRung.current.get(heldAskBeat) ?? 0,
            ask,
            // Which option their words were, so a named misconception gets
            // its own follow-up question (C7) rather than the generic rethink.
            ...(resolved.matched !== undefined ? { matchedOption: resolved.matched } : {}),
            lang: tutorLanguage(),
            now: Date.now(),
            recentLines: recentLines.current,
          });
          tapRung.current.set(heldAskBeat, action.rung);
          movingOn = action.kind === 'moveOn';
          followUpOpen.current = action.followUp ? heldAskBeat : null;
          /**
           * What decide() gave, or nothing. The old fallback filed rung 2 or 3
           * whenever decide() gave no help (a moveOn after the reveal), which
           * is help the student never got.
           */
          if (action.helped !== null) ledger.helped(heldAskBeat, action.helped, false, action.strategy);
          // decide() had no line, so the judge's own reply is said below —
          // and that reply is a question or a hint, which is help.
          else if (!action.say && judged.gave) ledger.helped(heldAskBeat, judged.gave === 'hint' ? 3 : 2, false, `judge-${judged.gave}`);
          if (action.say) {
            ladderLine = action.say;
            recentLines.current = [...recentLines.current.slice(-8), action.say];
          }
          // Only what decide() approved: it has refused a leaking hint (#11/#22).
          const hintText = action.boardIntent?.text;
          board.writeHeld(heldAskBeat, [
            ...(judged.heard ? [{ author: 'student' as const, steps: [{ say: '', ink: [{ op: 'write', text: `✗ ${judged.heard}` }] }] }] : []),
            ...(hintText ? [{ author: 'lesson' as const, steps: [{ say: '', ink: [{ op: 'note', text: hintText }] }] }] : []),
          ]);
        }
        // A whyProbe matched on the device answers with the lesson's own
        // why or hint, so it is the lesson speaking (`sayAuthored`, like a
        // tap); anything the judge's model wrote is screened as a model's.
        const spoken =
          ladderLine !== null
            ? await sayLine(ladderLine)
            : resolved.path === 'local'
              ? await sayLine(inLanguage(judged.say, tutorLanguage()))
              : await sayLine(inLanguage(judged.say, tutorLanguage()), 'ear');
        if (over()) return;
        // An off-limits answer (judged.halt): she has just declined it, and
        // reopening the mic to ask the question again would talk over her —
        // the chips carry it. A model reply swapped for the support line, or
        // a class halted while she spoke (spoken.halted): `over()` already
        // caught it.
        if (judged.halt || spoken.halted) return;
        if (judged.verdict === 'right') {
          /**
           * A LOCALLY RESOLVED RIGHT ANSWER ENDS HERE, AND THAT IS THE COST
           * DECISION MADE VISIBLE.
           *
           * The model path asks one why/how/when about their own answer and
           * closes it a turn later — two calls, and the only evidence this
           * system gets that a student can JUSTIFY a right answer
           * (`ledger.reflected`). A whyProbe match has no question to ask:
           * `judged.say` is already the authored reason, so she has just given
           * what the cross-question exists to draw out. Continuing would
           * reopen the mic on a line that asked nothing and then pay for a
           * close — the second of the two calls this change exists to remove.
           *
           * So this class files no reflection for locally resolved asks. That
           * is a real loss of evidence and it is what buys the ceiling; it is
           * written here rather than left for somebody to discover in the
           * ledger.
           */
          if (resolved.path === 'local') {
            playerRef.current.answer(Math.max(0, correctIndex(ask)));
            return;
          }
          // Her line just ended on the cross-question; the next listen takes
          // their reasoning, and the probe branch above always resolves.
          // Screened, for the same reason: this is sent back to the model on
          // the close a turn later.
          // `askedAt` is stamped HERE, after her line has finished being
          // spoken, because that is when the mic opens and their thinking
          // starts. Stamped before the speech it would have charged the
          // student with however long she talked.
          // `judged.heard` alone: it is absent only on a halt, and a halt has
          // already returned two lines above. The `?? heard.text` fallback
          // that stood here reached for exactly the raw transcript `heard` was
          // added to make unreachable, on a path that can never need it.
          probe = { answer: judged.heard ?? '', question: judged.say, askedAt: Date.now() };
          // Their reasoning is asked for out loud: the chips step aside, or a
          // tap would file a second answer to a question already answered.
          setProbing(true);
          quietSince = Date.now();
          continue;
        }
        // "Let's keep going" after the reveal: she said it, so the class goes
        // on — the gate opens on the answer already shown (overnight review #10/#26).
        if (movingOn) {
          playerRef.current.answer(correctIndex(ask));
          return;
        }
        // SHE HAS FINISHED SPEAKING THE HINT, so the retry clock starts now.
        // `answered` above moved it to the moment their wrong answer landed;
        // everything since is her talking, and charging the student for it
        // would inflate attempt 2 by the length of a hint — worse than the
        // judge round trip this whole change exists to take out.
        ledger.reopened(heldAskBeat, Date.now());
        quietSince = Date.now();
        tries += 1;
        // Three misses: look again, the hint, then the answer and why — after
        // that the chips wait, and a tap on the right one closes it.
        if (tries >= 3) return;
      }
    })().finally(() => {
      setProbing(false);
      if (!nudged && earHeld.current === heldAskBeat) earHeld.current = null;
      if (!cancelled) setEar('off');
    });
    return () => {
      cancelled = true;
      setEar('off');
    };
  }, [heldAskBeat, lesson, tts]);

  /**
   * THE QUIET TAPPER GETS A NUDGE TOO (E4, 2026-09-29).
   *
   * The ear's loop nudges a student who is silent at an open mic. A student
   * with no mic (denied, "not now", none on the device) only taps, and until
   * now a held question simply waited on them forever. After
   * QUIET_BEFORE_NUDGE_MS of quiet — counted again from their last tap — she
   * says one content-free line, once per question (filed as L1 help).
   *
   * Never over her own voice, and never on a question the ear holds: it used
   * to fire whenever the ear read 'off', which is also what the ear reads
   * while she is SPEAKING, and cut her off mid-sentence (overnight review #25).
   */
  const earRef = useRef(ear);
  earRef.current = ear;
  const askBusyRef = useRef(askBusy);
  askBusyRef.current = askBusy;
  const micAskRef = useRef(micAsk);
  micAskRef.current = micAsk;
  useEffect(() => {
    if (!heldAskBeat) return;
    const beatId = heldAskBeat;
    let seen = tapEpoch.current;
    let timer: ReturnType<typeof setTimeout>;
    const tryNudge = (): void => {
      if (halt.halted) return;
      // The ear has it for now; look again, in case it gives the question back.
      if (earHeld.current === beatId) {
        timer = setTimeout(tryNudge, 4_000);
        return;
      }
      const ask = playerRef.current.pendingAsk;
      if (!ask || playerRef.current.beat?.id !== beatId) return;
      // A tap since the last look: they are not stuck, so the quiet starts again.
      if (tapEpoch.current !== seen) {
        seen = tapEpoch.current;
        timer = setTimeout(tryNudge, QUIET_BEFORE_NUDGE_MS);
        return;
      }
      // Something is happening — she is talking, a tap is being answered, the
      // mic question is up. Look again shortly.
      if (speaking.current > 0 || askBusyRef.current || micAskRef.current !== null || earRef.current !== 'off') {
        timer = setTimeout(tryNudge, 4_000);
        return;
      }
      const nudge = decide({
        verdict: 'silent',
        attempt: (tapTries.current.get(beatId) ?? 0) + 1,
        rungSoFar: tapRung.current.get(beatId) ?? 0,
        ask,
        lang: tutorLanguage(),
        now: Date.now(),
        recentLines: recentLines.current,
      });
      if (nudge.helped !== null) ledger.helped(beatId, nudge.helped, nudge.requested, nudge.strategy);
      if (!nudge.say) return;
      recentLines.current = [...recentLines.current.slice(-8), nudge.say];
      void sayLine(nudge.say);
    };
    timer = setTimeout(tryNudge, QUIET_BEFORE_NUDGE_MS);
    return () => clearTimeout(timer);
    // Once per held question; the refs carry the live state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldAskBeat]);

  // The choices leave the screen the moment an answer is in flight — a tap,
  // or a spoken answer being judged. What remains is the status chip.
  const askChoicesHidden = askBusy || ear === 'thinking' || probing;

  // Only a class that is actually playing hides its controls. Paused, finished,
  // not yet started or mid-doubt, they stay: in every one of those states the
  // student is looking for a button, not at a diagram.
  const canHideControls = player.state === 'playing' && !inDoubt;

  useEffect(() => {
    if (!canHideControls || !controlsShown) return;
    const timer = setTimeout(() => setControlsShown(false), CONTROLS_IDLE_MS);
    return () => clearTimeout(timer);
  }, [canHideControls, controlsShown]);

  // Any sign of the student brings them back, and restarts the countdown.
  const revealControls = () => setControlsShown(true);

  useEffect(() => {
    if (!canHideControls) setControlsShown(true);
  }, [canHideControls]);

  // The class clock: ticking whenever the room is doing something — the
  // recording playing, or the live tutor talking a doubt through. A halted
  // class is doing neither.
  const [elapsed, setElapsed] = useState(0);
  const clockRunning = (player.state === 'playing' || inDoubt) && support === null;
  useEffect(() => {
    if (!clockRunning) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1_000);
    return () => clearInterval(timer);
  }, [clockRunning]);

  // The canvas comes from the live board: the beat's own show set, anything
  // recalled or written during a doubt, and the ink written at a held
  // question — framed on whatever she is writing now (lib/boardSession.ts).
  const canvas = board.canvas(player.beatIndex);

  // Her ear open counts as listening too: while the mic waits on a spoken
  // answer she turns to her listening pose instead of gesturing through it.
  /** The clone, told which beat is playing, or nothing at all. */
  const tile = clone ? { ...clone, beatId: player.beat?.id ?? null } : undefined;

  const tutorMode: TutorMode = inDoubt
    ? 'listening'
    : ear === 'listening'
      ? 'listening'
      : player.state === 'playing'
        ? 'teaching'
        : 'idle';

  // Progress + the data spine: save position per beat; completion routes to
  // the celebration screen; every raised hand is logged with its beat.
  useEffect(() => {
    if (player.state === 'playing') saveBeat(lesson.id, player.beatIndex);
  }, [lesson.id, player.state, player.beatIndex]);

  useEffect(() => {
    if (player.state !== 'ended') return;
    markCompleted(lesson.id);
    track('lesson_completed', { lessonId: lesson.id, beats: lesson.beats.length });
    // The map hears about it too: a finished class is evidence about the
    // outcomes its beats declared, not just a tick on a lesson id.
    recordLessonTaught(lesson);
    navigate(`/complete/${lesson.id}`, { replace: true });
  }, [lesson.id, player.state, navigate]);

  /**
   * Raise hand. The mic is requested BEFORE the session opens: a permission
   * prompt appearing while the tutor is already greeting would swallow her
   * first sentence. A refused mic silently falls back to the typed path.
   */
  const raiseHand = async () => {
    // A halted class takes no hand: there is no doubt left to open.
    if (halt.halted) return;
    // Her lines into and out of the doubt in the child's language (#27).
    const ctx = { ...buildContext(lesson, player.beatIndex), lang: tutorLanguage() };
    // What the board must not give away, and a fresh doubt on the board.
    heldAskRef.current = player.pendingAsk ?? null;
    board.beginDoubt();
    // Her notebook: the topic they raised a hand about — never their words.
    if (remember) recordDoubtTopic({ topic: player.beat?.topic ?? lesson.title, lessonId: lesson.id });
    // A hand raised AT a held question is help on it: a right answer after it is not a win.
    if (player.pendingAsk && player.beat) helpedByDoubt.current.add(player.beat.id);
    logDoubt(lesson.id, ctx.beatId);
    // Located precisely: this hand is about the outcomes THIS beat teaches,
    // not about the chapter it happens to sit in.
    recordDoubtAtBeat(lesson, ctx.beatId);
    ledger.confused(ctx.beatId);
    /**
     * A hand raised while a question is HOLDING is not the same event as a
     * hand raised mid-explanation. The student is stuck on the question, and
     * what follows is a whole tutor conversation about it — after which they
     * answer, and that answer used to be recorded at rung 0 as though they had
     * worked it out alone. It is the most assisted answer the product can
     * produce, so it is recorded as rung 7: the full explanation, asked for.
     */
    if (player.pendingAsk) ledger.helped(ctx.beatId, 7, true, 'doubt');

    if (student !== null) {
      // A mic is no use without a live voice session to carry it, and that
      // exists in dev only until the server can mint a token for one.
      const status = liveVoiceKey ? await askForMic() : 'denied';
      const useVoice = status === 'granted';
      setVoiceMode(useVoice);
      if (useVoice) {
        setLiveState('connecting');
        setTranscript([]);
      }
      // The agent is rebuilt from voiceMode, so hand off on the next tick with
      // the correct one in place.
      // Checked again on the tick: the mic prompt above is awaited, and the
      // class can halt in that time. A rebuilt handoff has not been halted.
      setTimeout(() => {
        if (!halt.halted) handoffRef.current.raiseHand(ctx);
      }, 0);
      return;
    }
    track('doubt_raised', {
      lessonId: lesson.id,
      beatId: ctx.beatId,
      beatIndex: player.beatIndex,
      mode: voiceMode ? 'voice' : 'text',
    });
    handoff.raiseHand(ctx);
  };

  // Resume: an unfinished lesson restarts from its saved beat, not the top.
  const savedBeat = progressStore.get().lessons[lesson.id]?.beatIndex ?? 0;
  const canResume =
    player.state === 'idle' && savedBeat > 0 && !isCompleted(progressStore.get(), lesson.id);
  /**
   * SHE GREETS THEM, BY NAME, AND REMEMBERS LAST TIME (G6-local, 2026-09-29).
   *
   * One warm line before the first beat: the student's first name (at most
   * once a class), and the last class they sat on this device when there was
   * one. Kept on the device only (`lastClassKey`) and never written into a
   * shared lesson; the name travels only in this one spoken line.
   */
  const greeted = useRef(false);
  const left = useRef(false);
  // Set again on mount: StrictMode's rehearsal unmount in development ran the
  // cleanup, and a never-reset flag stopped every class after the greeting.
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
    };
  }, []);
  /**
   * The first line of the class, and what it used from the notebook — so the
   * promise is cleared and the struggle marked once they have been SAID
   * (lib/studentMemory.ts: named once, never at every class forever).
   */
  const greetingLine = (): { line: string; saidPromise: boolean; saidStruggle?: { topic: string; lessonId: string } } => {
    const first = firstName(profileStore.get().name);
    const hi = tutorLanguage() === 'hi-en';
    const memory = greetingMemory(hi ? 'hi-en' : 'en');
    const title = lesson.title;
    const who = first ? ` ${first}` : '';
    // Their own promise from last time comes first — a tutor who remembers it
    // is a tutor who noticed them. Said once, then cleared.
    const promise = memory.promise
      ? hi
        ? ` Pichhli baar tumne khud se promise kiya tha — ${memory.promise}. Aaj try karte hain!`
        : ` Last time you promised yourself: ${memory.promise}. Let's try it today!`
      : '';
    const saidPromise = promise !== '';
    if (canResume) {
      return {
        line: hi
          ? `Welcome back${who}! Chalo, ${title} wahi se aage badhaate hain jahan chhoda tha.${promise}`
          : `Welcome back${who}! Let's pick up ${title} right where we left off.${promise}`,
        saidPromise,
      };
    }
    if (memory.lastTitle && memory.lastLessonId !== lesson.id) {
      const s = memory.struggle;
      const hard = s
        ? hi
          ? ` Pichhli baar ${s.topic} thoda tricky laga tha — koi baat nahi, woh bhi pakka karenge.`
          : ` ${s.topic} felt tricky last time — no worries, we'll make that solid too.`
        : '';
      return {
        line: hi
          ? `Welcome back${who}! Pichhli baar humne ${memory.lastTitle} padha tha.${hard} Aaj hum ${title} karenge.${promise}`
          : `Welcome back${who}! Last time we did ${memory.lastTitle}.${hard} Today it's ${title}.${promise}`,
        saidPromise,
        ...(s ? { saidStruggle: s } : {}),
      };
    }
    return {
      line: hi
        ? `Hi${who}! Main Meera hoon. Aaj hum ${title} padhenge — koi bhi doubt ho toh haath uthana. Chalo shuru karein!`
        : `Hi${who}! I'm Meera. Today we're doing ${title} — raise your hand any time you have a doubt. Let's begin!`,
      saidPromise,
    };
  };

  // Her notebook: where this class has got to, every beat — so the next
  // greeting knows the last class even when the student left halfway.
  const classStarted = player.state !== 'idle';
  useEffect(() => {
    if (!classStarted || halt.halted || !remember) return;
    setLastSession({
      lessonId: lesson.id,
      title: lesson.title,
      beatsDone: player.state === 'ended' ? lesson.beats.length : player.beatIndex,
      total: lesson.beats.length,
    });
  }, [classStarted, player.beatIndex, player.state, lesson, halt, remember]);

  const startClass = async () => {
    if (halt.halted) return;
    track('lesson_started', { lessonId: lesson.id, resumed: canResume, beats: lesson.beats.length });
    if (!greeted.current) {
      greeted.current = true;
      const greeting = greetingLine();
      const spoken = await sayLine(greeting.line);
      // They left while she was greeting them: unmounting stopped her voice,
      // which ends this await — and play() here would start the class in a
      // room nobody is in (overnight review #8).
      if (spoken.halted || left.current) return;
      // Said once: the promise is cleared and the struggle marked, so neither
      // is repeated at every class.
      if (greeting.saidPromise) clearCommitment();
      if (greeting.saidStruggle) markStruggleMentioned(greeting.saidStruggle.topic, greeting.saidStruggle.lessonId);
    }
    player.play();
    if (canResume) player.seek(savedBeat); // play() starts at 0; seek jumps mid-flight
  };

  /**
   * Nobody presses play on a live class. The room shows itself getting ready
   * for a beat, then the class begins on its own.
   *
   * The one exception is a student who arrived without ever touching the page
   * (a pasted link): the browser will not let audio start uninvited, so THAT
   * student gets a Join button — which is what Meet shows at a door anyway.
   */
  const [entryPhase, setEntryPhase] = useState<'preparing' | 'join' | 'inClass'>('preparing');
  // A warm class skips the room's own wait; the student has already had one.
  const readyAfter = warm ? 0 : PREPARE_MS;
  const entryPhaseRef = useRef(entryPhase);
  entryPhaseRef.current = entryPhase;
  const startClassRef = useRef(startClass);
  startClassRef.current = startClass;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (entryPhaseRef.current !== 'preparing') return;
      // Missing API (older browsers) counts as activated — autoplay simply fails
      // quiet there, which is still a running, captioned class.
      const activated = navigator.userActivation?.hasBeenActive ?? true;
      if (activated) {
        startClassRef.current();
        setEntryPhase('inClass');
      } else {
        setEntryPhase('join');
      }
    }, readyAfter);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const joinClass = () => {
    startClassRef.current();
    setEntryPhase('inClass');
  };

  /** The "I'm not sure" chip: raise a hand, open the typing row, and say it for them (#28). */
  const notSure = () => {
    if (halt.halted) return;
    notSureOpener.current =
      tutorLanguage() === 'hi-en'
        ? 'Mujhe samajh nahi aa raha, is sawaal ka jawab kaise doon?'
        : "I'm not sure how to answer this question.";
    setTyping(true);
    void raiseHand();
  };

  /**
   * A typed doubt, screened on the way out.
   *
   * The student sees their own words on screen either way — deleting what
   * somebody typed under them is worse than anything it might contain — but
   * what LEAVES the device is the cleaned version, and a sentence that needs a
   * person halts the class (lib/sessionHalt.ts) instead of reaching a model.
   */
  const sendText = (text: string, opts?: { opener?: boolean }) => {
    if (halt.halted) return;
    setTextLines((prev) => [...prev, { role: 'student', text, final: true }]);
    const out = halt.typedDoubt(text);
    // An off-limits question: her redirect, and the doubt carries on.
    if (out.reply !== null) {
      const reply = inLanguage(out.reply, tutorLanguage());
      setTextLines((prev) => [...prev, { role: 'tutor', text: reply, final: true }]);
      void halt.say(reply, 'typed-doubt');
    }
    // Null after that redirect, or after distress — which halted the class
    // inside typedDoubt, said the support line and put the support screen up.
    // Either way nothing leaves the device.
    if (out.forward === null) return;
    // Its length, never its words. clean() would drop the text anyway; not
    // writing it is the clearer statement.
    track('doubt_message_sent', { lessonId: lesson.id, length: text.length });
    handoff.sendUserText(out.forward, opts);
  };

  sendTextRef.current = sendText;

  const endDoubt = () => {
    if (!halt.halted) handoff.endDoubt();
  };

  // The doubt conversation: the live session's transcript, or the typed one.
  const doubtLines = voiceMode ? transcript : textLines;

  // What the room is doing right now, for the panel's status line. Derived
  // from the handoff first: the bridge line is spoken during AGENT_ENTERING,
  // and calling that moment "connecting" would contradict the student's ears.
  const doubtStatus =
    handoffState === 'AGENT_ENTERING'
      ? 'Meera is stepping in…'
      : handoffState === 'AGENT_LEAVING' || handoffState === 'RESUMING' || handoffState === 'PAUSING'
        ? 'Back to the class…'
        : !voiceMode
          ? 'Type your doubt — she reads it right away'
          : liveState === 'connecting'
            ? 'Connecting…'
            : liveState === 'listening'
              ? 'She is listening — speak, or type'
              : liveState === 'speaking'
                ? 'Meera is answering…'
                : "Couldn't hear you — you can type instead";

  const notStarted = !inDoubt && (player.state === 'idle' || player.state === 'ended');
  // The joining overlay: only over a class that has not begun. Once the class
  // ran to its end the room offers a replay instead.
  const joining = notStarted && player.state === 'idle' && entryPhase !== 'inClass';
  // Beat progress fills the top hairline the way established lesson players do.
  const progress =
    player.state === 'ended' ? 1 : (player.beatIndex + (player.state === 'idle' ? 0 : 1)) / lesson.beats.length;

  // During a doubt the caption carries the conversation's latest line — on a
  // phone it is the only place the conversation is visible.
  const lastDoubtLine = doubtLines[doubtLines.length - 1];
  // Her own line while she says one — praise, a hint, a nudge — else the narration.
  const caption = inDoubt ? (lastDoubtLine?.text ?? '') : preferences.captions ? (tutorLine ?? player.caption) : '';

  const barsShown = controlsShown || !canHideControls;
  const barClasses = barsShown ? 'opacity-100' : 'opacity-0 pointer-events-none';

  // The class has halted. The room is replaced rather than covered, so no
  // control under it — play, raise hand, the answer chips — can be reached by
  // a stray tap or a keyboard. Its one way out is the way out of the class.
  if (support !== null) return <SupportScreen line={support} onLeave={onExit} />;

  return (
    <div
      onPointerDown={revealControls}
      onPointerMove={revealControls}
      onKeyDown={revealControls}
      className="fixed inset-0 bg-stage text-stage-ink flex flex-col overflow-hidden font-body-md antialiased select-none"
    >
      {/* Beat progress, a hairline at the very top */}
      <div className="h-[3px] bg-white/15 flex-shrink-0">
        <div
          className="h-full bg-stage-blue rounded-r transition-all duration-500 ease-out"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* Top bar: whose class, and whether this is the recording or the live tutor */}
      <header
        className={`flex items-center gap-2.5 px-3 py-2 flex-shrink-0 transition-opacity duration-300 ${barClasses}`}
      >
        <button
          onClick={onExit}
          aria-label="Leave the class"
          className="w-9 h-9 rounded-full grid place-items-center hover:bg-white/10 transition-colors flex-shrink-0"
        >
          <Icon name="arrow_back" className="text-[22px]" />
        </button>
        <div className="min-w-0">
          <h1 className="font-headline-md text-[15px] leading-5 font-semibold text-stage-ink truncate">
            {lesson.title}
          </h1>
          <p className="font-label-sm text-[11.5px] leading-4 text-stage-ink-dim truncate">
            {lesson.subtitle ? `${lesson.subtitle} · ` : ''}
            {player.beatIndex + (player.state === 'idle' ? 0 : 1)}/{lesson.beats.length}
          </p>
        </div>
        <div className="flex-1" />
        {inDoubt ? (
          <span className="flex items-center gap-1.5 bg-stage-green-container text-stage-green-ink rounded-full px-2.5 py-1 font-label-sm text-label-sm font-bold tracking-wide flex-shrink-0">
            <span className="w-[7px] h-[7px] rounded-full bg-stage-green animate-pulse" />
            LIVE · DOUBT
          </span>
        ) : (
          <span className="flex items-center gap-1.5 bg-white/10 text-stage-ink rounded-full px-2.5 py-1 font-label-sm text-label-sm font-bold tracking-wide flex-shrink-0">
            <span className="w-[7px] h-[7px] rounded-full bg-stage-red" />
            REC
          </span>
        )}
        <span className="font-label-md text-[13px] font-semibold tabular-nums flex-shrink-0">
          {formatClock(elapsed)}
        </span>
      </header>

      {/* The room: the board, and (wide screens) the rail with Meera + the doubt */}
      <main className="flex-1 min-h-0 flex gap-3 px-3 pb-3">
        <section className="relative flex-1 min-w-0 bg-white rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
          <Scene lesson={board.sceneLesson} visible={canvas.visible} focus={canvas.focus} frame={canvas.frame} assets={diagrams} />

          {/* The caption: one line over the board, like Meet's captions. */}
          {caption && (
            <p
              className={`absolute left-3 bottom-3 max-w-[calc(100%-128px)] lg:max-w-[calc(100%-24px)] rounded-[10px] px-3.5 py-2 font-body-md text-[13.5px] lg:text-[15px] leading-snug text-white truncate ${
                inDoubt ? 'bg-stage-green-container/95' : 'bg-stage/85'
              }`}
            >
              {caption}
            </p>
          )}

          {/* The class is holding on a question. The chips ARE the answer
              sheet: tap one, and what she says next is never "correct!" — a
              right answer gets its why, a wrong one gets its hint and another
              try. The whys live in the lesson, not on the board. */}
          {player.pendingAsk && !inDoubt && (
            <div className="absolute inset-x-3 bottom-16 z-30 flex flex-wrap justify-center gap-2">
              {/* The ear's status over the chips: red while it listens, the
                  way a call shows a hot mic. */}
              {ear !== 'off' && (
                <span className="w-full flex justify-center">
                  <span className="flex items-center gap-2 rounded-full bg-stage-red px-3.5 py-1.5 font-label-md text-[12.5px] font-semibold text-white shadow-md">
                    <Icon
                      name={ear === 'listening' ? 'mic' : 'graphic_eq'}
                      filled
                      className="text-[15px] animate-pulse"
                    />
                    {ear === 'listening'
                      ? 'Mic on — say your answer out loud'
                      : 'Meera is listening to your answer…'}
                  </span>
                </span>
              )}
              {/* An OPEN ask has no options — she wants it said out loud, and
                  until she can hear, one honest button stands in for the ear.
                  Without it the chips row rendered empty and the class held
                  forever on its very first question. */}
              {!askChoicesHidden && (player.pendingAsk.options ?? []).length === 0 && (
                <button
                  onClick={() => void answerAsk(0)}
                  className="rounded-2xl bg-stage-primary px-5 py-2.5 font-label-md text-label-md font-semibold text-on-stage-primary shadow-md transition-transform active:scale-95"
                >
                  Say your answer out loud, then tap here
                </button>
              )}
              {!askChoicesHidden &&
                (player.pendingAsk.options ?? []).map((option, i) => (
                <button
                  key={i}
                  onClick={() => void answerAsk(i)}
                  className="max-w-[46%] rounded-2xl bg-stage-surface px-4 py-2.5 text-left font-body-md text-[13.5px] leading-snug text-stage-ink shadow-md ring-1 ring-white/15 transition-transform active:scale-95 hover:ring-stage-blue"
                >
                  <span className="font-bold text-stage-blue">{String.fromCharCode(65 + i)}.</span>{' '}
                  {option.text}
                </button>
              ))}
              {/* QUICK REPLIES (2026-09-29): what a student says to a tutor
                  who is waiting on them — ask for a hint, or say they are
                  lost. A hint goes through decide() like any other help; "not
                  sure" opens a doubt with Meera about this very question. */}
              {!askChoicesHidden && (
                <span className="w-full flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => void requestHint()}
                    className="min-h-[44px] rounded-full bg-stage-primary px-4 py-2 font-label-md text-[13px] font-semibold text-on-stage-primary shadow-md transition-transform active:scale-95"
                  >
                    💡 Give me a hint
                  </button>
                  <button
                    onClick={notSure}
                    className="min-h-[44px] rounded-full bg-stage-surface px-4 py-2 font-label-md text-[13px] font-semibold text-stage-ink shadow-md ring-1 ring-white/15 transition-transform active:scale-95"
                  >
                    🙋 I'm not sure
                  </button>
                  {(player.pendingAsk.alternates ?? []).length > 0 && (
                    <button
                      onClick={() => void requestExplain()}
                      className="min-h-[44px] rounded-full bg-stage-surface px-4 py-2 font-label-md text-[13px] font-semibold text-stage-ink shadow-md ring-1 ring-white/15 transition-transform active:scale-95"
                    >
                      🔄 Explain another way
                    </button>
                  )}
                  {workable && (
                    <button
                      onClick={() => setWorking(true)}
                      className="min-h-[44px] rounded-full bg-stage-surface px-4 py-2 font-label-md text-[13px] font-semibold text-stage-ink shadow-md ring-1 ring-white/15 transition-transform active:scale-95"
                    >
                      ✍️ Work it out
                    </button>
                  )}
                </span>
              )}
              {working && player.pendingAsk && (
                <span className="w-full">
                  <WorkPanel start={workStart} onStep={(step) => void onWorkedStep(step)} onClose={() => setWorking(false)} />
                </span>
              )}
            </div>
          )}

          {/* Joining: the room readies itself, then the class begins on its own. */}
          {joining && (
            <div className="absolute inset-0 grid place-items-center bg-stage/40 backdrop-blur-[2px]">
              {entryPhase === 'preparing' ? (
                <div className="flex flex-col items-center gap-4 px-6 text-center">
                  <div className="flex items-end gap-1.5 h-6" aria-hidden>
                    {[10, 20, 14, 22, 12].map((h, i) => (
                      <span
                        key={i}
                        className="w-1.5 rounded-full bg-white sound-bar"
                        style={{ height: h, animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                  <p className="font-headline-md text-[17px] leading-6 font-semibold text-white">
                    {canResume ? 'Picking up where you left off…' : 'Meera is getting your class ready…'}
                  </p>
                  {/* PREPARE_MS worth of fill, so the wait visibly ends. */}
                  <div className="w-48 h-1.5 rounded-full bg-white/25 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-white"
                      style={{ animation: `prepare-fill ${PREPARE_MS}ms linear forwards` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={joinClass}
                  className="flex items-center gap-2 bg-stage-primary text-on-stage-primary rounded-full px-7 py-4 font-label-md text-label-md font-semibold border-b-4 border-stage-primary-edge active:border-b-0 active:translate-y-1 transition-all"
                >
                  <Icon name="play_arrow" filled />
                  {canResume ? 'Rejoin class' : 'Join class'}
                </button>
              )}
            </div>
          )}

          {/* A finished class replays on request — the one press-to-play left. */}
          {!inDoubt && player.state === 'ended' && (
            <div className="absolute inset-0 grid place-items-center bg-stage/40 backdrop-blur-[2px]">
              <button
                onClick={startClass}
                className="flex items-center gap-2 bg-stage-primary text-on-stage-primary rounded-full px-7 py-4 font-label-md text-label-md font-semibold border-b-4 border-stage-primary-edge active:border-b-0 active:translate-y-1 transition-all"
              >
                <Icon name="replay" filled />
                Watch again
              </button>
            </div>
          )}
        </section>

        {/* The rail: Meera's window over the doubt conversation. Wide screens only. */}
        <aside className="hidden lg:flex w-[300px] flex-shrink-0 flex-col gap-3">
          <TutorTile mode={tutorMode} variant="rail" clone={tile} />
          <DoubtPanel
            active={inDoubt}
            lines={doubtLines}
            status={doubtStatus}
            onSend={inDoubt ? sendText : undefined}
            onDone={inDoubt ? endDoubt : undefined}
          />
        </aside>
      </main>

      {/* On a phone Meera floats over the board, Meet PiP style — and steps
          out while the answer chips or the typing row are up: wherever she
          floated she covered one of them on a small phone (overnight review
          #29; fifth review measured option B and the send button). Her lines
          stay in the caption. */}
      {!((player.pendingAsk && !inDoubt) || (inDoubt && typing)) && (
        <div className="lg:hidden absolute right-4 bottom-[96px] z-40">
          <TutorTile mode={tutorMode} variant="pip" clone={tile} />
        </div>
      )}

      {/* Typed doubt on a phone: a slim input row the keyboard button summons. */}
      {inDoubt && typing && (
        <div className="lg:hidden flex gap-2 px-3 pb-2 z-30">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !draft.trim()) return;
              sendText(draft.trim());
              setDraft('');
            }}
            placeholder="Type your doubt…"
            aria-label="Type your doubt"
            className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-stage-surface text-stage-ink font-body-md text-[14px] placeholder:text-stage-ink-dim outline-none focus:ring-2 focus:ring-stage-blue"
          />
          <button
            onClick={() => {
              if (!draft.trim()) return;
              sendText(draft.trim());
              setDraft('');
            }}
            aria-label="Send doubt"
            className="w-11 h-11 rounded-xl bg-stage-primary text-on-stage-primary grid place-items-center flex-shrink-0"
          >
            <Icon name="send" filled className="text-[18px]" />
          </button>
        </div>
      )}

      {/* The toolbar. It fades like Meet's — the board stays exactly where it is. */}
      <nav
        aria-hidden={!barsShown}
        className={`flex justify-center items-center gap-3.5 px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-1 flex-shrink-0 transition-opacity duration-300 ${barClasses}`}
      >
        {!inDoubt ? (
          <>
            <ToolButton
              icon={player.state === 'playing' ? 'pause' : 'play_arrow'}
              label={player.state === 'playing' ? 'Pause the class' : 'Play the class'}
              onClick={() => (player.state === 'playing' ? player.pause() : player.play())}
              disabled={notStarted}
            />
            <ToolButton
              icon="front_hand"
              label="Raise hand and ask a doubt"
              tone="primary"
              big
              onClick={raiseHand}
              disabled={player.state !== 'playing' && player.state !== 'paused'}
            />
            <ToolButton
              icon="closed_caption"
              label={preferences.captions ? 'Hide captions' : 'Show captions'}
              tone={preferences.captions ? 'lit' : 'plain'}
              onClick={() => setPreference('captions', !preferences.captions)}
            />
            <ToolButton
              icon="error"
              label="Report something in this class"
              onClick={() => setReporting(true)}
            />
            <ToolButton icon="call_end" label="Leave the class" tone="red" onClick={onExit} />
          </>
        ) : (
          <>
            {voiceMode ? (
              <ToolButton
                icon={muted ? 'mic_off' : 'mic'}
                label={muted ? 'Unmute microphone' : 'Mute microphone'}
                tone={muted ? 'plain' : 'primary'}
                onClick={() => setMuted((m) => !m)}
                disabled={handoffState !== 'LIVE'}
              />
            ) : (
              <div className="lg:hidden">
                <ToolButton
                  icon="keyboard"
                  label="Type your doubt"
                  tone={typing ? 'lit' : 'plain'}
                  onClick={() => setTyping((t) => !t)}
                />
              </div>
            )}
            {voiceMode && (
              <div className="lg:hidden">
                <ToolButton
                  icon="keyboard"
                  label="Type your doubt"
                  tone={typing ? 'lit' : 'plain'}
                  onClick={() => setTyping((t) => !t)}
                />
              </div>
            )}
            <ToolButton icon="check" label="Got it — back to the class" tone="green" big onClick={endDoubt} />
            <ToolButton
              icon="closed_caption"
              label={preferences.captions ? 'Hide captions' : 'Show captions'}
              tone={preferences.captions ? 'lit' : 'plain'}
              onClick={() => setPreference('captions', !preferences.captions)}
            />
            <ToolButton
              icon="error"
              label="Report something in this class"
              onClick={() => setReporting(true)}
            />
            <ToolButton icon="call_end" label="Leave the class" tone="red" onClick={onExit} disabled />
          </>
        )}
      </nav>

      {micAsk && <MicRationale onAllow={() => micAsk(true)} onSkip={() => micAsk(false)} />}

      {/* THE REPORT CARRIES WHERE IT HAPPENED, not just that it happened.
          `spokenLine` is her own delivered line — the doubt tutor's latest if
          a doubt is open, otherwise the beat's narration — and on a 'rude' or
          an 'unsafe' report it is the only field that says what the child is
          objecting to. `player.caption` rather than the `caption` above,
          because that one is blanked when the student has captions switched
          off, and what she said does not depend on whether it was subtitled. */}
      {reporting && (
        <ReportSheet
          lessonId={lesson.id}
          topicRef={lesson.topicRef}
          beatId={player.beat?.id ?? null}
          spokenLine={
            inDoubt
              ? ([...doubtLines].reverse().find((l) => l.role === 'tutor')?.text ?? null)
              : (player.caption || null)
          }
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}
