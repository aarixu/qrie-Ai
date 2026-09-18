/**
 * THE CONTRACT `sentences.mjs` HAS. See format.d.mts for why these sidecars
 * exist.
 *
 * The return value is the set of points at which the rule-table driver
 * re-anchors to real time, so its length is a bound on accumulated drift.
 */

/** Sentences with their terminators kept. Empty array for empty input. */
export declare function splitSentences(text: string): string[];
