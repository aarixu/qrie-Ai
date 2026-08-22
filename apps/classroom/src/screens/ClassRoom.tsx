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
import { BackIcon, PlayIcon, ReplayIcon } from '../ui/icons';
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

  // Auto-hiding chalk tray: any touch shows it; silence hides it while playing.
  const [trayVisible, setTrayVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = () => {
    setTrayVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setTrayVisible(false), CONTROLS_HIDE_MS);
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
  const notStarted = !inDoubt && (player.state === 'idle' || player.state === 'ended');

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
      {/* Topic bar — chalk heading on the top of the board */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          paddingTop: 'calc(10px + env(safe-area-inset-top))',
        }}
      >
        <button
          onClick={onExit}
          aria-label="back to library"
          style={{
            width: 40,
            height: 40,
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            background: 'none',
            color: theme.chalkDim,
            cursor: 'pointer',
          }}
        >
          <BackIcon />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: theme.chalk, font: `700 17px ${theme.fontChalk}` }}>
            {lesson.title}
          </div>
          {lesson.subtitle && (
            <div style={{ color: theme.chalkDim, font: `12px ${theme.font}` }}>{lesson.subtitle}</div>
          )}
        </div>
        {inDoubt && (
          <span
            style={{
              marginLeft: 'auto',
              color: theme.good,
              font: `600 11.5px ${theme.font}`,
              letterSpacing: 0.6,
              border: `1.5px solid ${theme.good}66`,
              borderRadius: 14,
              padding: '3px 11px',
            }}
          >
            LIVE
          </span>
        )}
      </header>

      {/* The board: wooden frame, green slate, chalk canvas. minHeight:0 is what
          lets the board shrink instead of shoving the chalk tray off-screen. */}
      <main style={{ flex: 1, minHeight: 0, position: 'relative', padding: '4px 12px 10px' }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 14,
            padding: 7,
            background: theme.woodGrad,
            boxShadow: 'inset 0 1px 0 rgba(255,220,180,0.25), 0 10px 30px rgba(0,0,0,0.5)',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 9,
              background: theme.board,
              boxShadow: 'inset 0 0 60px rgba(0,0,0,0.55)',
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <Scene lesson={lesson} visible={canvas.visible} focus={canvas.focus} />

            {/* Class not started / finished: one clear chalk action, centre-board. */}
            {notStarted && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'rgba(9,14,11,0.45)',
                }}
              >
                <button
                  onClick={() => player.play()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '14px 26px',
                    borderRadius: 30,
                    border: 'none',
                    background: theme.accent,
                    color: theme.accentInk,
                    font: `700 17px ${theme.font}`,
                    cursor: 'pointer',
                    boxShadow: `0 4px 0 #b98f22, 0 10px 30px ${theme.accent}44`,
                  }}
                >
                  {player.state === 'ended' ? <ReplayIcon /> : <PlayIcon />}
                  {player.state === 'ended' ? 'Watch again' : 'Start class'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ position: 'absolute', right: 24, bottom: 22 }}>
          <Avatar mode={avatarMode} />
        </div>
      </main>

      {/* Captions — what she's saying, in her handwriting */}
      <div style={{ minHeight: 56, padding: '2px 20px 8px', display: 'grid', placeItems: 'center' }}>
        {caption && (
          <div
            style={{
              maxWidth: '64ch',
              textAlign: 'center',
              color: theme.chalk,
              font: `400 16px/1.5 ${theme.fontChalk}`,
              opacity: 0.94,
            }}
          >
            {caption}
          </div>
        )}
      </div>

      {/* Bottom: chalk tray while teaching, doubt slate while live. The tray is
          an overlay, never in flow — it can never be pushed off-screen. */}
      <div style={{ height: 70 }} />
      {!inDoubt && (
        <Controls
          visible={trayVisible || player.state !== 'playing'}
          playing={player.state === 'playing'}
          beatIndex={player.beatIndex}
          beatCount={lesson.beats.length}
          canRaiseHand={player.state === 'playing' || player.state === 'paused'}
          onPlayPause={() => (player.state === 'playing' ? player.pause() : player.play())}
          onRaiseHand={() => handoff.raiseHand(buildContext(lesson, player.beatIndex))}
        />
      )}
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
