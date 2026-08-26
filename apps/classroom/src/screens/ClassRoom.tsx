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
import { useDiagramAssets } from '../lib/diagrams';
import { buildStudentContext } from '../lib/student';
import { createGeminiAgent } from '../lib/geminiAgent';
import { createLiveAgent, type LiveState, type TranscriptLine } from '../lib/liveAgent';
import { requestMic } from '../lib/mic';
import { progressStore, saveBeat, markCompleted, isCompleted } from '../stores/progress';
import { doubtLogStore, logDoubt } from '../stores/doubtLog';
import { recordDoubtAtBeat, recordLessonTaught } from '../stores/outcomes';
import { profileStore } from '../stores/profile';
import { settingsStore } from '../stores/settings';
import { preferencesStore, setPreference } from '../stores/preferences';
import { useStore } from '../stores/localStore';
import { Icon } from '../ui/Icon';
import { TutorTile, type TutorMode } from '../ui/TutorTile';
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
  const preferences = useStore(preferencesStore);

  // Resolved HERE rather than inside the classroom because usePlayer rebuilds
  // its controller when the adapter's identity changes: a voice that arrived a
  // moment late would restart the class from the top.
  const tts = useLessonVoice(entry, lesson, { enabled: preferences.voice });
  // Resolved here for the same reason the voice is: the classroom should not
  // remount because a picture arrived a moment after the lesson did.
  const diagrams = useDiagramAssets(entry, lesson);

  useEffect(() => {
    let cancelled = false;
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
  }, [lessonId]);

  if (error) {
    return (
      <div className="bg-background min-h-screen grid place-items-center px-margin-mobile font-body-md">
        <div className="text-center flex flex-col items-center gap-4">
          <Icon name="error" className="text-4xl text-on-surface-variant" />
          <p className="font-headline-md text-[18px] leading-6 text-on-surface">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-stage-primary text-on-stage-primary rounded-full px-6 py-3 font-label-md text-label-md font-semibold border-b-4 border-stage-primary-edge active:border-b-0 active:translate-y-1 transition-all"
          >
            Back home
          </button>
        </div>
      </div>
    );
  }
  if (!lesson || !tts) {
    return (
      <div className="bg-background min-h-screen grid place-items-center font-body-md">
        <p className="font-body-md text-body-md text-on-surface-variant">Loading…</p>
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
  onExit,
}: {
  lesson: Lesson;
  /** Resolved by the route: the recorded take, her live voice, or the browser's. */
  tts: TtsAdapter;
  /** SVG markup for the lesson's `diagram` elements, keyed by element id. */
  diagrams: Record<string, string>;
  onExit(): void;
}) {
  const navigate = useNavigate();
  const player = usePlayer(lesson, tts);

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
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  const openRouterKey = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;
  // Typed doubts can go through either. OpenRouter first when its key exists,
  // because one key reaches the same models when a Google project is blocked.
  // The LIVE VOICE cannot follow: OpenRouter serves text only, so speaking to
  // her still needs the Gemini key.
  const apiKey = openRouterKey ?? geminiKey;

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
      }),
    [profile, settings.klass, doubts, lesson.id],
  );

  const agent = useMemo(() => {
    // No class on file means nothing true to tell her about the student, and a
    // guessed class is a tutor pitching a lesson at a child who is not there.
    if (!apiKey || student === null) return createStubAgent();
    if (voiceMode) {
      // Voice is Gemini-only, and voiceMode is never entered without that key.
      return createLiveAgent({
        apiKey: geminiKey!,
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
    return createGeminiAgent({
      apiKey,
      student,
      provider: openRouterKey ? 'openrouter' : 'gemini',
    });
  }, [apiKey, geminiKey, openRouterKey, voiceMode, student]);

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
      ? { visible: [...recalled.show], focus: [...(recalled.focus ?? [])] }
      : computeVisible(lesson, player.beatIndex);

  const tutorMode: TutorMode = inDoubt
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

    if (apiKey && student !== null) {
      // A mic is no use without the key that can carry speech.
      const status = geminiKey ? await requestMic() : 'denied';
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
    handoff.raiseHand(ctx);
  };

  // Resume: an unfinished lesson restarts from its saved beat, not the top.
  const savedBeat = progressStore.get().lessons[lesson.id]?.beatIndex ?? 0;
  const canResume =
    player.state === 'idle' && savedBeat > 0 && !isCompleted(progressStore.get(), lesson.id);
  const startClass = () => {
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
    }, PREPARE_MS);
    return () => clearTimeout(timer);
  }, []);

  const joinClass = () => {
    startClassRef.current();
    setEntryPhase('inClass');
  };

  const sendText = (text: string) => {
    setTextLines((prev) => [...prev, { role: 'student', text, final: true }]);
    handoff.sendUserText(text);
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
          <Scene lesson={lesson} visible={canvas.visible} focus={canvas.focus} assets={diagrams} />

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
          <TutorTile mode={tutorMode} variant="rail" />
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
        <TutorTile mode={tutorMode} variant="pip" />
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
            <ToolButton icon="call_end" label="Leave the class" tone="red" onClick={onExit} disabled />
          </>
        )}
      </nav>
    </div>
  );
}
