import { useEffect, useRef, useState } from 'react';
import { level, progress } from './avatarBus';
import { sampleViseme, visemeTimeline, type Viseme, type VisemeStep } from './visemes';
import { createBlinker, swayAt } from './microMotion';
import { MEERA_RIG, mouthShapeOf, scaledAbout, type Rect } from './rig';

/**
 * THE PHOTOREAL TUTOR — one photograph, alive.
 *
 * The architecture Aarav approved, three layers, all local:
 *   A. lipsync + expression: the mouth strip, jaw slab and eyelids of the
 *      photo are warped per frame from the line being spoken (shape) and the
 *      live loudness (drive). No neural net per frame — a Vega 6 laptop and
 *      a Mali phone both do this at 60fps, which is the whole point.
 *   B. gestures: whole-body pose photographs of the same teacher,
 *      cross-faded under the face in ~160ms when the pose prop changes.
 *   C. micro-movements: blinks on a human clock, breathing sway, loudness
 *      nods — the idle loop that keeps a photo from being a corpse.
 *
 * The photo assets live in content/avatar/ (the public dir). A pose whose
 * file is missing falls back to the base photo, and until the base photo
 * itself arrives the canvas stays transparent — whatever sits behind it in
 * the tile (the old initial) remains the face of the class.
 */

export type AvatarPose = 'idle' | 'point' | 'explain' | 'greet' | 'think' | 'listen' | 'cheer';

const POSE_FILE: Record<AvatarPose, string> = {
  idle: '/avatar/meera.png',
  point: '/avatar/meera-point.png',
  explain: '/avatar/meera-explain.png',
  greet: '/avatar/meera-greet.png',
  think: '/avatar/meera-think.png',
  listen: '/avatar/meera-listen.png',
  cheer: '/avatar/meera-cheer.png',
};

/** Loaded once per session, shared by every tile. */
const cache = new Map<AvatarPose, HTMLImageElement | 'failed'>();
const poseImage = (pose: AvatarPose): HTMLImageElement | null => {
  const hit = cache.get(pose);
  if (hit === 'failed') return pose === 'idle' ? null : poseImage('idle');
  if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
  const img = new Image();
  img.onerror = () => {
    cache.set(pose, 'failed');
  };
  img.src = POSE_FILE[pose];
  cache.set(pose, img);
  return null;
};

