/**
 * THE CONTRACT `plan.mjs` HAS. See topics.d.mts for why these files exist.
 */

import type { PrewarmState } from './state.d.mts';
import type { TopicRow } from './topics.d.mts';

/**
 * One syllabus named twice is one plan entry, and therefore ONE state object.
 * Without this a repeated `--syllabus` planned the same topics twice and paid
 * for them twice; it runs before the filter check for that reason.
 */
export declare const dedupeSyllabi: (ids: readonly string[]) => string[];

/** One syllabus's share of a run: what exists, and what still needs paying for. */
export interface SyllabusPlan {
  syllabusId: string;
  /** Resumed from disk, so a re-run knows what the last one already did. */
  state: PrewarmState;
  /** Every topic the filters selected. */
  rows: TopicRow[];
  /**
   * The subset still worth PAYING FOR — see pendingTopics. A Set, not the
   * array pendingTopics returns: the runner asks "is this one still pending?"
   * once per topic while it walks `rows`, and at 274 topics a linear scan each
   * time is the wrong shape for the question.
   */
  pending: Set<string>;
}

export declare function planFor(options: {
  syllabi: readonly string[];
  chapter?: string;
  topic?: string;
  stateDir: string;
}): SyllabusPlan[];
