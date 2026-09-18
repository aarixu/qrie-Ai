/**
 * THE CONTRACT `rules.mjs` HAS. See format.d.mts for why these sidecars exist.
 *
 * A `Unit` is a shape with a UNITLESS relative weight. It is not a duration
 * and must never be treated as one — scale.mjs is the only thing that turns
 * weights into seconds, and it needs a measured clip length to do it.
 */

import type { MouthShape } from './format.d.mts';

export interface Unit {
  v: MouthShape;
  w: number;
}

export declare const SHAPE_WEIGHT: Record<MouthShape, number>;
export declare const PAUSE_WEIGHT: { space: number; dash: number; comma: number; sentence: number };

/** Letters in, mouth shapes out. Consecutive identical shapes are collapsed. */
export declare function wordToShapes(word: string): MouthShape[];

/** A whole line, with idle units filled in at the spaces and the punctuation. */
export declare function textToUnits(text: string): Unit[];

/**
 * Of the LETTERS in a string, the share the table can read (Latin). 0 means a
 * mouth that will never open; 1 means every letter produced a shape. The table
 * is immune to language and dependent on SCRIPT, and this is how a caller
 * finds out which side of that it is on.
 */
export declare function readableFraction(text: string): number;
