/**
 * THE CONTRACT `rules-driver.mjs` HAS. See format.d.mts for why these sidecars
 * exist.
 *
 * The promise is stronger than the sum of the modules underneath: the returned
 * timeline is ordered, gapless, non-overlapping and covers exactly [0,
 * durationSec]. An empty array means it REFUSED, and there are three ways to
 * earn a refusal: no text, no clock, or no letter the table can read. The
 * third is the one that matters for this product — a Devanagari script
 * produces only pauses, and a mouth that never opens is a refusal that has to
 * be spelled that way rather than returned as an answer. An empty array is
 * never a valid mouth.
 */

import type { MouthCue } from './format.d.mts';

export declare function alignByRules(
  text: string,
  durationSec: number,
  options?: { leadMs?: number },
): MouthCue[];
