import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hasMath, type Beat, type Lesson } from '@ai-tutor/lesson-format';
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
import { listenOnce, type Heard } from '../lib/ear';
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
import { readWarmUpAnswer, warmUpFor, type WarmUpQuestion } from '../lib/warmUp';
import { profileStore } from '../stores/profile';
import { settingsStore } from '../stores/settings';
import { preferencesStore, showCaptions } from '../stores/preferences';
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
  sameTitle,
  setLastSession,
  similarTitle,
} from '../lib/studentMemory';
import type { AssistanceRung } from '@ai-tutor/ledger';
import { track } from '../lib/telemetry';
import { ReportSheet } from '../ui/ReportSheet';
import { MicRationale } from '../ui/MicRationale';
import { TutorTile, type TutorMode } from '../ui/TutorTile';
import type { ClipManifest } from '@ai-tutor/teacher-clone';
import { DoubtPanel } from '../ui/DoubtPanel';
import { SupportScreen } from '../ui/SupportScreen';
import { withoutAskInk } from '../lib/askInk';
import { useMediaQuery } from '../lib/useMediaQuery';
import { dontKnowIn } from '@ai-tutor/tutor-judge';

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

/**
 * Turns the room could not use on one question — the judge failed, nothing
 * clear was heard, or she declined an off-limits reply — before the class
 * goes on without an answer. Nothing on screen can end a held question now,
 * so every way of not answering has to run out somewhere.
 */
const UNUSABLE_TURNS = 3;

/**
 * How long the class waits, before anything is said, for the warm-up lookup
 * (it loads the syllabus map when a review is due). A placeholder (UNVERIFIED
 * on a phone): past it the class starts without a warm-up.
 */
const WARM_UP_WAIT_MS = 2_500;

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
 * The board's box where the room around it is not 16:9: the largest 16:9 that
 * fits the box it stands in (STAGE_BOX makes that box a size container, so
 * `cqw`/`cqh` are its width and height).
 */
const STAGE_BOX = { containerType: 'size' } as const;
const STAGE_FIT = { width: 'min(100cqw, calc(100cqh * 16 / 9))', aspectRatio: '16 / 9' } as const;

/**
 * The classroom — laid out the way Meet lays out a call with a presentation,
 * because "a Google Meet where an AI teacher is taking a live class" is the
 * product. The board is the shared screen and takes everything; Meera is a
 * participant tile (side rail on wide screens, a small window beside the board
 * on a phone held sideways, the room under it on one held upright); the top
 * bar says which class this is; the toolbar holds the controls and fades away
 * like Meet's.
 *
 * Wiring only — every decision this screen appears to make is actually made
 * inside a package:
 *   what's on the canvas   → stage (computeVisible / Scene)
 *   when beats advance     → player
 *   the raise-hand handoff → doubt-session
 *   when the class stops   → lib/sessionHalt (distress in the student's words or a model's)
 */
