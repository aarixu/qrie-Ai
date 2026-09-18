/**
 * THE CONTRACT `state.mjs` HAS. See topics.d.mts for why these exist at all.
 *
 * The state file is what stops a re-run paying twice: preparation is about
 * Rs 30 a topic, so resuming rather than restarting is the difference between
 * a retry and a second catalogue.
 */

export type TopicStatus = 'done' | 'failed' | 'skipped';

export declare const STATUSES: readonly TopicStatus[];

/** Three in a row stops the run: a broken prompt must not burn the budget. */
export declare const MAX_CONSECUTIVE_FAILURES: number;

/**
 * What a run records about one topic. `markTopic` spreads the note whole and
 * stamps `at` when the caller did not, so the shape is deliberately OPEN: the
 * status is the only thing the code reasons about, and everything beside it is
 * there to be read by a human working out why a run stopped. The named fields
 * are the ones the runner writes today.
 */
export interface TopicNote {
  status: TopicStatus;
  /** ISO. Stamped by markTopic when absent. */
  at?: string;
  /** What it cost, so a resumed run can total the spend it already made. */
  spendInr?: number;
  /** Why it failed or was skipped, in words a person can act on. */
  reason?: string;
  prepId?: string;
  [key: string]: unknown;
}

export interface PrewarmState {
  syllabus: string;
  topics: Record<string, TopicNote>;
}

/**
 * Releasing the lock IS the return value — `acquireStateLock(...)()` is the
 * whole lifecycle, and calling it twice is a no-op. A plain function rather
 * than an object because there is exactly one thing a holder can do with it,
 * and because `const release = acquireStateLock(dir, id)` then reads as what
 * it is at the call site.
 */
export type ReleaseLock = () => void;

export declare const shouldStop: (consecutiveFailures: number) => boolean;
export declare const emptyState: (syllabus: string) => PrewarmState;
export declare const statePath: (dir: string, syllabus: string) => string;

export declare function markTopic(state: PrewarmState, topicRef: string, note: TopicNote): PrewarmState;
/**
 * The refs still worth PAYING FOR. `done` and `skipped` never come back;
 * `failed` and never-tried do. Order is the caller's, so a resume walks the
 * syllabus in the sequence the first run did.
 */
export declare function pendingTopics(state: PrewarmState, refs: readonly string[]): string[];
export declare function loadState(dir: string, syllabus: string): PrewarmState;
export declare function saveState(dir: string, state: PrewarmState): void;
/**
 * Throws, naming the holding pid, when another run already owns this syllabus:
 * two runs would prepare and PAY FOR the same topics. `--force` takes it
 * anyway, for when the holder is dead.
 */
export declare function acquireStateLock(dir: string, syllabus: string, opts?: { force?: boolean }): ReleaseLock;