export function PhotoAvatar({
  pose,
  className,
  debugRig = false,
}: {
  pose: AvatarPose;
  className?: string;
  /** The avatar lab draws the rig's boxes over the photo for calibration. */
  debugRig?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const poseRef = useRef(pose);
  poseRef.current = pose;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const blinker = createBlinker();
    const born = performance.now();
    let raf = 0;
    // The line's shapes, computed once per line rather than once per frame.
    let lineCache: { text: string; steps: VisemeStep[] } = { text: '', steps: [] };
    // The crossfade: what was showing, what is showing, when it changed.
    let shown: AvatarPose = 'idle';
    let prev: AvatarPose | null = null;
    let fadeStart = 0;

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);

      const img = poseImage(poseRef.current);
      const base = img ?? poseImage('idle');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!base) return; // photo not here yet — the tile behind is the face
      if (!ready) setReady(true);

      if (poseRef.current !== shown && img) {
        prev = shown;
        shown = poseRef.current;
        fadeStart = now;
      }
      const fade = Math.min(1, (now - fadeStart) / 160);
      if (fade >= 1) prev = null;

      // Cover the tile with the (square) photo, remembering the mapping so
      // the rig's fractions can reach pixel space in both directions.
      const scale = Math.max(w / base.naturalWidth, h / base.naturalHeight);
      const dx = (w - base.naturalWidth * scale) / 2;
      const dy = (h - base.naturalHeight * scale) / 2;
      const px = (r: Rect) => ({
        x: dx + r.x * base.naturalWidth * scale,
        y: dy + r.y * base.naturalHeight * scale,
        w: r.w * base.naturalWidth * scale,
        h: r.h * base.naturalHeight * scale,
      });
      const src = (r: Rect) => ({
        x: r.x * base.naturalWidth,
        y: r.y * base.naturalHeight,
        w: r.w * base.naturalWidth,
        h: r.h * base.naturalHeight,
      });

      // What is being said, and how loudly, this exact frame.
      const p = progress();
      if (p.text !== lineCache.text) lineCache = { text: p.text, steps: visemeTimeline(p.text) };
      const v: Viseme =
        p.text === ''
          ? 'rest'
          : sampleViseme(lineCache.steps, p.elapsedMs, p.durationMs ?? undefined);
      const heard = level();
      // An untappable voice (the recorded take) drives shape-only.
      const drive = heard ?? (p.text === '' ? 0 : v === 'rest' ? 0.15 : 0.55);
      const shape = mouthShapeOf(v, drive);

      // Layer C's whole-head motion wraps everything drawn after it.
      const sway = swayAt(now - born, drive);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate((sway.rotDeg * Math.PI) / 180);
      ctx.translate(-w / 2 + (sway.dx * w) / 512, -h / 2 + (sway.dy * h) / 512);

      const paint = (image: HTMLImageElement, alpha: number): void => {
        ctx.globalAlpha = alpha;
        ctx.drawImage(image, dx, dy, image.naturalWidth * scale, image.naturalHeight * scale);
        ctx.globalAlpha = 1;
      };
      const prevImg = prev ? poseImage(prev) : null;
      if (prevImg) paint(prevImg, 1);
      paint(base, prevImg ? fade : 1);

      // --- Layer A: the face, warped -------------------------------------
      const rig = MEERA_RIG;
      const drop = shape.open * rig.jawDrop * base.naturalHeight * scale;

      // The dark of the open mouth, behind the lips.
      if (shape.open > 0.04) {
        const m = px(rig.innerMouth);
        ctx.fillStyle = '#33161a';
        ctx.beginPath();
        ctx.ellipse(
          m.x + m.w / 2,
          m.y + m.h / 2 + drop * 0.5,
          (m.w / 2) * (0.55 + 0.45 * shape.open),
          (m.h / 2) * (0.25 + 0.95 * shape.open),
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // The jaw slab slides down and stretches a hair.
      {
        const s = src(rig.jaw);
        const d = px(rig.jaw);
        ctx.drawImage(base, s.x, s.y, s.w, s.h, d.x, d.y + drop, d.w, d.h * (1 + shape.open * 0.06));
      }

      // The lips themselves: reshaped per viseme, riding half the jaw drop.
      {
        const s = src(rig.mouth);
        const d = scaledAbout(px(rig.mouth), shape.stretchX, shape.stretchY);
        ctx.drawImage(base, s.x, s.y, s.w, s.h, d.x, d.y + drop * 0.55, d.w, d.h);
      }

      // --- Layer C: the blink --------------------------------------------
      const open01 = blinker.opennessAt(now - born);
      if (open01 < 0.98) {
        for (const eye of [rig.eyeL, rig.eyeR]) {
          const s = src({ ...eye, y: eye.y - eye.h * 1.35, h: eye.h * 1.1 });
          const d = px(eye);
          const lid = d.h * (1 - open01);
          if (lid > 0.5) ctx.drawImage(base, s.x, s.y, s.w, s.h, d.x, d.y - 1, d.w, lid + 1);
        }
      }

      if (debugRig) {
        ctx.strokeStyle = 'rgba(0,255,120,0.9)';
        ctx.lineWidth = 1;
        for (const r of [rig.mouth, rig.innerMouth, rig.jaw, rig.eyeL, rig.eyeR]) {
          const d = px(r);
          ctx.strokeRect(d.x, d.y, d.w, d.h);
        }
      }
      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // The loop reads pose and rig through refs; only the debug flag re-arms it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugRig]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ opacity: ready ? 1 : 0, transition: 'opacity 300ms' }}
    />
  );
}

/**
 * Which pose fits the room's mood, with a slow explain/point/idle rotation
 * while she teaches so the body never freezes for minutes.
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
