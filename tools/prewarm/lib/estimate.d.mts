/**
 * THE CONTRACT `estimate.mjs` HAS. See topics.d.mts for why.
 *
 * PRD-6's numbers, and only PRD-6's: Rs 30 a topic as the planning figure,
 * Rs 26 to Rs 40 as the band. A dry run printing a different band would be a
 * second opinion nobody asked for — which is why they live in one place.
 */

export declare const PER_TOPIC_INR: { low: number; plan: number; high: number };

export interface Estimate {
  count: number;
  low: number;
  /** The number to quote. The other two are the honesty around it. */
  plan: number;
  high: number;
}

export declare function estimate(count: number): Estimate;
