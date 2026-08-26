/**
 * Which actions belong to which beat.
 *
 * Half-open, like `Array.prototype.slice`: `actions.slice(from, to)` is exactly
 * this beat's actions, with no off-by-one to remember.
 *
 * This lives BESIDE the actions rather than inside them. Writing a beat id into
 * their `ActionBase` would mean forking `@openmaic/dsl`, and then every upgrade
 * of theirs becomes a merge of ours.
 */
export interface BeatRange {
  beatId: string;
  /** Inclusive. */
  from: number;
  /** Exclusive. */
  to: number;
}

/**
 * The beat that owns this action index, or null.
 *
 * This is the join that keeps the outcome loop closed. A hand raised at action
 * 47 resolves to a beat, and the beat names the exact Learning Outcome Map node
 * ids the student is stuck on. Without it, a raised hand puts a whole chapter
 * under suspicion.
 *
 * Empty ranges — a beat that emitted no actions — never own an index, or a
 * silent beat would swallow the first action of the beat after it.
 */
export function beatOfAction(ranges: BeatRange[], index: number): string | null {
  if (index < 0) return null;
  for (const range of ranges) {
    if (range.to <= range.from) continue;
    if (index >= range.from && index < range.to) return range.beatId;
  }
  return null;
}
