import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findBeat, type Lesson } from '@ai-tutor/lesson-format';
import { Scene, computeVisible } from '@ai-tutor/stage';
import { usePlayer, createBrowserTts } from '@ai-tutor/player';
import {
  buildContext,
  createHandoff,
  createStubAgent,
  type HandoffState,
} from '@ai-tutor/doubt-session';
import { findEntry, fetchLesson } from '../lib/content';
import { createGeminiAgent } from '../lib/geminiAgent';
import { createLiveAgent } from '../lib/liveAgent';
import { requestMic } from '../lib/mic';
import { progressStore, saveBeat, markCompleted, isCompleted } from '../stores/progress';
import { logDoubt } from '../stores/doubtLog';
import { Icon } from '../ui/Icon';
import { TutorBadge, type TutorMode } from '../ui/TutorBadge';
import {
  VoiceDoubtSheet,
  type VoiceState,
  type TranscriptLine,
} from '../ui/VoiceDoubtSheet';

/** Route wrapper: /lesson/:lessonId → load + validate, then hand to the classroom. */
export function LessonRoute() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entry = lessonId ? await findEntry(lessonId) : null;
      if (!entry) throw new Error('This lesson does not exist.');
      const loaded = await fetchLesson(entry);
      if (!cancelled) setLesson(loaded);
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
            className="bg-primary text-on-primary rounded-full px-6 py-3 font-label-md text-label-md font-semibold border-b-4 border-[#323499] active:border-b-0 active:translate-y-1 transition-all"
          >
            Back home
          </button>
        </div>
      </div>
    );
  }
  if (!lesson) {
    return (
      <div className="bg-background min-h-screen grid place-items-center font-body-md">
        <p className="font-body-md text-body-md text-on-surface-variant">Loading…</p>
      </div>
    );
  }
  return <ClassRoom lesson={lesson} onExit={() => navigate('/')} />;
}

/**
 * The classroom. Wiring only — every decision this screen appears to make is
 * actually made inside a package:
 *   what's on the canvas   → stage (computeVisible / Scene)
 *   when beats advance     → player
 *   the raise-hand handoff → doubt-session
 */
