import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findBeat, type Lesson } from '@ai-tutor/lesson-format';
import { Scene, computeVisible } from '@ai-tutor/stage';
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
import { buildStudentContext } from '../lib/student';
import { createGeminiAgent } from '../lib/geminiAgent';
import { createLiveAgent, type LiveState, type TranscriptLine } from '../lib/liveAgent';
import {
  micExplained,
  micStatus,
  rememberMicExplained,
  requestMic,
  type MicStatus,
} from '../lib/mic';
import { listenOnce } from '../lib/ear';
import { judgeSpokenAnswer, resolveCrossQuestion } from '../lib/judge';
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
import { fromStudent, toStudent } from '../lib/safety';
import { track } from '../lib/telemetry';
import { ReportSheet } from '../ui/ReportSheet';
import { MicRationale } from '../ui/MicRationale';
import { TutorTile, type TutorMode } from '../ui/TutorTile';
import type { ClipManifest } from '@ai-tutor/teacher-clone';
import { DoubtPanel } from '../ui/DoubtPanel';

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
 */
export function ClassRoom({
  lesson,
  tts,
  diagrams,
  clone,
  onExit,
  warm = false,
}: {
  lesson: Lesson;
  /**
   * A real teacher, lip-dubbed, instead of Curie own penguin. Absent for
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
}) {
  const navigate = useNavigate();
  const player = usePlayer(lesson, tts);

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

  /**
   * The student answers a held question.
   *
   * Order matters on a RIGHT answer: the why is spoken while the class is
   * still holding, THEN the gate opens — answering first would start the next
   * beat's line and cancel the why mid-sentence. A wrong answer resolves
   * nothing: the hint is spoken and the chips stay, because wrong gets a
   * nudge and another try, never the solution on the first miss.
   */
  // True while an answer is being weighed or spoken about — the choices hide
  // AT ONCE on a tap or a heard answer, so nothing on screen suggests the
  // class did not register it. They return only if the answer was wrong.
  const [askBusy, setAskBusy] = useState(false);

  const answerAsk = async (index: number) => {
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
    try {
      if (correct) {
        const why = option?.why;
        if (why) await tts.speak(`And why is that the right one? ${why}`);
        player.answer(index);
      } else {
        player.answer(index);
        const nudge = option?.hint ?? option?.why;
        if (nudge) {
          // Recorded BEFORE it is spoken, so the next attempt is already
          // standing on rung 3 rather than being mistaken for an unassisted one.
          ledger.helped(beatId, 3, false);
          await tts.speak(nudge);
          // And the clock on the retry starts when she stops, not when they
          // missed: the chips come back now. Same rule as the spoken path.
          ledger.reopened(beatId, Date.now());
        }
      }
    } finally {
      setAskBusy(false);
    }
  };

  // Refs so the (stable) handoff always calls the latest player controls.
  const playerRef = useRef(player);
  playerRef.current = player;

  const [handoffState, setHandoffState] = useState<HandoffState>('PLAYING');
  const [textLines, setTextLines] = useState<TranscriptLine[]>([]);
  const [recallBeatId, setRecallBeatId] = useState<string | null>(null);

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
      }),
    [profile, settings.klass, doubts, lesson.id],
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
    // answer that at least belongs to the lesson.
    return createGeminiAgent({ student, fallback: createStubAgent() });
  }, [liveVoiceKey, voiceMode, student]);

  const handoff = useMemo(
    () =>
      createHandoff({
        agent,
        speak: (text) => tts.speak(text),
        onPause: () => playerRef.current.pause(),
        onResume: () => {
          // Recall view ends with the doubt; play() re-speaks the current beat,
          // which doubles as a natural re-anchor into the lesson.
          setRecallBeatId(null);
          playerRef.current.play();
        },
        onRecall: (beatId) => setRecallBeatId(beatId),
      }),
    [lesson, tts, agent],
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
   * ANYTHING SHE IS ABOUT TO SAY, LOOKED AT FIRST.
   *
   * The outbound half of the safety screen had no caller: every line the judge
   * and the doubt tutor produced went straight to the speaker. It matters most
   * exactly where a model is most likely to go wrong — repeating a child's
   * disclosure back at them as if it were teaching — so this is on the path
   * from a MODEL's words to the student's ears, and nowhere else. The lesson's
   * own narration is not screened here: it came through prep, which screens
   * what it plans, and re-checking it every beat would be a filter running
   * against a fixed recording forever.
   */
  const speakSafely = async (text: string): Promise<{ halted: boolean }> => {
    const screened = toStudent(text, lesson.id);
    const swapped = screened.say !== null;
    await tts.speak(screened.say ?? screened.text ?? text);
    // She has just told a student to talk to somebody. Whoever called this has
    // a next line — resolve the question, reopen the mic — and every one of
    // them would be the app talking over that.
    return { halted: swapped };
  };

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
  const heldAskBeat = player.pendingAsk && !inDoubt ? (player.beat?.id ?? null) : null;

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
    (async () => {
      if ((await askForMic()) !== 'granted') return;
      /**
       * The exchange, Aarav's shape: a wrong answer gets a hint and another
       * try; a RIGHT answer is not the exit either — she asks one why/how/
       * when about their own answer, hears the reasoning, closes the loop,
       * and only then the class moves. Thinking is the point, both ways.
       */
      let probe: { answer: string; question: string; askedAt: number } | null = null;
      let tries = 0;
      while (!cancelled) {
        const ask = playerRef.current.pendingAsk;
        if (!ask) return;
        setEar('listening');
        const heard = await listenOnce({ isCancelled: () => cancelled });
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
        if (cancelled) return;

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
          if (cancelled) return;
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
          const spoken = close ? await speakSafely(close.say) : null;
          if (cancelled) return;
          // She has just told them to talk to somebody. Resolving the question
          // and moving the class on would be the app talking over that —
          // whether the halt came from the student's words (close.halt) or
          // from her own reply being swapped for the support line.
          if (close?.halt || spoken?.halted) return;
          const options = ask.options ?? [];
          playerRef.current.answer(Math.max(0, options.findIndex((o) => o.correct === true)));
          return;
        }

        if (heard.text === null) return; // silence — the chips carry it
        setEar('thinking');
        const judged = await judgeSpokenAnswer(ask, heard.text).catch(() => null);
        if (cancelled) return;
        // A judge that failed says nothing and leaves the chips standing.
        if (judged === null) return;
        // "unclear" is not evidence about the student — nothing is recorded.
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
        if (judged.verdict === 'wrong') {
          ledger.helped(heldAskBeat, judged.gave === 'hint' ? 3 : 2, false);
        }
        const spoken = await speakSafely(judged.say);
        if (cancelled) return;
        // The student said something that needs a person. She has just said so;
        // reopening the mic and asking the question again would be the app
        // talking straight over them.
        if (judged.halt || spoken.halted) return;
        if (judged.verdict === 'right') {
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
          continue;
        }
        // SHE HAS FINISHED SPEAKING THE HINT, so the retry clock starts now.
        // `answered` above moved it to the moment their wrong answer landed;
        // everything since is her talking, and charging the student for it
        // would inflate attempt 2 by the length of a hint — worse than the
        // judge round trip this whole change exists to take out.
        ledger.reopened(heldAskBeat, Date.now());
        tries += 1;
        if (tries >= 2) return; // two misses — the hint stands, the chips wait
      }
    })().finally(() => {
      if (!cancelled) setEar('off');
    });
    return () => {
      cancelled = true;
      setEar('off');
    };
  }, [heldAskBeat, lesson, tts]);

  // The choices leave the screen the moment an answer is in flight — a tap,
  // or a spoken answer being judged. What remains is the status chip.
  const askChoicesHidden = askBusy || ear === 'thinking';

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
  // recording playing, or the live tutor talking a doubt through.
  const [elapsed, setElapsed] = useState(0);
  const clockRunning = player.state === 'playing' || inDoubt;
  useEffect(() => {
    if (!clockRunning) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1_000);
    return () => clearInterval(timer);
  }, [clockRunning]);

  // The canvas: during a recall, show the recalled beat; otherwise follow playback.
  const recalled = recallBeatId ? findBeat(lesson, recallBeatId) : null;
  const canvas =
    inDoubt && recalled
      ? {
          visible: [...recalled.show],
          focus: [...(recalled.focus ?? [])],
          // Without its frame, recalling a moment on a long lesson framed the
          // whole plane — every page at once, all of it too small to read.
          ...(recalled.frame ? { frame: [...recalled.frame] } : {}),
        }
      : computeVisible(lesson, player.beatIndex);

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
    const ctx = buildContext(lesson, player.beatIndex);
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
    if (player.pendingAsk) ledger.helped(ctx.beatId, 7, true);

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
      setTimeout(() => handoffRef.current.raiseHand(ctx), 0);
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
  const startClass = () => {
    track('lesson_started', { lessonId: lesson.id, resumed: canResume, beats: lesson.beats.length });
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
   * person gets her answer instead of a model's.
   */
  const sendText = (text: string) => {
    setTextLines((prev) => [...prev, { role: 'student', text, final: true }]);
    const screened = fromStudent(text, lesson.id);
    if (screened.text === null) {
      const say = screened.say ?? '';
      setTextLines((prev) => [...prev, { role: 'tutor', text: say, final: true }]);
      void speakSafely(say);
      return;
    }
    // Its length, never its words. clean() would drop the text anyway; not
    // writing it is the clearer statement.
    track('doubt_message_sent', { lessonId: lesson.id, length: text.length });
    handoff.sendUserText(screened.text);
  };

  const endDoubt = () => handoff.endDoubt();

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
  const caption = inDoubt ? (lastDoubtLine?.text ?? '') : preferences.captions ? player.caption : '';

  const barsShown = controlsShown || !canHideControls;
  const barClasses = barsShown ? 'opacity-100' : 'opacity-0 pointer-events-none';

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
          <Scene lesson={lesson} visible={canvas.visible} focus={canvas.focus} frame={canvas.frame} assets={diagrams} />

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

      {/* On a phone Meera floats over the board, Meet PiP style. */}
      <div className="lg:hidden absolute right-4 bottom-[96px] z-40">
        <TutorTile mode={tutorMode} variant="pip" clone={tile} />
      </div>

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

      {reporting && <ReportSheet lessonId={lesson.id} onClose={() => setReporting(false)} />}
    </div>
  );
}
