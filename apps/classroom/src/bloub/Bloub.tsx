import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { BotEngine, type BotFrame } from './engine/engine';
import { NOTIF_BLUE } from './engine/decor';
import { DEMI_VIEWBOX, RAYON } from './engine/repere';
import { mixHex } from './engine/skins';
import { STATE_BY_ID, type StateId } from './engine/states';
import { TUTOR } from '@ai-tutor/persona';
import { level } from '../avatar/avatarBus';

/**
 * HER PRESENCE, AS A LIVING SHAPE (Aarav, 2026-10-03: "avatar looks weird for
 * now" — the board takes the class's screen, and this stands in for her; the
 * same day, "sirf bloub ka use karo": it is her picture on the trial, enrol
 * and sign-in screens too, and the avatar is switched off, not deleted —
 * src/avatar/README.md).
 *
 * The shape and its motion are bloub's engine (src/bloub/engine, MIT, Jérémy
 * Perret, github.com/jeremy-prt/bloub at b4bb3c1 — see src/bloub/LICENSE): one
 * filled shape that morphs between poses, with eyes cut into it. bloub
 * recreates another company's bot avatar, so it is NOT drawn as that one: its
 * body is Qrie's amber, never the original's black on white. In the class it
 * stands on the dark stage; on the other screens, on the page's own colour.
 *
 * What she is doing picks the pose:
 *   teaching   her resting face;
 *   listening  eyes wide, waiting for the student;
 *   thinking   the engine's own thinking pose (a judge, a doubt reply);
 *   idle       her resting face.
 * And while her voice is actually playing (`talking`, or, without it, while
 * the mode is teaching) she wears the resting face whatever the mode — unless
 * she is thinking — and the shape stretches and bobs with the loudness of that
 * voice (avatarBus `level`), so it reads as her talking. Quiet, she breathes.
 *
 * MOMENTS, NOT ONE LOOP (Aarav, 2026-10-03: "bloub ko animation do alag
 * alag"). A `cue` plays one of the engine's own animations once, over
 * whatever the mode shows, then she returns to it — the class asks for one at
 * its moments (ClassRoom `cueBloub`): a right answer bursts, a hand raised
 * gets the "!", a doubt over swirls. And while she teaches or waits, every
 * AMBIENT_MS or so she winks or tilts on her own, so she is never a still dot.
 */
export type BloubMode = 'idle' | 'teaching' | 'listening' | 'thinking';

/** The engine's animations a moment of the class may ask for. */
export type BloubCue = 'play' | 'burst' | 'orbit' | 'alert' | 'exclaim' | 'swirl' | 'egg' | 'wink' | 'comet';

/** How long a cue holds: the engine's own length for it, never cut before it lands. */
const cueSeconds = (cue: StateId): number => {
  const def = STATE_BY_ID.get(cue);
  return def ? Math.max(def.duration, def.minDuration ?? 0) : 1.5;
};

/** Seconds between her small flourishes while she teaches or waits, give or take. */
const AMBIENT_MIN = 8;
const AMBIENT_SPREAD = 6;
/** What she does on her own: mostly a wink, sometimes a curious tilt. */
const AMBIENT: readonly StateId[] = ['wink', 'wink', 'egg'];

const POSE: Record<BloubMode, StateId> = {
  idle: 'idle',
  teaching: 'idle',
  listening: 'wide',
  thinking: 'thinking',
};

/**
 * Qrie's amber (tailwind `stage-primary`), and the class stage's colour
 * (tailwind `stage`), which fills her eyes wherever she is drawn: holes in the
 * class, dark eyes on a light page.
 */
export const BLOUB_INK = '#f3b84d';
export const BLOUB_PAPER = '#1c1a17';

const VB = DEMI_VIEWBOX;