export function ClassRoom({
  lesson: given,
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
  // A class kept before 2026-10-01 wrote its questions on the board; it plays
  // without them (lib/askInk.ts). Memoised on the lesson it was given, because
  // the player rebuilds on a new lesson identity and would restart the class.
  const lesson = useMemo(() => withoutAskInk(given), [given]);
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
  /** A warm-up question is being asked aloud (E6-E8) — see `runWarmUp`. */
  const [warmingUp, setWarmingUp] = useState(false);
  // A warm-up is time on task: its answers are this sitting's, and so are its
  // minutes (second review — they were answers with no time under them).
  const ledger = useClassLedger(lesson, player.state === 'playing' || warmingUp, player.state === 'ended');

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

  /** The held question whose last line was a C7 follow-up, waiting on their reasoning. */
  const followUpOpen = useRef<string | null>(null);

  /** The held question's answer as an option index, for a gate she closes herself. */
  const correctIndex = (ask: { options?: readonly { correct?: boolean }[] }): number =>
    // -1 when no option is marked: the player reads that as an open question and resolves it.
    (ask.options ?? []).findIndex((o) => o.correct === true);

  /**
   * WHAT THE STUDENT SAYS TO A HELD QUESTION: OUT LOUD, OR TYPED WITHOUT A MIC.
   *
   * The class shows no question and nothing to tap (Aarav, 2026-10-01). She
   * asks out loud and they answer out loud. A student whose mic is refused or
   * will not open gets one box under the board, "Type your answer", and what
   * they type goes down the same road as a spoken answer: the same screen,
   * judge, ladder and silence policy (the held-question effect below).
   */
  const [answerBy, setAnswerBy] = useState<'voice' | 'text' | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  /** The room is waiting on a typed answer: hand it the words. */
  const typedWaiting = useRef<((text: string) => void) | null>(null);
  /** A line typed while she was still talking: the next wait takes it at once. */
  const typedEarly = useRef<string | null>(null);
  const submitTyped = (): void => {
    const text = answerDraft.trim();
    if (!text) return;
    setAnswerDraft('');
    if (typedWaiting.current) typedWaiting.current(text);
    else typedEarly.current = text;
  };
  /**
   * One typed answer, returned the way `listenOnce` returns a spoken one: the
   * words; 'silence' once QUIET_BEFORE_NUDGE_MS has passed with none; or
   * 'cancelled'.
   */
  const typedOnce = (isCancelled: () => boolean): Promise<Heard> =>
    new Promise((resolve) => {
      const early = typedEarly.current;
      typedEarly.current = null;
      if (early !== null) {
        resolve({ text: early, reason: 'heard' });
        return;
      }
      const started = Date.now();
      const done = (heard: Heard): void => {
        clearInterval(poll);
        typedWaiting.current = null;
        resolve(heard);
      };
      const poll = setInterval(() => {
        if (isCancelled()) done({ text: null, reason: 'cancelled' });
        else if (Date.now() - started >= QUIET_BEFORE_NUDGE_MS) done({ text: null, reason: 'silence' });
      }, 100);
      typedWaiting.current = (text) => done({ text, reason: 'heard' });
    });
  /** One answer, by whichever way this student can give one. */
  const answerOnce = (by: 'voice' | 'text', isCancelled: () => boolean): Promise<Heard> =>
    by === 'voice' ? listenOnce({ isCancelled }) : typedOnce(isCancelled);

  /** Per held question: answers judged so far, and the highest ladder rung delivered (decide()). */
  const triesAt = useRef(new Map<string, number>());
  /** Held questions the student raised a hand on — help, so no "win" is noted there. */
  const helpedByDoubt = useRef(new Set<string>());
  const rungAt = useRef(new Map<string, AssistanceRung>());
  /** Her recent fixed lines, so decide() never says the same one twice in a row. */
  const recentLines = useRef<string[]>([]);

  const [handoffState, setHandoffState] = useState<HandoffState>('PLAYING');
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
   * doubts the STUDENT starts. Nothing on screen answers for them (Aarav,
   * 2026-10-01): no options, no chips. A student with no working mic types
   * into the one box under the board, and this same loop takes what they type
   * — "the ear" below means either.
   *
   * EVERY HELD QUESTION ENDS HERE, because nothing on screen can end one now:
   * a right answer; the ladder run to its reveal; quiet through the nudge and
   * the hint, which gets the answer and its why; or UNUSABLE_TURNS turns the
   * room could not use. Each opens the gate, and the class goes on.
   */
  const [ear, setEar] = useState<'off' | 'listening' | 'thinking'>('off');
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

  /** The held question answered right whose gate has not opened yet (a cut-short praise). */
  const answeredRight = useRef<string | null>(null);

  // The question surfacing is what starts the clock on an answer. It is its own
  // effect so the clock starts at once, while the ear may still be waiting on
  // the mic question.
  useEffect(() => {
    // The class moved on: whatever was standing is over, and if that beat
    // comes round again — a seek back — it is genuinely being asked afresh.
    if (askFiled.current !== null && askFiled.current !== player.beat?.id) askFiled.current = null;
    if (answeredRight.current !== null && answeredRight.current !== player.beat?.id) answeredRight.current = null;
    if (!heldAskBeat) return;
    // Answered right, and her praise cut short by a pause or a hand: the
    // question comes back answered, not asked again (fifth review).
    if (answeredRight.current === heldAskBeat) {
      const standing = playerRef.current.pendingAsk;
      if (standing) playerRef.current.answer(correctIndex(standing));
      return;
    }
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
    // A follow-up is a window of one reply, and a new ear starts with none.
    followUpOpen.current = null;
    // A line typed for another question is not an answer to this one.
    typedEarly.current = null;
    /** Her fixed line for a moment, in their language, avoiding one just said. */
    const fixed = (lines: Record<'en' | 'hi-en', readonly string[]>): string => {
      const all = lines[tutorLanguage()];
      return all.find((l) => !recentLines.current.includes(l)) ?? all[0];
    };
    /**
     * The class goes on: her line, then the gate opens on the answer the ask
     * holds. Nothing is filed here — whoever calls it has filed what it gave.
     */
    const goOn = async (line: string | undefined): Promise<void> => {
      setEar('off');
      if (line) {
        recentLines.current = [...recentLines.current.slice(-8), line];
        const spoken = await sayLine(line);
        if (over() || spoken.halted) return;
      }
      const standing = playerRef.current.pendingAsk;
      if (standing) playerRef.current.answer(correctIndex(standing));
    };
    (async () => {
      let by: 'voice' | 'text' = (await askForMic()) === 'granted' ? 'voice' : 'text';
      if (over()) return;
      setAnswerBy(by);
      /**
       * The exchange, Aarav's shape: a wrong answer gets a hint and another
       * try; a RIGHT answer is not the exit either — she asks one why/how/
       * when about their own answer, hears the reasoning, closes the loop,
       * and only then the class moves. Thinking is the point, both ways.
       */
      let probe: { answer: string; question: string; askedAt: number } | null = null;
      let silences = 0;
      /** Turns the room could not use on this question (UNUSABLE_TURNS). */
      let unusable = 0;
      /**
       * One more turn the room could not use. Under the limit the ear listens
       * again, after `line` if she has not already answered the turn; at the
       * limit the class goes on. True when the question is over.
       */
      const unusableTurn = async (line: string | null): Promise<boolean> => {
        unusable += 1;
        setEar('off');
        if (unusable >= UNUSABLE_TURNS) {
          await goOn(fixed(LINES.carryOn));
          return true;
        }
        if (line !== null) {
          recentLines.current = [...recentLines.current.slice(-8), line];
          const spoken = await sayLine(line);
          if (over() || spoken.halted) return true;
        }
        ledger.reopened(heldAskBeat, Date.now());
        quietSince = Date.now();
        return false;
      };
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
      while (!over()) {
        const ask = playerRef.current.pendingAsk;
        if (!ask) return;
        setEar('listening');
        // Polled on every chunk (or every 100 ms of a typed wait): a halt
        // closes the mic on the next one.
        const heard = await answerOnce(by, over);
        if (over()) return;
        // A mic that will not open is not a quiet student — the OS gave it to
        // a call, or the page lost it. The box under the board takes over for
        // the rest of this question. (Their reasoning, below, files it as
        // unheard instead.)
        if (heard.reason === 'error' && by === 'voice' && !probe) {
          by = 'text';
          setAnswerBy('text');
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
          // Her own reply swapped for the support line: the class has halted.
          if (spoken?.halted) return;
          // Closed — or declined, where their reasoning went somewhere off
          // limits (close.halt), her line said in full. The answer itself was
          // right and is on record, so the class goes on either way.
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
           * hint (L3). On a third she gives the answer and its why (L8), and
           * the class goes on (`stillSilent`, 2026-10-01): nothing on screen is
           * left to carry the question.
           */
          if (heard.reason !== 'silence') return;
          if (Date.now() - quietSince < QUIET_BEFORE_NUDGE_MS) continue;
          silences += 1;
          const verdict = silences === 1 ? 'silent' : silences === 2 ? 'hintRequest' : 'stillSilent';
          const nudge = decide({
            verdict,
            attempt: (triesAt.current.get(heldAskBeat) ?? 0) + 1,
            rungSoFar: rungAt.current.get(heldAskBeat) ?? 0,
            ask,
            lang: tutorLanguage(),
            now: Date.now(),
            recentLines: recentLines.current,
          });
          rungAt.current.set(heldAskBeat, nudge.rung);
          // Help they did not ask for: silence is not a request, even when
          // decide() was asked for the hint on its behalf.
          if (nudge.helped !== null) ledger.helped(heldAskBeat, nudge.helped, false, nudge.strategy);
          // A nudge closes a follow-up's window: what they say next is an answer.
          followUpOpen.current = null;
          const nudgeNote = nudge.boardIntent?.text;
          if (nudgeNote) board.writeHeld(heldAskBeat, [{ author: 'lesson', steps: [{ say: '', ink: [{ op: 'note', text: nudgeNote }] }] }]);
          if (verdict === 'stillSilent') {
            await goOn(nudge.say);
            return;
          }
          quietSince = Date.now();
          // Every line would repeat or leak: nothing said, and the next quiet climbs.
          if (!nudge.say) continue;
          recentLines.current = [...recentLines.current.slice(-8), nudge.say];
          setEar('off');
          const spokenNudge = await sayLine(nudge.say);
          if (over() || spokenNudge.halted) return;
          ledger.reopened(heldAskBeat, Date.now());
          quietSince = Date.now();
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
            attempt: (triesAt.current.get(heldAskBeat) ?? 0) + 1,
            rungSoFar: rungAt.current.get(heldAskBeat) ?? 0,
            ask,
            lang: tutorLanguage(),
            now: Date.now(),
            recentLines: recentLines.current,
          });
          rungAt.current.set(heldAskBeat, help.rung);
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
            // Off-limits: her redirect, not "thanks" (fifth review) — a turn
            // the room could not use.
            if (await unusableTurn(inLanguage(screened.say, tutorLanguage()))) return;
            continue;
          }
          const line = fixed(LINES.afterFollowUp);
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
        // Distress first (third review).
        if (resolved?.verdict.halt && halt.heard(heard.text, 'ear')) return;
        // A judge that failed knows nothing about the student: ask again.
        if (resolved === null) {
          if (await unusableTurn(fixed(LINES.sayAgain))) return;
          continue;
        }
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
         * One count of tries per question, kept across a pause or a raised
         * hand, so a later answer is never read as a first attempt at rung 0
         * (overnight review #16).
         */
        const priorTries = triesAt.current.get(heldAskBeat) ?? 0;
        if (judged.verdict !== 'unclear') triesAt.current.set(heldAskBeat, priorTries + 1);
        // "unclear" is not evidence about the student — nothing is recorded.
        // Her notebook: a miss marks the topic hard; a right answer with no
        // help at all marks it a win.
        {
          const where = { topic: playerRef.current.beat?.topic ?? lesson.title, lessonId: lesson.id };
          if (remember && judged.verdict === 'wrong') recordStruggle(where);
          else if (
            remember &&
            judged.verdict === 'right' &&
            priorTries === 0 &&
            (rungAt.current.get(heldAskBeat) ?? 0) === 0 &&
            !helpedByDoubt.current.has(heldAskBeat)
          )
            recordWin(where);
        }
        if (judged.verdict !== 'unclear') {
          recordAnswerAtBeat(lesson, heldAskBeat, judged.verdict === 'right');
          if (judged.verdict === 'right') answeredRight.current = heldAskBeat;
          // The ledger keeps what the counter cannot: their actual words, the
          // verdict the judge reached, and how long the thinking took. A turn
          // the safety screen stopped is dropped entirely rather than trimmed.
          ledger.answered({
            beatId: heldAskBeat,
            correct: judged.verdict === 'right',
            surface: by,
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
         * A WRONG ANSWER CLIMBS THE LADDER (E2, 2026-09-29).
         *
         * The judge only CLASSIFIES here; `decide()` chooses the help — look
         * again (L1), the authored hint (L3), the answer and why (L8) — in the
         * child's language, never with a model-invented hint. Filed before it
         * is said, and the hint is written in the question's work area. Their
         * own words are not written on the board (Aarav, 2026-10-01): the
         * board is hers. When decide() has nothing authored to say, the
         * judge's own line is the fallback, screened as a model's.
         */
        let ladderLine: string | null = null;
        let movingOn = false;
        if (judged.verdict === 'wrong') {
          const action = decide({
            verdict: 'wrong',
            attempt: priorTries + 1,
            rungSoFar: rungAt.current.get(heldAskBeat) ?? 0,
            ask,
            // Which option their words were, so a named misconception gets
            // its own follow-up question (C7) rather than the generic rethink.
            ...(resolved.matched !== undefined ? { matchedOption: resolved.matched } : {}),
            lang: tutorLanguage(),
            now: Date.now(),
            recentLines: recentLines.current,
          });
          rungAt.current.set(heldAskBeat, action.rung);
          // The answer and its why, or "let's keep going" after them: either
          // way the question is over once she has said it.
          movingOn = action.kind === 'moveOn' || action.kind === 'reveal';
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
          if (hintText) board.writeHeld(heldAskBeat, [{ author: 'lesson', steps: [{ say: '', ink: [{ op: 'note', text: hintText }] }] }]);
        }
        // A whyProbe matched on the device answers with the lesson's own
        // why or hint, so it is the lesson speaking (`sayAuthored`); anything
        // the judge's model wrote is screened as a model's.
        const spoken =
          ladderLine !== null
            ? await sayLine(ladderLine)
            : resolved.path === 'local'
              ? await sayLine(inLanguage(judged.say, tutorLanguage()))
              : await sayLine(inLanguage(judged.say, tutorLanguage()), 'ear');
        if (over()) return;
        // A model reply swapped for the support line, or a class halted while
        // she spoke (spoken.halted): `over()` already caught it.
        if (spoken.halted) return;
        // An off-limits answer (judged.halt), or one the judge could not make
        // out ('unclear'): she has just said so, in full, and the ear listens
        // again — a turn the room could not use.
        if (judged.halt || judged.verdict === 'unclear') {
          if (await unusableTurn(null)) return;
          continue;
        }
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
          quietSince = Date.now();
          continue;
        }
        // The answer and its why, or "let's keep going" after them: she said
        // it, so the class goes on — the gate opens on the answer she gave
        // (overnight review #10/#26).
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
        // No count here: each miss climbs decide()'s ladder, and the ladder
        // ends in the reveal, which ends the question above.
      }
    })().finally(() => {
      if (!cancelled) {
        setEar('off');
        setAnswerBy(null);
      }
    });
    return () => {
      cancelled = true;
      setEar('off');
      setAnswerBy(null);
    };
  }, [heldAskBeat, lesson, tts]);

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
  const greetingLine = (
    afterWarmUp = false,
  ): { line: string; saidPromise: boolean; saidStruggle?: { topic: string; lessonId: string } } => {
    const said = greetingBody();
    if (!afterWarmUp) return said;
    // She said hello with the warm-up; the rest follows it.
    const rest = said.line.replace(/^(?:Welcome back|Hi)[^!]*!\s*(?:I'm Meera\.\s*|Main Meera hoon\.\s*)?/, '');
    return { ...said, line: rest.charAt(0).toUpperCase() + rest.slice(1) };
  };
  const greetingBody = (): { line: string; saidPromise: boolean; saidStruggle?: { topic: string; lessonId: string } } => {
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
    // The same class again: a topic prepared afresh has a new lesson id (and
    // can have a new title) but is not "last time" — she said "Last time we
    // did X. Today it's X." Known by id, by title, or by topic with a title
    // like it (two lessons can share a topic: the heart, and blood).
    const sameClass =
      memory.lastLessonId === lesson.id ||
      (memory.lastTitle !== undefined && sameTitle(memory.lastTitle, title)) ||
      (memory.lastTopicRef !== undefined &&
        memory.lastTopicRef === lesson.topicRef &&
        memory.lastTitle !== undefined &&
        similarTitle(memory.lastTitle, title));
    if (memory.lastTitle && sameClass) {
      return {
        line: hi
          ? `Welcome back${who}! Chalo, ${title} ek baar phir karte hain.${promise}`
          : `Welcome back${who}! Let's go through ${title} again.${promise}`,
        saidPromise,
      };
    }
    if (memory.lastTitle) {
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
      ...(lesson.topicRef ? { topicRef: lesson.topicRef } : {}),
      beatsDone: player.state === 'ended' ? lesson.beats.length : player.beatIndex,
      total: lesson.beats.length,
    });
  }, [classStarted, player.beatIndex, player.state, lesson, halt, remember]);

  /**
   * THE WARM-UP (E6-E8, 2026-09-29), ASKED OUT LOUD (2026-10-01). When a
   * review is due, the class opens with one or two questions on it — before
   * her greeting's recap (the warm-up says hello), before the first beat, and
   * never on a resumed class. Looked up while the room gets ready; a lookup
   * that has not answered WARM_UP_WAIT_MS after the class starts is dropped
   * and she greets them.
   *
   * Nothing is shown (Aarav, 2026-10-01). She reads the question and its
   * choices, and they answer the way they answer anything in the class: out
   * loud, or in the box under the board without a mic. Words that name one
   * choice are filed cold (`ledger.warmedUp`) and she says whether it was
   * right. Silence, or words that name no choice twice over, file nothing:
   * she says the answer and goes on. A question with maths in it is not
   * asked, because her voice reads no LaTeX and nothing is on screen to read
   * it from.
   */
  const warmUpReady = useRef<Promise<WarmUpQuestion[]> | null>(null);
  useEffect(() => {
    warmUpReady.current = warmUpFor(lesson.topicRef, outcomesOf(lesson));
  }, [lesson]);

  /** Runs the warm-up if one is due; whether it ran. */
  const runWarmUp = async (): Promise<boolean> => {
    const due = await Promise.race([
      warmUpReady.current ?? Promise.resolve([]),
      new Promise<WarmUpQuestion[]>((resolve) => setTimeout(() => resolve([]), WARM_UP_WAIT_MS)),
    ]);
    const items = due.filter((q) => !hasMath(q.question) && !q.options.some((o) => hasMath(o)));
    const done = (): boolean => left.current || halt.halted;
    if (items.length === 0 || done()) return false;
    const hi = tutorLanguage() === 'hi-en';
    const first = firstName(profileStore.get().name);
    const who = first ? ` ${first}` : '';
    track('warm_up_started', { lessonId: lesson.id, items: items.length });
    setWarmingUp(true);
    try {
      let by: 'voice' | 'text' = (await askForMic()) === 'granted' ? 'voice' : 'text';
      for (const [step, question] of items.entries()) {
        if (done()) break;
        // Never the outcome's title: in 63 of the bank's probes the title
        // holds the answer word for word (second review).
        // A student with no class behind them — only the placement test, whose
        // answers fall due the next day — is met, not welcomed back (third review).
        const returning = greetingMemory(hi ? 'hi-en' : 'en').lastTitle !== undefined;
        const lead =
          step === 0
            ? returning
              ? hi
                ? `Welcome back${who}! Class se pehle ek chhota sa warm-up — pichhli class se ek sawaal.`
                : `Welcome back${who}! Before we start, a quick warm-up question from an earlier class.`
              : hi
                ? `Hi${who}! Main Meera hoon. Class se pehle ek chhota sa warm-up sawaal.`
                : `Hi${who}! I'm Meera. Before we start, a quick warm-up question.`
            : hi
              ? 'Ek aur.'
              : 'One more.';
        const options = question.options;
        const choices = hi
          ? `${options.slice(0, -1).join(', ')} ya ${options[options.length - 1]}?`
          : `Is it ${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}?`;
        const asked = await sayLine(`${lead} ${question.question} ${choices}`);
        if (asked.halted || done()) break;
        // The clock starts when she has finished asking.
        const clockFrom = Date.now();
        // The endpointer gives up on one listen after a few seconds; the
        // question is not over until QUIET_BEFORE_NUDGE_MS of quiet.
        let quietSince = clockFrom;
        setAnswerBy(by);
        let chosen: number | null = null;
        for (let tries = 0; tries < 2 && chosen === null && !done(); ) {
          const heard = await answerOnce(by, done);
          if (done()) break;
          // A mic that will not open: the box takes this answer instead.
          if (heard.reason === 'error' && by === 'voice') {
            by = 'text';
            setAnswerBy('text');
            continue;
          }
          if (heard.text === null) {
            if (Date.now() - quietSince < QUIET_BEFORE_NUDGE_MS) continue;
            break;
          }
          tries += 1;
          const screened = fromStudent(heard.text, lesson.id);
          // Distress stops the class on the one halt every path shares.
          if (screened.say !== null && halt.heard(heard.text, 'ear')) return true;
          // Only a choice they named (`readWarmUpAnswer`).
          chosen = screened.text === null ? null : readWarmUpAnswer(screened.text, options);
          if (chosen !== null) break;
          if (tries >= 2 || (screened.text !== null && dontKnowIn(screened.text) === 'only')) break;
          // Off limits: her redirect. Otherwise, once: say it again.
          const again = screened.say !== null ? inLanguage(screened.say, tutorLanguage()) : LINES.sayAgain[tutorLanguage()][0];
          setAnswerBy(null);
          const said = await sayLine(again);
          if (said.halted || done()) break;
          quietSince = Date.now();
          setAnswerBy(by);
        }
        setAnswerBy(null);
        if (done()) break;
        const answer = options[question.correctIndex];
        if (chosen !== null) ledger.warmedUp(question, chosen, Date.now() - clockFrom);
        const said = await sayLine(
          chosen === question.correctIndex
            ? hi
              ? 'Bilkul sahi — tumhe yaad tha!'
              : "That's right — you remembered it!"
            : chosen !== null
              ? hi
                ? `Sahi jawab hai ${answer}. Koi baat nahi — ise jaldi phir dekhenge.`
                : `The answer is ${answer}. No worries — we'll come back to it soon.`
              : hi
                ? `Koi baat nahi — jawab hai ${answer}. Ise jaldi phir dekhenge.`
                : `That's okay — the answer is ${answer}. We'll come back to it soon.`,
        );
        if (said.halted || done()) break;
      }
    } finally {
      setAnswerBy(null);
      setWarmingUp(false);
    }
    return true;
  };

  const startClass = async () => {
    if (halt.halted) return;
    track('lesson_started', { lessonId: lesson.id, resumed: canResume, beats: lesson.beats.length });
    if (!greeted.current) {
      greeted.current = true;
      // The warm-up comes before any recap: "last time we did X" names what
      // is due (plan T3.5). Never on a class picked up where it was left.
      const warmed = canResume ? false : await runWarmUp();
      if (left.current || halt.halted) return;
      const greeting = greetingLine(warmed);
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

  /**
   * A typed doubt, screened on the way out.
   *
   * The student sees their own words on screen either way — deleting what
   * somebody typed under them is worse than anything it might contain — but
   * what LEAVES the device is the cleaned version, and a sentence that needs a
   * person halts the class (lib/sessionHalt.ts) instead of reaching a model.
   */
  const sendText = (text: string) => {
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
    handoff.sendUserText(out.forward);
  };

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

  // The joining overlay: only over a class that has not begun.
  const joining = !inDoubt && player.state === 'idle' && entryPhase !== 'inClass';

  /**
   * CAPTIONS ARE A SETTING, OFF BY DEFAULT, AND NEVER ON THE BOARD (Aarav,
   * 2026-10-01): the board is hers to write on. On, they run in a strip
   * under it — and they are on whenever her voice is off, because then they
   * are the only way to hear her (`showCaptions`).
   */
  const captionsOn = showCaptions(preferences);
  // During a doubt the caption carries the conversation's latest line — on a
  // phone it is the only place the conversation is visible.
  const lastDoubtLine = doubtLines[doubtLines.length - 1];
  // Her own line while she says one — praise, a hint, a nudge — else the narration.
  // During the warm-up only her own lines: the class's first line, under a
  // question about another topic, read as part of it (production, 2026-09-29).
  const caption = !captionsOn
    ? ''
    : inDoubt
      ? (lastDoubtLine?.text ?? '')
      : (tutorLine ?? (warmingUp ? '' : player.caption));
  // The box under the board, while a question waits on a student with no mic.
  const answerBoxShown = answerBy === 'text' && !inDoubt;

  /**
   * THE BOARD IS 16:9 ON EVERY SCREEN (Aarav, 2026-10-01: "like long-form
   * YouTube"; canvas C2). Three rooms around it:
   *   wide     a laptop: the stage as large as the room allows, Meera and the
   *            doubt in the rail beside it;
   *   sideways a phone held sideways: the stage fills the screen, and only the
   *            two controls, her small picture and the report flag float on it;
   *   upright  everything else: the stage across the top like a video, and
   *            Meera's tile in the room under it.
   * The camera frames whatever box the stage is (Scene measures it), so every
   * frame comes out 16:9 with no change to the camera.
   */
  const wide = useMediaQuery('(min-width: 1024px)');
  const sideways = useMediaQuery('(orientation: landscape) and (max-height: 500px)') && !wide;
  const fitted = wide || sideways;

  const barsShown = controlsShown || !canHideControls;
  const barClasses = barsShown ? 'opacity-100' : 'opacity-0 pointer-events-none';

  // The class has halted. The room is replaced rather than covered, so no
  // control under it — play, raise hand, the answer chips — can be reached by
  // a stray tap or a keyboard. Its one way out is the way out of the class.
  if (support !== null) return <SupportScreen line={support} onLeave={onExit} />;

  // The board. Its box is 16:9 in every room; Scene frames whatever box it is.
  const stage = (
    <section
      style={fitted ? STAGE_FIT : undefined}
      className={`relative bg-white overflow-hidden ${
        fitted ? 'rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.5)]' : 'w-full aspect-video flex-shrink-0'
      }`}
    >
      <Scene lesson={board.sceneLesson} visible={canvas.visible} focus={canvas.focus} frame={canvas.frame} assets={diagrams} />

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
    </section>
  );

  /** The stage in a box that is not 16:9: as large as fits, centred. */
  const fittedStage = (
    <div className="flex-1 min-h-0 min-w-0 grid place-items-center" style={STAGE_BOX}>
      {stage}
    </div>
  );

  // Captions, when they are on: a strip under the board, never on it. Up to
  // two lines. During a doubt on a wide screen the rail already shows the
  // conversation, so the strip steps aside there.
  const captionStrip = caption && !(inDoubt && wide) && (
    <p
      data-caption
      className={`flex-shrink-0 rounded-[10px] px-3.5 py-2 font-body-md text-[13.5px] lg:text-[15px] leading-snug text-white ${
        inDoubt ? 'bg-stage-green-container/95' : 'bg-stage-surface'
      }`}
    >
      <span className="line-clamp-2">{caption}</span>
    </p>
  );

  // A held question, and no mic to hear the answer: the one box she reads
  // from. Under the board, never on it.
  const answerBox = answerBoxShown && (
    <div className="flex gap-2 flex-shrink-0">
      <input
        autoFocus
        value={answerDraft}
        onChange={(e) => setAnswerDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitTyped();
        }}
        placeholder="Type your answer…"
        aria-label="Type your answer"
        className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-stage-surface text-stage-ink font-body-md text-[14px] placeholder:text-stage-ink-dim outline-none focus:ring-2 focus:ring-stage-blue"
      />
      <button
        onClick={submitTyped}
        aria-label="Send answer"
        className="w-11 h-11 rounded-xl bg-stage-primary text-on-stage-primary grid place-items-center flex-shrink-0"
      >
        <Icon name="send" filled className="text-[18px]" />
      </button>
    </div>
  );

  // A typed doubt where there is no rail: a slim input row the keyboard
  // button summons.
  const doubtRow = !wide && inDoubt && typing && (
    <div className="flex gap-2 flex-shrink-0">
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
  );

  // A student must always have a way to say "this was wrong", and the moment
  // they want it is the moment it happened. Beside the clock, so the toolbar
  // keeps only its two controls.
  const reportButton = (
    <button
      onClick={() => setReporting(true)}
      aria-label="Report something in this class"
      className="w-9 h-9 rounded-full grid place-items-center hover:bg-white/10 transition-colors flex-shrink-0"
    >
      <Icon name="flag" className="text-[20px]" />
    </button>
  );
  const clock = (
    <span className="font-label-md text-[13px] font-semibold tabular-nums flex-shrink-0">{formatClock(elapsed)}</span>
  );

  // The toolbar: raise a hand, or end the class — nothing else (Aarav,
  // 2026-10-01). It fades like Meet's; the board stays exactly where it is,
  // because no room puts the toolbar on it.
  const toolbar = (
    <nav
      aria-hidden={!barsShown}
      className={`transition-opacity duration-300 ${barClasses} ${
        sideways
          ? 'w-full flex flex-wrap justify-center items-center gap-2'
          : 'flex justify-center items-center gap-3.5 px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-1 flex-shrink-0'
      }`}
    >
      {!inDoubt ? (
        <>
          <ToolButton
            icon="front_hand"
            label="Raise hand and ask a doubt"
            tone="primary"
            big
            onClick={raiseHand}
            disabled={player.state !== 'playing' && player.state !== 'paused'}
          />
          <ToolButton icon="call_end" label="End the class" tone="red" onClick={onExit} />
        </>
      ) : (
        <>
          {voiceMode && (
            <ToolButton
              icon={muted ? 'mic_off' : 'mic'}
              label={muted ? 'Unmute microphone' : 'Mute microphone'}
              tone={muted ? 'plain' : 'primary'}
              onClick={() => setMuted((m) => !m)}
              disabled={handoffState !== 'LIVE'}
            />
          )}
          {/* Where there is no rail to type in, the keyboard brings up the doubt row. */}
          {!wide && (
            <ToolButton
              icon="keyboard"
              label="Type your doubt"
              tone={typing ? 'lit' : 'plain'}
              onClick={() => setTyping((t) => !t)}
            />
          )}
          <ToolButton icon="check" label="Got it — back to the class" tone="green" big onClick={endDoubt} />
          <ToolButton icon="call_end" label="End the class" tone="red" onClick={onExit} disabled />
        </>
      )}
    </nav>
  );

  return (
    <div
      onPointerDown={revealControls}
      onPointerMove={revealControls}
      onKeyDown={revealControls}
      className={`fixed inset-0 bg-stage text-stage-ink flex overflow-hidden font-body-md antialiased select-none ${
        sideways ? 'flex-row' : 'flex-col'
      }`}
    >
      {sideways ? (
        <>
          {/* A phone held sideways: the stage takes the screen's full height,
              and everything else stands in a slim column beside it — Meera
              small at the top, the controls under her. Nothing is on the board. */}
          <main className="flex-1 min-w-0 flex flex-col gap-2 p-1">
            {fittedStage}
            {captionStrip}
            {answerBox}
            {doubtRow}
          </main>
          <aside className="w-[128px] flex-shrink-0 flex flex-col items-center gap-2 py-2 pr-2">
            {/* She steps out while a typing row is up, so the row has the
                height it needs on a short screen. */}
            {!((inDoubt && typing) || answerBoxShown) && (
              <TutorTile mode={tutorMode} variant="pip" clone={tile} />
            )}
            <header className={`flex items-center justify-between w-full transition-opacity duration-300 ${barClasses}`}>
              {clock}
              {reportButton}
            </header>
            <div className="flex-1" />
            {toolbar}
          </aside>
        </>
      ) : (
        <>
          {/* Top bar: whose class, the class clock, and the way to report
              something. Nothing here says "recording" (Aarav, 2026-10-01). */}
          <header
            className={`flex items-center gap-2.5 px-3 py-2 flex-shrink-0 transition-opacity duration-300 ${barClasses}`}
          >
            <div className="min-w-0">
              <h1 className="font-headline-md text-[15px] leading-5 font-semibold text-stage-ink truncate">
                {lesson.title}
              </h1>
              {lesson.subtitle && (
                <p className="font-label-sm text-[11.5px] leading-4 text-stage-ink-dim truncate">{lesson.subtitle}</p>
              )}
            </div>
            <div className="flex-1" />
            {clock}
            {reportButton}
          </header>

          {wide ? (
            /* A wide screen: the stage as large as the room allows, and the
               rail beside it with Meera over the doubt conversation. */
            <main className="flex-1 min-h-0 flex gap-3 px-3 pb-3">
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                {fittedStage}
                {captionStrip}
                {answerBox}
              </div>
              <aside className="w-[300px] flex-shrink-0 flex flex-col gap-3">
                <TutorTile mode={tutorMode} variant="rail" clone={tile} />
                {/* The conversation's lines are captions too: shown only with them on. */}
                <DoubtPanel
                  active={inDoubt}
                  lines={captionsOn ? doubtLines : []}
                  status={doubtStatus}
                  onSend={inDoubt ? sendText : undefined}
                  onDone={inDoubt ? endDoubt : undefined}
                />
              </aside>
            </main>
          ) : (
            /* A phone held upright: the stage across the top like a video,
               and Meera in the room under it. */
            <main className="flex-1 min-h-0 flex flex-col gap-2 pb-2">
              {stage}
              <div className="flex-1 min-h-0 flex flex-col gap-2 px-3">
                {captionStrip}
                {answerBox}
                {doubtRow}
                <div className="flex-1 min-h-0">
                  <TutorTile mode={tutorMode} variant="fill" clone={tile} />
                </div>
              </div>
            </main>
          )}

          {toolbar}
        </>
      )}

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
