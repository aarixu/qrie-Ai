import { useEffect, useRef, useState } from 'react';
import { level, progress } from './avatarBus';
import { sampleViseme, visemeTimeline, type Viseme, type VisemeStep } from './visemes';
import { createBlinker, swayAt } from './microMotion';

/**
 * THE PENGUIN — Aarav's mascot, drawn to his reference, and able to ACT.
 *
 * The look is his generated reference art (2026-09-01): chubby navy penguin,
 * huge eyes with a double shine, big round RED glasses with a low bridge,
 * two feather tufts on top, pink blush, chunky teal scarf with a fringed
 * tail, orange beak and feet, dark outline on everything — sticker style.
 *
 * The engine underneath never changed through photo → human cartoon →
 * penguin: the same bus, viseme timeline, blink clock and sway. Here a
 * viseme is a whole different BEAK, a blink squashes the eyes flat behind
 * the glasses, a question lifts the brows, and a gesture is his own
 * flipper — nothing can glitch, there is one character and no assets.
 *
 * Rendering is imperative: one rAF loop pokes SVG attributes through refs.
 * React draws the penguin once; sixty reconciler passes a second would melt
 * a budget phone for nothing. A Rive artist can replace this file later
 * behind the same props.
 */

export type AvatarPose = 'idle' | 'point' | 'explain' | 'greet' | 'think' | 'listen' | 'cheer';

const BODY = '#26314f';
const OUTLINE = '#1b2440';
const BELLY = '#fdf8ec';
const BEAK = '#f8a71b';
const BEAK_DARK = '#e5860a';
const MOUTH_DARK = '#7a2e12';
const TONGUE = '#f2705b';
const FRAME = '#e8402a';
const SCARF = '#2ba9ad';
const SCARF_DARK = '#1d8489';
const BLUSH = '#f5b5c0';

const POSES: AvatarPose[] = ['idle', 'point', 'explain', 'greet', 'think', 'listen', 'cheer'];

/** A flipper: a fat round-capped stroke, outlined like everything else. */
function Flipper({ d }: { d: string }) {
  return (
    <>
      <path d={d} stroke={OUTLINE} strokeWidth="33" fill="none" strokeLinecap="round" />
      <path d={d} stroke={BODY} strokeWidth="26" fill="none" strokeLinecap="round" />
    </>
  );
}

