/**
 * THE CONTRACT `format.mjs` HAS.
 *
 * These sidecars exist because the root tsconfig includes `tools/**\/*.ts` and
 * the tests are TypeScript while the tools are plain `.mjs` — the same reason
 * tools/prewarm/lib carries its own set. Without them the repo's typecheck
 * goes red on an untyped import.
 *
 * `MouthCue` is the one type in this repo that a renderer, an illustrator and
 * an aligner all have to agree on. Widening it is a product decision, not a
 * refactor.
 */

/** One of the nine. A tenth shape is a new drawing somebody has to be paid for. */
export type MouthShape = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'X';

/** start (s), duration (s), mouth shape. avatar-3.md:208. */
export interface MouthCue {
  t: number;
  d: number;
  v: MouthShape;
}

/** What an aligner hands back before normalisation: start/end, and any string. */
export interface RawCue {
  start?: number;
  end?: number;
  t?: number;
  d?: number;
  value?: string;
  v?: string;
}

export declare const MOUTH_SHAPES: MouthShape[];
export declare const SHAPE_NOTES: Record<MouthShape, string>;
/** A and X — the two shapes showing no mouth interior. */
export declare const SHUT_SHAPES: Set<string>;

/**
 * Ordered, non-overlapping, gapless, runs merged. THROWS on a shape outside
 * the nine rather than dropping it, because a dropped cue is a hole in a face.
 */
export declare function normaliseCues(
  raw: readonly RawCue[],
  options?: { duration?: number; padStart?: boolean },
): MouthCue[];

/** Every problem, as sentences. Empty array means clean. */
export declare function validateTimeline(cues: readonly MouthCue[]): string[];

export declare function timelineBytes(cues: readonly MouthCue[]): number;
export declare function shapeAt(cues: readonly MouthCue[], tSec: number): MouthShape;
