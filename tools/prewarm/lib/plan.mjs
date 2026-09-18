/**
 * THE PLAN — WHAT THE RUN WOULD COST, BEFORE ANY MONEY MOVES.
 *
 * Split out of main.mjs so it can be TESTED. main.mjs imports the whole
 * class-prep pipeline; this file imports nothing heavier than the syllabus
 * data and the state file, so the arithmetic an operator approves is pinned
 * by a fast unit test instead of by a hand-run CLI transcript.
 *
 * ONE ENTRY PER SYLLABUS, always. A syllabus named twice (`--syllabus
 * class9-science --all-class9-10-science` is the real spelling of it) used to
 * produce two entries, each with its OWN state object loaded from the same
 * file: the count doubled, the Rs figure doubled, every topic was walked
 * twice, and the second pass's save erased the first pass's record of what it
 * had already paid for. A tool whose entire purpose is never paying twice for
 * one recording must not be persuadable to pay twice by a repeated flag.
 */
import { loadState, pendingTopics } from './state.mjs';
import { topicsFor } from './topics.mjs';

/** Order-preserving: the first mention wins, so the walk order stays the
 *  operator's order. */
export const dedupeSyllabi = (ids) => [...new Set(ids)];

/**
 * `[{ syllabusId, state, rows, pending }]` — rows is every topic the filters
 * allow, pending is the subset the state file has not already paid for.
 */
export function planFor({ syllabi, chapter, topic, stateDir }) {
  return dedupeSyllabi(syllabi).map((syllabusId) => {
    const rows = topicsFor(syllabusId, { chapter, topic });
    const state = loadState(stateDir, syllabusId);
    const pending = new Set(pendingTopics(state, rows.map((r) => r.path)));
    return { syllabusId, state, rows, pending };
  });
}
