import { useEffect, useRef, useState } from 'react';
import { level, progress } from './avatarBus';
import { sampleViseme, visemeTimeline, type Viseme, type VisemeStep } from './visemes';
import { createBlinker, swayAt } from './microMotion';

/**
 * THE PENGUIN — Aarav's mascot, and the avatar that ACTUALLY shows everything.
 *
 * His words: a cartoon penguin in big round funny glasses. The Duolingo move
 * — a mascot, not a person — and the right one after the photo experiment:
 * a photograph can only be nudged before it breaks, a drawn character can
 * ACT. The engine underneath did not change at all: the same bus, viseme
 * timeline, blink clock and sway that drove the photo drive this — but here
 * a viseme is a whole different BEAK, a blink squashes the eyes flat behind
 * the glasses, a gesture is his own flipper, and nothing can glitch because
 * there is one character, drawn in code, no assets to mis-register.
 *
 * When Aarav's generated reference art lands, this drawing restyles to
 * match it — colours and shapes, same refs, same loop. A Rive artist can
 * replace the whole file later behind the same props.
 *
 * Rendering is imperative: one rAF loop pokes SVG attributes through refs.
 * React draws the penguin once; sixty reconciler passes a second would melt
 * a budget phone for nothing.
 */

export type AvatarPose = 'idle' | 'point' | 'explain' | 'greet' | 'think' | 'listen' | 'cheer';

const BODY = '#23303f';
const BODY_DARK = '#18222e';
const BELLY = '#f7f2e7';
const BEAK = '#f5a623';
const BEAK_DARK = '#d98c12';
const MOUTH_DARK = '#5d2626';
const FRAME = '#e2574c';
const SCARF = '#177e89';
const SCARF_DARK = '#10606a';

const POSES: AvatarPose[] = ['idle', 'point', 'explain', 'greet', 'think', 'listen', 'cheer'];