export function CartoonAvatar({ pose, className }: { pose: AvatarPose; className?: string }) {
  const faceRef = useRef<SVGGElement | null>(null);
  const bodyRef = useRef<SVGGElement | null>(null);
  const eyesRef = useRef<SVGGElement | null>(null);
  const browsRef = useRef<SVGGElement | null>(null);
  const mouthRefs = useRef<Partial<Record<Viseme, SVGGElement | null>>>({});
  const poseRefs = useRef<Partial<Record<AvatarPose, SVGGElement | null>>>({});
  const poseRef = useRef(pose);
  poseRef.current = pose;

  useEffect(() => {
    const blinker = createBlinker();
    const born = performance.now();
    let raf = 0;
    let lineCache: { text: string; steps: VisemeStep[] } = { text: '', steps: [] };
    let shownMouth: Viseme | null = null;
    let shownPose: AvatarPose | null = null;

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      const t = now - born;

      // What he is saying, and how loudly, this frame.
      const p = progress();
      if (p.text !== lineCache.text) lineCache = { text: p.text, steps: visemeTimeline(p.text) };
      const v: Viseme =
        p.text === ''
          ? 'rest'
          : sampleViseme(lineCache.steps, p.elapsedMs, p.durationMs ?? undefined);
      const heard = level();
      const drive = heard ?? (p.text === '' ? 0 : v === 'rest' ? 0.15 : 0.6);

      // The beak: a different drawing per viseme, snapped like a cartoon.
      if (v !== shownMouth) {
        for (const key of Object.keys(mouthRefs.current) as Viseme[]) {
          const g = mouthRefs.current[key];
          if (g) g.setAttribute('display', key === v ? 'inline' : 'none');
        }
        shownMouth = v;
      }

      // The face bobs: breathing at rest, nodding with his voice.
      const sway = swayAt(t, drive);
      faceRef.current?.setAttribute(
        'transform',
        `translate(${sway.dx.toFixed(2)} ${(sway.dy * 1.2).toFixed(2)}) rotate(${(sway.rotDeg * 1.8).toFixed(2)} 160 160)`,
      );
      // The body breathes a little too, out of phase.
      bodyRef.current?.setAttribute(
        'transform',
        `translate(0 ${(Math.sin(t / 1900) * 1.8).toFixed(2)})`,
      );

      // The blink: both eyes squash flat behind the glasses.
      const open = Math.max(0.06, blinker.opennessAt(t));
      eyesRef.current?.setAttribute(
        'transform',
        `translate(0 ${(150 * (1 - open)).toFixed(2)}) scale(1 ${open.toFixed(3)})`,
      );

      // The brows: up while he is asking something.
      const asking = p.text.includes('?');
      browsRef.current?.setAttribute('transform', asking ? 'translate(0 -7)' : 'translate(0 0)');

      // The gesture: fade between flipper sets (CSS transitions the opacity).
      if (poseRef.current !== shownPose) {
        for (const key of POSES) {
          const g = poseRefs.current[key];
          if (g) g.style.opacity = key === poseRef.current ? '1' : '0';
        }
        shownPose = poseRef.current;
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const mouth = (key: Viseme) => (el: SVGGElement | null) => {
    mouthRefs.current[key] = el;
  };
  const arm = (key: AvatarPose) => (el: SVGGElement | null) => {
    poseRefs.current[key] = el;
  };
  const poseStyle = (key: AvatarPose) => ({
    opacity: key === 'idle' ? 1 : 0,
    transition: 'opacity 250ms ease',
  });

  return (
    <svg viewBox="0 0 320 380" className={className} aria-hidden preserveAspectRatio="xMidYMid slice">
      <g ref={bodyRef}>
        {/* feet, with split toes */}
        <g stroke={OUTLINE} strokeWidth="4" fill={BEAK}>
          <ellipse cx="120" cy="360" rx="27" ry="12" />
          <ellipse cx="200" cy="360" rx="27" ry="12" />
          <path d="M110 352 L110 366 M122 350 L122 368" fill="none" strokeWidth="3" />
          <path d="M198 350 L198 368 M210 352 L210 366" fill="none" strokeWidth="3" />
        </g>
        {/* the tufts on top */}
        <path d="M150 66 Q146 44 158 38 Q160 54 166 62 Z" fill={BODY} stroke={OUTLINE} strokeWidth="4" />
        <path d="M168 64 Q174 46 186 44 Q178 58 176 68 Z" fill={BODY} stroke={OUTLINE} strokeWidth="4" />
        {/* the egg */}
        <ellipse cx="160" cy="224" rx="112" ry="146" fill={BODY} stroke={OUTLINE} strokeWidth="6" />
        {/* belly */}
        <ellipse cx="160" cy="282" rx="80" ry="86" fill={BELLY} />

        {/* ------------- flipper sets, one per pose ------------- */}
        <g ref={arm('idle')} style={poseStyle('idle')}>
          <Flipper d="M70 230 Q50 284 66 324" />
          <Flipper d="M250 230 Q270 284 254 324" />
        </g>
        {/* point: a flipper straight out toward the board */}
        <g ref={arm('point')} style={poseStyle('point')}>
          <Flipper d="M88 240 Q54 224 24 204" />
          <Flipper d="M250 230 Q270 284 254 324" />
        </g>
        {/* explain: both flippers out, mid-sentence */}
        <g ref={arm('explain')} style={poseStyle('explain')}>
          <Flipper d="M84 246 Q52 276 40 308" />
          <Flipper d="M236 246 Q268 276 280 308" />
        </g>
        {/* greet: one flipper up, waving */}
        <g ref={arm('greet')} style={poseStyle('greet')}>
          <Flipper d="M90 238 Q62 196 52 150" />
          <Flipper d="M250 230 Q270 284 254 324" />
          <path d="M26 148 Q34 136 48 130 M32 164 Q22 156 20 144" stroke={OUTLINE} strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
        {/* think: flipper tip to the chin */}
        <g ref={arm('think')} style={poseStyle('think')}>
          <Flipper d="M70 230 Q50 284 66 324" />
          <Flipper d="M238 248 Q220 226 194 214" />
        </g>
        {/* listen: flippers folded on the belly */}
        <g ref={arm('listen')} style={poseStyle('listen')}>
          <Flipper d="M82 246 Q100 294 144 306" />
          <Flipper d="M238 246 Q220 294 176 306" />
        </g>
        {/* cheer: a flipper thrown up */}
        <g ref={arm('cheer')} style={poseStyle('cheer')}>
          <Flipper d="M70 230 Q50 284 66 324" />
          <Flipper d="M232 240 Q256 194 254 150" />
          <path d="M240 134 Q248 124 260 122" stroke={OUTLINE} strokeWidth="9" fill="none" strokeLinecap="round" />
        </g>

        {/* the scarf, chunky, with its fringed tail — over the flippers */}
        <path
          d="M84 238 Q160 274 236 238 L232 268 Q160 300 88 268 Z"
          fill={SCARF}
          stroke={OUTLINE}
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path d="M196 262 L206 330 L172 326 L174 268 Z" fill={SCARF} stroke={OUTLINE} strokeWidth="5" strokeLinejoin="round" />
        <path d="M176 326 L176 340 M187 328 L187 342 M199 328 L199 340" stroke={SCARF_DARK} strokeWidth="8" strokeLinecap="round" fill="none" />
        <path d="M100 252 Q160 280 222 250" stroke={SCARF_DARK} strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>

      {/* ------------- the face ------------- */}
      <g ref={faceRef}>
        {/* the white face patch, up under the hood */}
        <ellipse cx="160" cy="170" rx="78" ry="74" fill={BELLY} />
        {/* brows: thick, expressive */}
        <g ref={browsRef} style={{ transition: 'transform 160ms ease' }}>
          <path d="M102 114 Q124 102 144 110" stroke={OUTLINE} strokeWidth="9" fill="none" strokeLinecap="round" />
          <path d="M176 110 Q196 102 218 114" stroke={OUTLINE} strokeWidth="9" fill="none" strokeLinecap="round" />
        </g>
        {/* eyes, huge, behind the glasses (the group squashes to blink) */}
        <g ref={eyesRef}>
          <ellipse cx="124" cy="150" rx="27" ry="31" fill="#fff" stroke={OUTLINE} strokeWidth="4" />
          <ellipse cx="196" cy="150" rx="27" ry="31" fill="#fff" stroke={OUTLINE} strokeWidth="4" />
          <circle cx="131" cy="154" r="13" fill={OUTLINE} />
          <circle cx="189" cy="154" r="13" fill={OUTLINE} />
          <circle cx="135" cy="149" r="4.6" fill="#fff" />
          <circle cx="193" cy="149" r="4.6" fill="#fff" />
          <circle cx="128" cy="159" r="2" fill="#fff" />
          <circle cx="186" cy="159" r="2" fill="#fff" />
        </g>
        {/* blush */}
        <circle cx="100" cy="192" r="10" fill={BLUSH} />
        <circle cx="220" cy="192" r="10" fill={BLUSH} />
        {/* THE GLASSES: big, round, red, low bridge */}
        <circle cx="124" cy="150" r="38" fill="none" stroke={FRAME} strokeWidth="10" />
        <circle cx="196" cy="150" r="38" fill="none" stroke={FRAME} strokeWidth="10" />
        <path d="M156 164 Q160 158 164 164" stroke={FRAME} strokeWidth="9" fill="none" strokeLinecap="round" />
        <path d="M86 144 L64 134" stroke={FRAME} strokeWidth="9" strokeLinecap="round" />
        <path d="M234 144 L256 134" stroke={FRAME} strokeWidth="9" strokeLinecap="round" />

        {/* ------------- the beak, one drawing per viseme ------------- */}
        <g ref={mouth('rest')}>
          <path d="M138 182 Q160 168 182 182 Q160 202 138 182 Z" fill={BEAK} stroke={OUTLINE} strokeWidth="4" strokeLinejoin="round" />
          <path d="M148 202 Q160 212 172 202" stroke={BEAK_DARK} strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
        <g ref={mouth('press')} display="none">
          <path d="M140 184 Q160 174 180 184 Q160 198 140 184 Z" fill={BEAK} stroke={OUTLINE} strokeWidth="4" strokeLinejoin="round" />
          <path d="M148 197 L172 197" stroke={BEAK_DARK} strokeWidth="4" strokeLinecap="round" />
        </g>
        <g ref={mouth('open')} display="none">
          <ellipse cx="160" cy="204" rx="18" ry="14" fill={MOUTH_DARK} stroke={OUTLINE} strokeWidth="4" />
          <path d="M150 211 Q160 219 170 211 L170 214 Q160 211 150 214 Z" fill={TONGUE} />
          <path d="M136 182 Q160 168 184 182 Q160 194 136 182 Z" fill={BEAK} stroke={OUTLINE} strokeWidth="4" strokeLinejoin="round" />
        </g>
        <g ref={mouth('wide')} display="none">
          <ellipse cx="160" cy="200" rx="26" ry="11" fill={MOUTH_DARK} stroke={OUTLINE} strokeWidth="4" />
          <path d="M132 184 Q160 172 188 184 Q160 194 132 184 Z" fill={BEAK} stroke={OUTLINE} strokeWidth="4" strokeLinejoin="round" />
        </g>
        <g ref={mouth('round')} display="none">
          <circle cx="160" cy="200" r="11" fill={MOUTH_DARK} stroke={OUTLINE} strokeWidth="4" />
          <path d="M142 184 Q160 172 178 184 Q160 192 142 184 Z" fill={BEAK} stroke={OUTLINE} strokeWidth="4" strokeLinejoin="round" />
        </g>
        <g ref={mouth('teeth')} display="none">
          <ellipse cx="160" cy="200" rx="15" ry="9" fill={MOUTH_DARK} stroke={OUTLINE} strokeWidth="4" />
          <path d="M148 198 Q160 194 172 198 L171 202 Q160 199 149 202 Z" fill="#fff" />
          <path d="M138 183 Q160 170 182 183 Q160 193 138 183 Z" fill={BEAK} stroke={OUTLINE} strokeWidth="4" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Which pose fits the room's mood: while he teaches the flippers rotate
 * idle → explain → point on a slow clock, and an open mic folds them to
 * listen. Safe to run — a cartoon's gesture is his own flipper moving, not
 * a photograph being swapped.
 */
export function usePoseFor(mode: 'idle' | 'teaching' | 'listening'): AvatarPose {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (mode !== 'teaching') return;
    const timer = setInterval(() => setBeat((b) => b + 1), 8000);
    return () => clearInterval(timer);
  }, [mode]);
  if (mode === 'listening') return 'listen';
  if (mode === 'teaching') return beat % 3 === 1 ? 'explain' : beat % 3 === 2 ? 'point' : 'idle';
  return 'idle';
}
