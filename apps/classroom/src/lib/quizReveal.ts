import type { AssistanceRung } from '@ai-tutor/ledger';
import { createLocalStore } from '../stores/localStore';

/**
 * WHICH QUIZ ANSWERS THIS DEVICE HAS JUST SHOWN, SO A RETAKE IS NOT FILED COLD
 * (B5).
 *
 * Checking a quiz question shows the answer: the right option gets its tick
 * (`PracticeQuiz.tsx:297-299`) and a wrong choice gets its misconception or
 * "The answer is B" (`:319`). "Try again" then rebuilds the SAME quiz — it is
 * deterministic on purpose, so a retake is comparable. A retake minutes later
 * is therefore answered with the answer fresh in view, and `quizLedger` used to
 * file it at rung 0, attempt 1: the strongest evidence the product has, handed
 * to a student reading back what the screen just told them.
 *
 * So a probe revealed within `REVEAL_WINDOW_MS` files at rung 8 — "the answer
 * itself", which is what the screen showed — as the next attempt. The fold
 * then credits a right retake `defaultCredit(8)` = 0.2 of a cold one and never
 * as unassisted.
 *
 * THE WINDOW IS A DAY, AND THAT IS A CHOICE, NOT A MEASUREMENT (UNVERIFIED). It
 * is the same line as the mastery rule's spacing (B8, 24 h), on the reading
 * that a day later the retake is retrieval rather than read-back. Nothing has
 * measured where recall of a shown answer actually fades for these students.
 *
 * Device-local and never synced: it is about what THIS screen showed. A retake
 * on another device inside the window is filed cold — the one gap left.
 */

/** How long after a reveal a retake of that probe is still read-back. */
export const REVEAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** What `quizLedger` files with an answer, given what was revealed before it. */
export interface RetakeHelp {
  assistanceRung: AssistanceRung;
  attempt: number;
  hintsShown: number;
}

type Reveals = Record<string, { at: number; times: number }>;

/** Where the reveals are kept. A `Store` fits; tests pass a plain object. */
export interface RevealHolder {
  get(): Reveals;
  set(next: Reveals): void;
}

export interface RevealMemory {
  /** The rung and attempt to file an answer to `probeId` at, at `nowMs`. */
  helpFor(probeId: string, nowMs: number): RetakeHelp;
  /** The answer to `probeId` was just shown on screen. */
  markRevealed(probeId: string, nowMs: number): void;
}

const COLD: RetakeHelp = { assistanceRung: 0, attempt: 1, hintsShown: 0 };

/**
 * `nowMs` is the caller's clock, passed in so the rule is testable. A clock
 * that reads EARLIER than the reveal counts as inside the window: a phone whose
 * time stepped back must not turn a read-back into a cold answer.
 */
export function createRevealMemory(holder: RevealHolder = defaultHolder()): RevealMemory {
  /**
   * The copy this page keeps whatever storage does. When storage throws, this
   * is what stops the Try-again retake, on the same page, being filed cold.
   */
  let local: Reveals = {};

  const read = (): Reveals => {
    try {
      const held = holder.get();
      if (held && typeof held === 'object') local = { ...held, ...local };
    } catch {
      // Blocked storage: the page's own copy is the record.
    }
    return local;
  };

  const within = (entry: { at: number } | undefined, nowMs: number): boolean =>
    entry !== undefined && nowMs - entry.at < REVEAL_WINDOW_MS;

  return {
    helpFor(probeId, nowMs) {
      const entry = read()[probeId];
      if (!within(entry, nowMs)) return COLD;
      return { assistanceRung: 8, attempt: entry!.times + 1, hintsShown: 1 };
    },

    markRevealed(probeId, nowMs) {
      const all = read();
      const prev = all[probeId];
      const next: Reveals = {};
      // Only what is still inside the window survives a write, so the record
      // holds at most one day of reveals however long the device is used.
      for (const [id, entry] of Object.entries(all)) {
        if (id !== probeId && within(entry, nowMs)) next[id] = entry;
      }
      next[probeId] = { at: nowMs, times: within(prev, nowMs) ? prev!.times + 1 : 1 };
      local = next;
      try {
        holder.set(next);
      } catch {
        // The page's copy above still holds it.
      }
    },
  };
}

let store: RevealHolder | null = null;

/** Created on first use, so importing this file touches no storage. */
function defaultHolder(): RevealHolder {
  store ??= createLocalStore<Reveals>('ai-tutor:quiz-revealed', {}, { neverSync: true });
  return store;
}