export function ClassRoom({ lesson, onExit }: { lesson: Lesson; onExit(): void }) {
  const navigate = useNavigate();
  const tts = useMemo(() => createBrowserTts({ lang: 'en-IN' }), []);
  const player = usePlayer(lesson, tts);

  // Refs so the (stable) handoff always calls the latest player controls.
  const playerRef = useRef(player);
  playerRef.current = player;

  const [handoffState, setHandoffState] = useState<HandoffState>('PLAYING');
  const [agentLines, setAgentLines] = useState<string[]>([]);
  const [recallBeatId, setRecallBeatId] = useState<string | null>(null);

  // Live-voice session state, fed by the live agent's callbacks.
  const [liveState, setLiveState] = useState<VoiceState>('connecting');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
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
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

  const agent = useMemo(() => {
    if (!apiKey) return createStubAgent();
    if (voiceMode) {
      return createLiveAgent({
        apiKey,
        onState: setLiveState,
        onMicLevel: setMicLevel,
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
    return createGeminiAgent({ apiKey });
  }, [apiKey, voiceMode]);

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
        setAgentLines([]);
        setTranscript([]);
        setMicLevel(0);
        setMuted(false);
      }
    });
    const offSay = handoff.on('agent-say', (line) => {
      if (line) setAgentLines((prev) => [...prev, line]);
    });
    return () => {
      offState();
      offSay();
    };
  }, [handoff]);

  // The canvas: during a recall, show the recalled beat; otherwise follow playback.
  const inDoubt = handoffState !== 'PLAYING';
  const recalled = recallBeatId ? findBeat(lesson, recallBeatId) : null;
  const canvas =
    inDoubt && recalled
      ? { visible: [...recalled.show], focus: [...(recalled.focus ?? [])] }
      : computeVisible(lesson, player.beatIndex);

  const avatarMode: TutorMode = inDoubt
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

    if (apiKey) {
      const status = await requestMic();
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

  const caption = inDoubt ? (agentLines.at(-1) ?? '') : player.caption;
  const notStarted = !inDoubt && (player.state === 'idle' || player.state === 'ended');
  // Beat progress fills the top bar the way established lesson players do.
  const progress = player.state === 'ended' ? 1 : (player.beatIndex + (player.state === 'idle' ? 0 : 1)) / lesson.beats.length;


  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md antialiased pb-[104px]">
      {/* Top: back, progress, title */}
      <header className="w-full px-margin-mobile pt-4 pb-3 bg-surface sticky top-0 z-10 flex flex-col gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            aria-label="Go back"
            className="text-on-surface-variant hover:bg-surface-container-high p-2 rounded-full transition-colors flex-shrink-0"
          >
            <Icon name="arrow_back" />
          </button>
          <div className="flex-grow h-3 bg-surface-variant rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          {inDoubt && (
            <span className="flex items-center gap-1.5 bg-[#dcfce7] text-[#166534] rounded-full px-3 py-1 font-label-sm text-label-sm font-bold flex-shrink-0">
              <span className="w-2 h-2 rounded-full bg-[#16a34a] animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex flex-col">
          <h1 className="font-headline-md text-headline-md font-bold text-on-surface">{lesson.title}</h1>
          {lesson.subtitle && (
            <p className="font-label-md text-label-md text-on-surface-variant mt-0.5">{lesson.subtitle}</p>
          )}
        </div>
      </header>

      {/* The canvas card */}
      <main className="flex-grow flex flex-col px-margin-mobile py-stack-md gap-stack-md max-w-[1120px] mx-auto w-full">
        <section className="bg-surface-container-lowest rounded-[24px] p-card-padding shadow-soft-indigo relative">
          <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-surface-container-low grid place-items-center">
            <Scene lesson={lesson} visible={canvas.visible} focus={canvas.focus} />

            {/* Not started / finished: one clear action, centre-canvas. */}
            {notStarted && (
              <div className="absolute inset-0 grid place-items-center bg-surface-container-lowest/70 backdrop-blur-[2px]">
                <button
                  onClick={startClass}
                  className="flex items-center gap-2 bg-primary text-on-primary rounded-full px-7 py-4 font-label-md text-label-md font-semibold border-b-4 border-[#323499] active:border-b-0 active:translate-y-1 transition-all"
                >
                  <Icon name={player.state === 'ended' ? 'replay' : 'play_arrow'} filled />
                  {player.state === 'ended' ? 'Watch again' : canResume ? 'Resume class' : 'Start class'}
                </button>
              </div>
            )}
          </div>

          {/* The tutor, sitting on the card's edge */}
          <div className="absolute -bottom-6 right-4">
            <TutorBadge mode={avatarMode} />
          </div>
        </section>

        {/* What she is saying right now */}
        <section className="text-center px-4 max-w-2xl mx-auto mt-6 min-h-[64px]">
          {caption && (
            <p className="font-body-lg text-body-lg text-on-surface-variant">{caption}</p>
          )}
        </section>
      </main>

      {/* Bottom: lesson controls, or the live doubt sheet */}
      {!inDoubt ? (
        <nav className="fixed bottom-0 left-0 w-full z-50 px-margin-mobile py-4 bg-surface-container rounded-t-[20px] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex gap-4 items-center w-full max-w-[1120px] mx-auto">
            <button
              onClick={() => (player.state === 'playing' ? player.pause() : player.play())}
              aria-label={player.state === 'playing' ? 'Pause lesson' : 'Play lesson'}
              className="grid place-items-center text-on-surface-variant bg-surface rounded-full w-12 h-12 border-2 border-outline-variant hover:bg-surface-container-high transition-colors flex-shrink-0"
            >
              <Icon name={player.state === 'playing' ? 'pause' : 'play_arrow'} filled />
            </button>
            <button
              onClick={raiseHand}
              disabled={player.state !== 'playing' && player.state !== 'paused'}
              className="flex-grow flex items-center justify-center gap-2 bg-primary text-on-primary rounded-full px-6 py-3 font-label-md text-label-md font-semibold border-b-4 border-[#323499] active:border-b-0 active:translate-y-1 transition-all disabled:opacity-40 disabled:border-b-4 disabled:active:translate-y-0"
            >
              <Icon name="front_hand" filled />
              Raise hand
            </button>
          </div>
        </nav>
      ) : voiceMode ? (
        <VoiceDoubtSheet
          handoff={handoffState}
          voice={handoffState === 'LIVE' ? liveState : 'connecting'}
          transcript={transcript}
          micLevel={micLevel}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          onEnd={() => handoff.endDoubt()}
          onSendText={(text) => handoff.sendUserText(text)}
        />
      ) : (
        <VoiceDoubtSheet
          handoff={handoffState}
          voice={handoffState === 'LIVE' ? 'listening' : 'connecting'}
          transcript={agentLines.map((text) => ({ role: 'tutor' as const, text, final: true }))}
          micLevel={0}
          muted
          onToggleMute={() => {}}
          onEnd={() => handoff.endDoubt()}
          onSendText={(text) => handoff.sendUserText(text)}
        />
      )}
    </div>
  );
}
