import type { DiagnosticConfig } from '@ai-tutor/diagnostic';
import type { Answer } from '@ai-tutor/knowledge-graph';
import { createLocalStore } from './localStore';

/**
 * THE PLACEMENT TEST, ONE SUBJECT AT A TIME, AND WHERE EACH ONE GOT TO.
 *
 * The test is mandatory (Aarav, 2026-09-30): no class opens until every subject
 * the student chose has been placed. It may be paused, so what has been
 * answered so far has to outlive the screen — this is where it lives.
 *
 * Its own row rather than a field on the profile: a sitting is written after
 * every answer, and the profile row carries the name, the subjects and the
 * workspace, which would all be re-sent with every tap. A store of its own
 * syncs on its own (stores/localStore.ts registers it; lib/sync.ts sends it).
 */

/**
 * ONE SITTING, SAVED SO IT CAN BE PICKED UP ON THE SAME QUESTION.
 *
 * The session is pure state (packages/diagnostic/src/session.ts) and the next
 * question is a function of it, so saving the state is saving the place.
 *
 * `mastery` and `before` keep only the beliefs that differ from the map's own
 * starting prior — `initialMastery(index, { biasByDifficulty: true })`, which
 * is recomputed on restore. A Class 10 Science sitting spans about 1,850
 * outcomes (Class 8-10), and this row is re-sent after every answer.
 */
export interface SavedSitting {
  version: 1;
  klass: number;
  /** The subjects the screen was given — one, for a per-subject sitting. */
  subjects: string[];
  /** Beliefs now, where they differ from the starting prior. */
  mastery: Record<string, number>;
  /** Beliefs the sitting STARTED from (after classroom seeding), the same way. */
  before: Record<string, number>;
  answers: Answer[];
  /** Nodes with direct evidence, in the order they were asked. */
  asked: string[];
  /** Nodes the classroom spoke about before the test opened. */
  seeded: string[];
  config: DiagnosticConfig;
  /** ISO time of the last save. */
  savedAt: string;
}

export interface PlacementRecord {
  /** ISO time this (class, subject) was last placed; null until it has been. */
  completedAt: string | null;
  /** The sitting in progress, saved after every answer; null when none is open. */
  open: SavedSitting | null;
  /** The last finished sitting, kept so the plan across subjects can be rebuilt. */
  finished: SavedSitting | null;
  /**
   * Placed by the one-sitting test this app ran before the test was per
   * subject. The result is `profile.diagnostic`; there is no sitting to keep.
   */
  legacy?: boolean;
}

export interface PlacementState {
  version: 1;
  /** Keyed by `placementKey(klass, subject)` (lib/placement.ts). */
  records: Record<string, PlacementRecord>;
  /**
   * Keys still to sit in a retake the student asked for. A retake never shuts
   * a class — those subjects are placed already — so it is kept apart from
   * what is owed.
   */
  retaking: string[];
}

export const EMPTY_PLACEMENT: PlacementState = { version: 1, records: {}, retaking: [] };

/** The store's key, for the one write that dates itself (lib/placement.ts adoptLegacyPlacement). */
export const PLACEMENT_KEY = 'ai-tutor:placement';

export const placementStore = createLocalStore<PlacementState>(PLACEMENT_KEY, EMPTY_PLACEMENT);
