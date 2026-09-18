/**
 * THE CONTRACT `scale.mjs` HAS. See format.d.mts for why these sidecars exist.
 *
 * Both functions promise the same thing and it is the important one: the parts
 * sum to EXACTLY the whole, by construction rather than to float precision.
 * See scale.mjs for the measurement showing that today's pipeline would survive
 * without that guarantee, and why it is kept anyway.
 */

import type { MouthCue } from './format.d.mts';
import type { Unit } from './rules.d.mts';

/** Unitless weights laid end to end across a real span. Last cue absorbs the rounding. */
export declare function scaleUnits(
  units: readonly Unit[],
  span: { start: number; duration: number },
): MouthCue[];

/** One clip's duration split across its sentences. Sums to exactly `duration`. */
export declare function allocate(weights: readonly number[], duration: number): number[];