/** A flipper: one fat round-capped stroke. */
function Flipper({ d }: { d: string }) {
  return <path d={d} stroke={BODY_DARK} strokeWidth="27" fill="none" strokeLinecap="round" />;
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

      // The face bobs: breathing at rest, nodding with the voice.
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

      // The brows: feather tufts up while he is asking something.
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
        {/* feet */}
        <ellipse cx="126" cy="362" rx="26" ry="11" fill={BEAK} />
        <ellipse cx="194" cy="362" rx="26" ry="11" fill={BEAK} />
        {/* the egg */}
        <ellipse cx="160" cy="232" rx="112" ry="136" fill={BODY} />
        {/* belly */}
        <ellipse cx="160" cy="266" rx="74" ry="94" fill={BELLY} />

        {/* ------------- flipper sets, one per pose ------------- */}
        <g ref={arm('idle')} style={poseStyle('idle')}>
          <Flipper d="M74 226 Q58 282 76 326" />
          <Flipper d="M246 226 Q262 282 244 326" />
        </g>
        {/* point: a flipper straight out toward the board */}
        <g ref={arm('point')} style={poseStyle('point')}>
          <Flipper d="M92 238 Q56 224 26 206" />
          <Flipper d="M246 226 Q262 282 244 326" />
        </g>
        {/* explain: both flippers out, mid-sentence */}
        <g ref={arm('explain')} style={poseStyle('explain')}>
          <Flipper d="M88 244 Q56 274 44 306" />
          <Flipper d="M232 244 Q264 274 276 306" />
        </g>
        {/* greet: one flipper up, waving */}
        <g ref={arm('greet')} style={poseStyle('greet')}>
          <Flipper d="M94 236 Q66 196 56 152" />
          <Flipper d="M246 226 Q262 282 244 326" />
          <path d="M30 150 Q38 138 52 132 M36 166 Q26 158 24 146" stroke={BODY_DARK} strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
        {/* think: flipper tip to the chin */}
        <g ref={arm('think')} style={poseStyle('think')}>
          <Flipper d="M74 226 Q58 282 76 326" />
          <Flipper d="M234 246 Q216 226 192 214" />
        </g>
        {/* listen: flippers folded on the belly */}
        <g ref={arm('listen')} style={poseStyle('listen')}>
          <Flipper d="M86 244 Q104 292 146 304" />
          <Flipper d="M234 244 Q216 292 174 304" />
        </g>
        {/* cheer: a flipper thrown up */}
        <g ref={arm('cheer')} style={poseStyle('cheer')}>
          <Flipper d="M74 226 Q58 282 76 326" />
          <Flipper d="M228 238 Q252 194 250 152" />
          <path d="M236 136 Q244 126 256 124" stroke={BODY_DARK} strokeWidth="9" fill="none" strokeLinecap="round" />
        </g>

        {/* scarf, over the flippers' shoulders */}
        <path d="M92 236 Q160 268 228 236 L224 258 Q160 288 96 258 Z" fill={SCARF} />
        <path d="M196 252 L210 300 L184 296 L182 258 Z" fill={SCARF_DARK} />
      </g>

      {/* ------------- the face ------------- */}
      <g ref={faceRef}>
        {/* white face patch */}
        <ellipse cx="160" cy="152" rx="78" ry="62" fill={BELLY} />
        {/* brows: little feather tufts */}
        <g ref={browsRef} style={{ transition: 'transform 160ms ease' }}>
          <path d="M104 106 Q122 96 140 102" stroke={BODY_DARK} strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M180 102 Q198 96 216 106" stroke={BODY_DARK} strokeWidth="7" fill="none" strokeLinecap="round" />
        </g>
        {/* eyes behind the glasses (the group squashes to blink) */}
        <g ref={eyesRef}>
          <circle cx="126" cy="150" r="21" fill="#fff" />
          <circle cx="194" cy="150" r="21" fill="#fff" />
          <circle cx="129" cy="152" r="9" fill="#2a1e16" />
          <circle cx="191" cy="152" r="9" fill="#2a1e16" />
          <circle cx="132" cy="148" r="3.2" fill="#fff" />
          <circle cx="194" cy="148" r="3.2" fill="#fff" />
        </g>
        {/* THE GLASSES: big, round, funny */}
        <circle cx="126" cy="150" r="35" fill="none" stroke={FRAME} strokeWidth="9" />
        <circle cx="194" cy="150" r="35" fill="none" stroke={FRAME} strokeWidth="9" />
        <path d="M156 144 Q160 138 164 144" stroke={FRAME} strokeWidth="8" fill="none" strokeLinecap="round" />
        <path d="M91 144 L74 136" stroke={FRAME} strokeWidth="8" strokeLinecap="round" />
        <path d="M229 144 L246 136" stroke={FRAME} strokeWidth="8" strokeLinecap="round" />
        {/* a little shine on each lens */}
        <path d="M106 136 Q112 128 122 126" stroke="#fff" strokeWidth="5" opacity="0.7" fill="none" strokeLinecap="round" />
        <path d="M174 136 Q180 128 190 126" stroke="#fff" strokeWidth="5" opacity="0.7" fill="none" strokeLinecap="round" />
        {/* blush */}
        <ellipse cx="98" cy="184" rx="11" ry="6" fill="#f0917e" opacity="0.55" />
        <ellipse cx="222" cy="184" rx="11" ry="6" fill="#f0917e" opacity="0.55" />

        {/* ------------- the beak, one drawing per viseme ------------- */}
        <g ref={mouth('rest')}>
          <path d="M136 192 Q160 180 184 192 Q160 216 136 192 Z" fill={BEAK} />
          <path d="M142 196 Q160 206 178 196" stroke={BEAK_DARK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </g>
        <g ref={mouth('press')} display="none">
          <path d="M138 194 Q160 186 182 194 Q160 204 138 194 Z" fill={BEAK} />
          <path d="M144 195 L176 195" stroke={BEAK_DARK} strokeWidth="3.5" strokeLinecap="round" />
        </g>
        <g ref={mouth('open')} display="none">
          <ellipse cx="160" cy="200" rx="19" ry="15" fill={MOUTH_DARK} />
          <path d="M136 190 Q160 176 184 190 Q160 198 136 190 Z" fill={BEAK} />
          <path d="M142 210 Q160 226 178 210 Q160 218 142 210 Z" fill={BEAK_DARK} />
          <path d="M150 208 Q160 214 170 208 L170 211 Q160 208 150 211 Z" fill="#c96a5f" />
        </g>
        <g ref={mouth('wide')} display="none">
          <ellipse cx="160" cy="198" rx="26" ry="11" fill={MOUTH_DARK} />
          <path d="M130 190 Q160 180 190 190 Q160 197 130 190 Z" fill={BEAK} />
          <path d="M136 206 Q160 216 184 206 Q160 212 136 206 Z" fill={BEAK_DARK} />
        </g>
        <g ref={mouth('round')} display="none">
          <circle cx="160" cy="198" r="11" fill={MOUTH_DARK} />
          <circle cx="160" cy="198" r="11" fill="none" stroke={BEAK} strokeWidth="6" />
        </g>
        <g ref={mouth('teeth')} display="none">
          <ellipse cx="160" cy="197" rx="16" ry="9" fill={MOUTH_DARK} />
          <path d="M138 190 Q160 182 182 190 Q160 196 138 190 Z" fill={BEAK} />
          <path d="M144 204 Q160 211 176 204 Q160 208 144 204 Z" fill={BEAK_DARK} />
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
