/**
 * THE CONTRACT `metrics.mjs` HAS. See format.d.mts for why these sidecars
 * exist.
 *
 * THERE IS NO `accuracy` FIELD ON ANY OF THESE TYPES, AND ADDING ONE WOULD BE
 * A LIE UNTIL SOMEBODY HAND-LABELS A CLIP. Every field below is a fact about
 * the output, not a judgement of it.
 */

import type { MouthCue, MouthShape } from './format.d.mts';

export interface ClipMetrics {
  cueCount: number;
  meanDurationMs: number;
  cuesPerSecond: number;
  /** Fraction of the clip in A or X. Time no cue covers counts as shut. */
  shutFraction: number;
  shapeHistogram: Partial<Record<MouthShape, number>>;
  bytes: number;
  bytesPerMinute: number;
  /** What the phone actually downloads. The only size figure worth quoting. */
  gzipBytes: number;
  gzipBytesPerMinute: number;
}

export interface Disagreement {
  /** Fraction of samples where the two name a different shape. */
  frameDisagreement: number;
  /** Fraction where one says shut and the other says open — the visible one. */
  openShutDisagreement: number;
  sampleCount: number;
}

export declare function sampleTimeline(
  cues: readonly MouthCue[],
  options: { rateHz: number; duration: number },
): MouthShape[];

export declare function disagreement(
  a: readonly MouthCue[],
  b: readonly MouthCue[],
  options: { rateHz: number; duration: number },
): Disagreement;

export declare function clipMetrics(cues: readonly MouthCue[], duration: number): ClipMetrics;
