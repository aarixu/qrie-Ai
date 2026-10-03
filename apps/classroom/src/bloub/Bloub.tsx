import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { BotEngine, type BotFrame } from './engine/engine';
import { NOTIF_BLUE } from './engine/decor';
import { DEMI_VIEWBOX, RAYON } from './engine/repere';
import { mixHex } from './engine/skins';
import type { StateId } from './engine/states';
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
 * she is thinking — and the whole shape breathes with the loudness of that
 * voice (avatarBus `level`), so it reads as her talking.
 */
export type BloubMode = 'idle' | 'teaching' | 'listening' | 'thinking';

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
}: {
  mode: BloubMode;
  size?: number;
  ink?: string;
  paper?: string;
  label?: string;
  /** Whether her voice is playing right now; read every frame. */
  talking?: () => boolean;
}): ReactElement {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const maskId = `bloub-mask-${uid}`;
  const engine = useRef<BotEngine | null>(null);
  if (engine.current === null) engine.current = new BotEngine(RAYON, POSE[mode]);
  const clock = useRef(0);
  const [frame, setFrame] = useState<BotFrame>(() => engine.current!.sample(0));
  /** How much she is breathing out right now, smoothed. */
  const [pulse, setPulse] = useState(1);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const talkingRef = useRef(talking);
  talkingRef.current = talking;
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
    let breath = 1;
    const tick = (ms: number): void => {
      raf = requestAnimationFrame(tick);
      // A delta held short, so a tab hidden and shown again does not jump.
      const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0;
      last = ms;
      clock.current += dt;
      const now = modeRef.current;
      const voiced = talkingRef.current ? talkingRef.current() : now === 'teaching';
      show(voiced && now !== 'thinking' ? 'idle' : POSE[now]);
      setFrame(engine.current!.sample(clock.current));
      const loud = voiced ? (level() ?? 0) : 0;
      breath += (1 + loud * 0.12 - breath) * 0.25;
      setPulse(breath);
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
      <g transform={`scale(${pulse})`}>
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
