/**
 * THE IDLE LOOP — what stops a photo being a corpse.
 *
 * Layer C of the avatar: blinking on a human clock, and a slow breathing
 * sway that deepens into small nods while she speaks. All of it is a pure
 * function of time (and a seedable random for the blinks), so it tests in
 * milliseconds and renders at whatever frame rate the tile gets.
 */

export interface Blinker {
  /** 1 = eyes open, 0 = shut, sampled at time `tMs`. */
  opennessAt(tMs: number): number;
}

const BLINK_MIN_GAP_MS = 2800;
const BLINK_MAX_GAP_MS = 4600;
const BLINK_MS = 150;

/**
 * Blinks every 2.8–4.6 s, each one 150 ms of shut-and-open.
 *
 * The schedule is generated lazily and remembered, so sampling is pure with
 * respect to time: asking about the same moment twice gives the same answer.
 */
export function createBlinker(rand: () => number = Math.random): Blinker {
  const blinks: number[] = []; // start times
  let horizon = 0;

  const extend = (until: number): void => {
    while (horizon <= until) {
      const gap = BLINK_MIN_GAP_MS + rand() * (BLINK_MAX_GAP_MS - BLINK_MIN_GAP_MS);
      horizon += gap;
      blinks.push(horizon);
    }
  };

  return {
    opennessAt(tMs: number): number {
      extend(tMs);
      for (let i = blinks.length - 1; i >= 0; i -= 1) {
        const start = blinks[i];
        if (start > tMs) continue;
        const into = tMs - start;
        if (into >= BLINK_MS) return 1;
        // Shut fast, open a touch slower — a triangle with a late apex.
        const phase = into / BLINK_MS;
        return phase < 0.4 ? 1 - phase / 0.4 : (phase - 0.4) / 0.6;
      }
      return 1;
    },
  };
}

export interface Sway {
  /** Degrees of head tilt. Fractions of a degree — an illusion, not a bobble-head. */
  rotDeg: number;
  /** Pixels of drift at a nominal 512px frame. */
  dx: number;
  dy: number;
}

/**
 * Breathing at rest; nodding faintly with the voice.
 *
 * `level` is the live loudness 0..1. Silent, she sways on two slow sines
 * (breathing); speaking, the loudness leans her forward a hair and adds a
 * small nod. The magic numbers are degrees and pixels chosen by eye — the
 * whole effect must stay under 2 degrees or the photo reads as a puppet.
 */
export function swayAt(tMs: number, level: number): Sway {
  const s = tMs / 1000;
  const breathe = Math.sin(s * 0.55) * 0.5 + Math.sin(s * 0.23 + 1.7) * 0.3;
  const nod = level * Math.sin(s * 5.1) * 0.5;
  return {
    rotDeg: breathe * 0.7 + nod,
    dx: Math.sin(s * 0.31 + 0.9) * 2,
    dy: Math.sin(s * 0.47) * 1.5 + level * 2,
  };
}
