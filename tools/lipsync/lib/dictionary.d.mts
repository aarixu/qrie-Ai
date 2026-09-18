/**
 * THE CONTRACT `dictionary.mjs` HAS. See format.d.mts for why these sidecars
 * exist.
 *
 * `coverage` is a pure function over a Set, which is the only reason the most
 * quoted number in this spike can be tested at all: no rhubarb install, no
 * audio, no ffmpeg — hand it a Set and it is arithmetic.
 */

export interface Coverage {
  /** Word tokens found, not distinct words. Five "hai"s are five tokens. */
  tokens: number;
  inDictionary: number;
  outOfVocabulary: number;
  /** 0 when there are no tokens at all, never NaN. */
  oovRate: number;
  /** The misses, deduplicated and sorted. Types here, unlike everywhere else. */
  missingTypes: string[];
}

export declare function loadDictionary(): Promise<
  | { ok: true; words: Set<string>; entries: number; from: string }
  | { ok: false; reason: string }
>;

export declare function coverage(text: string, words: Set<string>): Coverage;
