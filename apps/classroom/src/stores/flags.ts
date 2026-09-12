import { createLocalStore } from './localStore';

/**
 * WHAT THE SAFETY LAYER SAW, KEPT ON THE DEVICE.
 *
 * A moderation layer with no record is a moderation layer nobody can check.
 * But this repo already made a decision about children's words that this must
 * not quietly undo — apps/agent/src/worker.ts, on LiveKit's recording flags:
 *
 *   "Our students are children between 11 and 18. Their voices and their
 *    doubts do not leave the room they were spoken in."
 *
 * So the log is LOCAL, and it holds the least it can: what kind of thing
 * happened, when, and which lesson — never the sentence itself. A distress
 * flag on a phone is enough for a parent to know a conversation happened; the
 * transcript of a child's worst moment sitting in localStorage is not
 * something this product should own.
 *
 * A REPORT is different, and is the student's own act: they press a button,
 * they choose to send it, and only then does anything leave the device. That
 * is what the store review is asking for — not surveillance, a way out.
 */

export type FlagKind =
  /** The child said something that needs a person, not a tutor. */
  | 'distress'
  /** Something outside school work; she redirected. */
  | 'redirect'
  /** A phone number, an address, or an instruction was taken out. */
  | 'cleaned'
  /** The student pressed Report. */
  | 'reported';

export interface Flag {
  kind: FlagKind;
  /** ISO, so a parent reading it sees a date and not a number. */
  at: string;
  /** The lesson it happened in, when there was one. */
  lessonId?: string;
  /**
   * For a report only, and only because the student typed it themselves.
   * Nothing the safety screen matched is ever stored.
   */
  note?: string;
}

export interface FlagLog {
  flags: Flag[];
}

/**
 * Bounded. This is a safety net, not an archive, and an unbounded array in
 * localStorage is a store that eventually refuses to write anything at all.
 */
const KEEP = 50;

/**
 * `neverSync` is load-bearing, not decoration.
 *
 * Registration into the sync map is automatic, so for its first weeks this log
 * was being pushed to `student_state` — every distress flag, and the note a
 * student typed into a report — in flat contradiction of the paragraph above
 * it. The rule was written down and the default quietly won.
 */
export const flagStore = createLocalStore<FlagLog>('flags', { flags: [] }, { neverSync: true });

export function recordFlag(flag: Flag): void {
  flagStore.update((log) => ({ flags: [flag, ...log.flags].slice(0, KEEP) }));
}

/** Whether anything has ever been flagged — what Help uses to offer a way on. */
export const hasFlags = (log: FlagLog): boolean => log.flags.length > 0;

/** Most recent first, which is the only order a person reads this in. */
export const recentFlags = (log: FlagLog, limit = 10): Flag[] => log.flags.slice(0, limit);
