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
import { progressStore, saveBeat, markCompleted, isCompleted } from '../stores/progress';
import { logDoubt } from '../stores/doubtLog';
import { Avatar, type AvatarMode } from '../ui/Avatar';
import { Controls } from '../ui/Controls';
import { DoubtPanel } from '../ui/DoubtPanel';
import { BackIcon, PlayIcon, ReplayIcon } from '../ui/icons';
import { theme, chunky } from '../ui/theme';

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
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: theme.bg, fontFamily: theme.font, padding: 24 }}>
        <div style={{ textAlign: 'center', display: 'grid', gap: 14, justifyItems: 'center' }}>
          <div style={{ color: theme.text, font: `800 17px ${theme.font}` }}>{error}</div>
          <button onClick={() => navigate('/')} style={{ ...chunky(theme.blue, theme.blueDark), minHeight: 46, padding: '10px 22px' }}>
            Back home
          </button>
        </div>
      </div>
    );
  }
  if (!lesson) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: theme.bg, fontFamily: theme.font }}>
        <div style={{ color: theme.textFaint, font: `700 15px ${theme.font}` }}>Loading…</div>
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

  // The real tutor when a key is configured; the scripted stub otherwise, so
  // the app runs (and the seam demos) with zero setup.
  const agent = useMemo(() => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    return apiKey ? createGeminiAgent({ apiKey }) : createStubAgent();
  }, []);

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

  useEffect(() => {
    const offState = handoff.on('statechange', () => {
      setHandoffState(handoff.state);
      if (handoff.state === 'PLAYING') setAgentLines([]);
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

  const avatarMode: AvatarMode = inDoubt
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

  const raiseHand = () => {
    const ctx = buildContext(lesson, player.beatIndex);
    logDoubt(lesson.id, ctx.beatId);
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: theme.bg,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: theme.font,
        overflow: 'hidden',
      }}
    >
      {/* Top bar: back + progress bar (+ LIVE pill during a doubt) */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          paddingTop: 'calc(12px + env(safe-area-inset-top))',
        }}
      >
        <button
          onClick={onExit}
          aria-label="back to library"
          style={{
            width: 42,
            height: 42,
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            background: 'none',
            color: theme.textFaint,
            cursor: 'pointer',
          }}
        >
          <BackIcon />
        </button>
        <div
          aria-label={`progress: beat ${player.beatIndex + 1} of ${lesson.beats.length}`}
          style={{
            flex: 1,
            height: 14,
            borderRadius: 8,
            background: theme.border,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: '100%',
              borderRadius: 8,
              background: theme.green,
              boxShadow: 'inset 0 -4px 0 rgba(0,0,0,0.12)',
              transition: 'width 400ms ease',
            }}
          />
        </div>
        {inDoubt && (
          <span
            style={{
              color: '#ffffff',
              background: theme.green,
              font: `800 11px ${theme.font}`,
              letterSpacing: 0.8,
              borderRadius: 12,
              padding: '4px 12px',
              boxShadow: `0 2px 0 ${theme.greenDark}`,
            }}
          >
            LIVE
          </span>
        )}
      </header>

      {/* Lesson title */}
      <div style={{ padding: '0 20px 6px', textAlign: 'center' }}>
        <div style={{ color: theme.text, font: `800 17px ${theme.font}` }}>{lesson.title}</div>
        {lesson.subtitle && (
          <div style={{ color: theme.textFaint, font: `700 12px ${theme.font}` }}>{lesson.subtitle}</div>
        )}
      </div>

      {/* The canvas card. minHeight:0 lets it shrink instead of shoving the
          footer off-screen; the Scene letterboxes inside it. */}
      <main style={{ flex: 1, minHeight: 0, position: 'relative', padding: '4px 14px 8px' }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 18,
            border: `2px solid ${theme.border}`,
            boxShadow: `0 2px 0 ${theme.border}`,
            background: theme.bg,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <Scene lesson={lesson} visible={canvas.visible} focus={canvas.focus} />

          {/* Class not started / finished: one clear action, centre-stage. */}
          {notStarted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(255,255,255,0.72)',
              }}
            >
              <button
                onClick={startClass}
                style={{
                  ...chunky(theme.green, theme.greenDark),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '16px 30px',
                  fontSize: 16,
                }}
              >
                {player.state === 'ended' ? <ReplayIcon /> : <PlayIcon />}
                {player.state === 'ended' ? 'Watch again' : canResume ? 'Resume class' : 'Start class'}
              </button>
            </div>
          )}

          <div style={{ position: 'absolute', right: 12, bottom: 12 }}>
            <Avatar mode={avatarMode} />
          </div>
        </div>
      </main>

      {/* Captions — what she's saying right now */}
      <div style={{ minHeight: 52, padding: '2px 22px 6px', display: 'grid', placeItems: 'center' }}>
        {caption && (
          <div
            style={{
              maxWidth: '62ch',
              textAlign: 'center',
              color: theme.textMuted,
              font: `700 15px/1.5 ${theme.font}`,
            }}
          >
            {caption}
          </div>
        )}
      </div>

      {/* Footer: actions while teaching, doubt sheet while live. */}
      {!inDoubt ? (
        <Controls
          playing={player.state === 'playing'}
          canRaiseHand={player.state === 'playing' || player.state === 'paused'}
          onPlayPause={() => (player.state === 'playing' ? player.pause() : player.play())}
          onRaiseHand={raiseHand}
        />
      ) : (
        <DoubtPanel
          state={handoffState}
          lines={agentLines}
          onSend={(text) => handoff.sendUserText(text)}
          onEnd={() => handoff.endDoubt()}
        />
      )}
    </div>
  );
}
