/**
 * THE RIG — where Meera's face is, in her photo.
 *
 * Everything is a FRACTION of the image (0..1, origin top-left), so one rig
 * survives any render size. The warp needs only regions, not landmarks: the
 * mouth strip it reshapes, the jaw slab it drops, the eyes it lids. The
 * numbers are calibrated by hand against the committed photo — the photo is
 * an asset we control, and hand-set regions on a known image beat running a
 * landmark model on every phone for a face that never changes.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AvatarRig {
  /**
   * The crop the TILE shows — head and shoulders, like a call tile. Without
   * it the whole photo cover-fits the tile and Meera shrinks to a figurine;
   * Aarav's first look called it "not adjusted in the box", and he was right.
   */
  frame: Rect;
  /** The mouth strip: lips and their margin, reshaped per viseme. */
  mouth: Rect;
  /** Inner-mouth ellipse centre/size at full open, drawn behind the lips. */
  innerMouth: Rect;
  /** From under the lower lip to under the chin — slides down as the jaw opens. */
  jaw: Rect;
  /** How far the jaw travels at full open, as a fraction of image height. */
  jawDrop: number;
  eyeL: Rect;
  eyeR: Rect;
}

/** How a viseme reshapes the mouth strip. All factors are 1 = unchanged. */
export interface MouthShape {
  /** Jaw openness 0..1 — drives the jaw slide and the inner-mouth reveal. */
  open: number;
  /** Horizontal stretch of the strip (wide sounds > 1, round sounds < 1). */
  stretchX: number;
  /** Vertical stretch (press < 1 flattens the lips shut). */
  stretchY: number;
}

import type { Viseme } from './visemes';

/**
 * Shape targets per viseme, scaled by the live loudness so a whispered O and
 * a projected O read differently. Loudness alone (shape ignored) was the
 * first cut, and it looked like a fish; shape alone looked like typing. Both
 * together is the classic trick.
 */
export function mouthShapeOf(v: Viseme, level: number): MouthShape {
  const drive = 0.5 + 0.5 * Math.min(1, level * 1.6);
  switch (v) {
    case 'open':
      return { open: 0.85 * drive, stretchX: 1.02, stretchY: 1.15 };
    case 'wide':
      return { open: 0.45 * drive, stretchX: 1.14, stretchY: 0.95 };
    case 'round':
      return { open: 0.6 * drive, stretchX: 0.82, stretchY: 1.2 };
    case 'press':
      return { open: 0.05, stretchX: 0.98, stretchY: 0.82 };
    case 'teeth':
      return { open: 0.2 * drive, stretchX: 1.05, stretchY: 0.9 };
    case 'rest':
      return { open: 0, stretchX: 1, stretchY: 1 };
  }
}

/** A rect scaled about its own centre. Pure, and the whole warp's geometry. */
export function scaledAbout(r: Rect, sx: number, sy: number): Rect {
  return {
    x: r.x + (r.w * (1 - sx)) / 2,
    y: r.y + (r.h * (1 - sy)) / 2,
    w: r.w * sx,
    h: r.h * sy,
  };
}

/**
 * MEERA'S RIG. Calibrated by eye against content/avatar/meera.png (the
 * ChatGPT set Aarav generated on 2026-08-31); the avatar lab draws these
 * boxes over the photo so recalibrating is looking, not guessing.
 */
export const MEERA_RIG: AvatarRig = {
  frame: { x: 0.13, y: 0.07, w: 0.74, h: 0.6 },
  mouth: { x: 0.428, y: 0.354, w: 0.128, h: 0.058 },
  innerMouth: { x: 0.449, y: 0.368, w: 0.087, h: 0.034 },
  jaw: { x: 0.398, y: 0.412, w: 0.188, h: 0.095 },
  // Watched at tile size on the first live class: 0.018 was invisible.
  jawDrop: 0.032,
  eyeL: { x: 0.406, y: 0.248, w: 0.073, h: 0.038 },
  eyeR: { x: 0.52, y: 0.248, w: 0.073, h: 0.038 },
};

/**
 * Where the face sits in each POSE photo, relative to the base photo.
 *
 * The set is consistent but not pixel-registered: the pointing shot leans
 * the whole figure right, the greeting shot rides higher. One offset-and-
 * scale per pose (applied to every rig box, about the image centre) keeps
 * the lips synced mid-gesture without seven hand-tuned rigs.
 */
export interface PoseFit {
  dx: number;
  dy: number;
  s: number;
}

export const MEERA_POSE_FIT: Record<string, PoseFit> = {
  idle: { dx: 0, dy: 0, s: 1 },
  point: { dx: 0.108, dy: -0.01, s: 1 },
  explain: { dx: 0.008, dy: -0.022, s: 1 },
  greet: { dx: 0.011, dy: -0.03, s: 1 },
  think: { dx: 0.011, dy: 0.003, s: 1 },
  listen: { dx: 0.015, dy: 0.028, s: 1.03 },
};
