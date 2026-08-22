import { useEffect, useMemo, useRef, useState } from 'react';
import { findBeat, type Lesson } from '@ai-tutor/lesson-format';
import { Scene, computeVisible } from '@ai-tutor/stage';
import { usePlayer, createBrowserTts } from '@ai-tutor/player';
import {
  buildContext,
  createHandoff,
  createStubAgent,
  type HandoffState,
} from '@ai-tutor/doubt-session';
import { Avatar, type AvatarMode } from '../ui/Avatar';
import { Controls } from '../ui/Controls';
import { DoubtPanel } from '../ui/DoubtPanel';
import { theme } from '../ui/theme';

const CONTROLS_HIDE_MS = 3000;

/**
 * The classroom. Wiring only — every decision this screen appears to make is
 * actually made inside a package:
 *   what's on the canvas   → stage (computeVisible / Scene)
 *   when beats advance     → player
 *   the ✋ handoff          → doubt-session
 */
export function ClassRoom({ lesson, onExit }: { lesson: Lesson; onExit(): void }) {
  const tts = useMemo(() => createBrowserTts({ lang: 'en-IN' }), []);
  const player = usePlayer(lesson, tts);

  // Refs so the (stable) handoff always calls the latest player controls.
  const playerRef = useRef(player);
  playerRef.current = player;

  const [handoffState, setHandoffState] = useState<HandoffState>('PLAYING');
  const [agentLines, setAgentLines] = useState<string[]>([]);
  const [recallBeatId, setRecallBeatId] = useState<string | null>(null);

  const handoff = useMemo(
    () =>
      createHandoff({
        agent: createStubAgent(),
        speak: (text) => tts.speak(text),
        onPause: () => playerRef.current.pause(),
        onResume: () => {
          // Recall view ends with the doubt; play() re-speaks the current beat,
          // which doubles as a natural "wapas wahin se" re-anchor.
          setRecallBeatId(null);
          playerRef.current.play();
        },
        onRecall: (beatId) => setRecallBeatId(beatId),
      }),
    [lesson, tts],
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

  // Auto-hiding controls: any touch shows them; silence hides them while playing.
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  };
  useEffect(() => {
    poke();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const caption = inDoubt ? (agentLines.at(-1) ?? '') : player.caption;

  return (
    <div
      onPointerDown={poke}
      onPointerMove={poke}
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
      {/* Topic bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px calc(0px + env(safe-area-inset-top))',
          paddingTop: 'calc(12px + env(safe-area-inset-top))',
        }}
      >
        <button
          onClick={onExit}
          aria-label="back"
          style={{
            border: 'none',
            background: 'none',
            color: theme.textMuted,
            fontSize: 18,
            cursor: 'pointer',
            padding: 4,
          }}
        >
          ←
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: theme.text, font: `600 15px ${theme.font}` }}>{lesson.title}</div>
          {lesson.subtitle && (
            <div style={{ color: theme.textMuted, fontSize: 11 }}>{lesson.subtitle}</div>
          )}
        </div>
        {inDoubt && (
          <span
            style={{
              marginLeft: 'auto',
              color: theme.good,
              font: `600 11px ${theme.font}`,
              border: `1px solid ${theme.good}55`,
              borderRadius: 12,
              padding: '3px 10px',
            }}
          >
            ● LIVE
          </span>
        )}
      </header>

      {/* Canvas + avatar */}
      <main style={{ flex: 1, position: 'relative', display: 'grid', placeItems: 'center', padding: 8 }}>
        <div style={{ width: '100%', maxWidth: 900 }}>
          <Scene lesson={lesson} visible={canvas.visible} focus={canvas.focus} />
        </div>
        <div style={{ position: 'absolute', right: 14, bottom: 10 }}>
          <Avatar mode={avatarMode} />
        </div>
      </main>

      {/* Captions */}
      <div
        style={{
          minHeight: 58,
          padding: '4px 20px 10px',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {caption && (
          <div
            style={{
              maxWidth: '68ch',
              textAlign: 'center',
              color: theme.text,
              font: `15px/1.5 ${theme.font}`,
              opacity: 0.92,
            }}
          >
            {caption}
          </div>
        )}
      </div>

      {/* Bottom layer: controls while teaching, doubt panel while live */}
      <div style={{ position: 'relative', height: inDoubt ? 0 : 76 }}>
        {!inDoubt && (
          <Controls
            visible={controlsVisible || player.state !== 'playing'}
            playing={player.state === 'playing'}
            beatIndex={player.beatIndex}
            beatCount={lesson.beats.length}
            canRaiseHand={player.state === 'playing' || player.state === 'paused'}
            onPlayPause={() =>
              player.state === 'playing' ? player.pause() : player.play()
            }
            onRaiseHand={() => handoff.raiseHand(buildContext(lesson, player.beatIndex))}
          />
        )}
      </div>
      {inDoubt && (
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