export function Bloub({
  mode,
  size = 96,
  ink = BLOUB_INK,
  paper = BLOUB_PAPER,
  label = TUTOR.name,
  talking,
  cue = null,
  ambient = true,
}: {
  mode: BloubMode;
  size?: number;
  ink?: string;
  paper?: string;
  label?: string;
  /** Whether her voice is playing right now; read every frame. */
  talking?: () => boolean;
  /** One animation to play now; a new `at` plays it again. */
  cue?: { state: BloubCue; at: number } | null;
  /** Her own small flourishes while she teaches or waits (off on a page that should stay still). */
  ambient?: boolean;
}): ReactElement {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const maskId = `bloub-mask-${uid}`;
  const engine = useRef<BotEngine | null>(null);
  if (engine.current === null) engine.current = new BotEngine(RAYON, POSE[mode]);
  const clock = useRef(0);
  const [frame, setFrame] = useState<BotFrame>(() => engine.current!.sample(0));
  /** Her body's stretch and lift right now: the voice's loudness, or her breathing. */
  const [body, setBody] = useState({ sx: 1, sy: 1, lift: 0 });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const talkingRef = useRef(talking);
  talkingRef.current = talking;
  const cueRef = useRef(cue);
  cueRef.current = cue;
  const ambientRef = useRef(ambient);
  ambientRef.current = ambient;
  /** The pose the engine was last told, so it is only told again on a change. */
  const shown = useRef<StateId>(POSE[mode]);
  const show = (pose: StateId): void => {
    if (pose === shown.current) return;
    shown.current = pose;
    engine.current!.setState(pose, clock.current);
  };

  useEffect(() => {
    show(POSE[mode]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    // jsdom and a few old WebViews have no animation frame: one still frame then.
    if (typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    let last = 0;
    let loudness = 0;
    /** The cue being played, and until when; the last cue's `at`, so each plays once. */
    let playing: StateId | null = null;
    let playingUntil = 0;
    let playedAt: number | null = null;
    let nextFlourish = AMBIENT_MIN + Math.random() * AMBIENT_SPREAD;
    const tick = (ms: number): void => {
      raf = requestAnimationFrame(tick);
      // A delta held short, so a tab hidden and shown again does not jump.
      const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0;
      last = ms;
      const t = (clock.current += dt);
      const now = modeRef.current;
      const voiced = talkingRef.current ? talkingRef.current() : now === 'teaching';

      // A moment the class asked for, once.
      const asked = cueRef.current;
      if (asked && asked.at !== playedAt) {
        playedAt = asked.at;
        playing = asked.state;
        playingUntil = t + cueSeconds(asked.state);
      }
      // Her own flourish, now and then, while she teaches or waits — never
      // over a cue, a listen or a think.
      if (!playing && ambientRef.current && (now === 'teaching' || now === 'idle') && t >= nextFlourish) {
        playing = AMBIENT[Math.floor(Math.random() * AMBIENT.length)];
        playingUntil = t + cueSeconds(playing);
        nextFlourish = playingUntil + AMBIENT_MIN + Math.random() * AMBIENT_SPREAD;
      }
      if (playing && t >= playingUntil) playing = null;

      show(playing ?? (voiced && now !== 'thinking' ? 'idle' : POSE[now]));
      setFrame(engine.current!.sample(t));

      // Talking, she stretches up and lifts with her voice; quiet, she breathes.
      loudness += ((voiced ? (level() ?? 0) : 0) - loudness) * 0.3;
      const breathe = Math.sin(t * ((2 * Math.PI) / 3.2));
      setBody({
        sx: 1 + loudness * 0.05 - breathe * 0.008,
        sy: 1 + loudness * 0.16 + breathe * 0.015,
        lift: -loudness * 10 - breathe * 1.5,
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const dotAttrs = (dot: BotFrame['dots'][number]) => {
    const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
    return dot.d
      ? { fill, opacity: dot.opacity, d: dot.d, transform: `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})` }
      : { fill, opacity: dot.opacity, cx: dot.x, cy: dot.y, r: dot.r };
  };
  const dots = frame.dots.map((dot, i) =>
    dot.d ? <path key={i} {...(dotAttrs(dot) as object)} /> : <circle key={i} {...(dotAttrs(dot) as object)} />,
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      role="img"
      aria-label={`${label} ${mode}`}
      data-bloub={mode}
      data-bloub-cue={cue?.state}
    >
      <defs>
        {/* The eyes are holes cut in the body, so they are trimmed by its edge. */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch && <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((c, i) => (
              <stop key={i} offset={i / Math.max(1, arc.grad.stops.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        ))}
      </defs>
      <g transform={`translate(0 ${body.lift}) scale(${body.sx} ${body.sy})`}>
        <g fill="none" strokeLinecap="round">
          {frame.arcs.map((arc) => (
            <path key={`b${arc.id}`} d={arc.back} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />
          ))}
        </g>
        {frame.dotsBehind && <g>{dots}</g>}
        <g opacity={frame.bodyAlpha}>
          <path d={frame.bodyPath} fill={paper} />
          <g mask={`url(#${maskId})`}>
            <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
          </g>
        </g>
        {!frame.dotsBehind && <g>{dots}</g>}
        {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />}
        <g fill="none" strokeLinecap="round">
          {frame.arcs.map((arc) => (
            <path key={`f${arc.id}`} d={arc.front} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />
          ))}
        </g>
      </g>
    </svg>
  );
}
