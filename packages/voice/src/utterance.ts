/**
 * The hard part of the TtsAdapter contract, in one place.
 *
 * `speak()` must resolve when the utterance finishes OR when it is cancelled,
 * and it must resolve exactly once — the player advances the class on that
 * promise, so a speak() that never settles is a class that stops dead, and a
 * speak() that settles twice is harmless only by luck.
 *
 * Every adapter here is asynchronous in more than one way at once (a fetch, a
 * playback timer, a fallback adapter), and each of those can land after the
 * player has already moved on. So each utterance settles through its OWN
 * closure: a late completion belonging to a superseded utterance can never
 * resolve a newer speak()'s promise.
 *
 * This mirrors the guard PlayerController keeps on its side. Both are needed:
 * the controller ignores stale completions, and this makes sure a stale
 * completion is all a cancelled utterance can ever produce.
 */

export interface Utterance {
  /** False once this utterance was cancelled, superseded, or already settled. */
  readonly current: boolean;
  /** Resolve this speak(). Idempotent — later calls are no-ops. */
  done(): void;
}

export interface UtteranceQueue {
  /**
   * Begin an utterance. Any earlier one is settled first so it cannot hang,
   * then `run` is handed the handle that settles this one.
   */
  speak(run: (utterance: Utterance) => void): Promise<void>;
  /** Settle whatever is pending. Safe when nothing is speaking. */
  cancel(): void;
}

export function createUtteranceQueue(): UtteranceQueue {
  let pending: (() => void) | null = null;

  return {
    speak(run: (utterance: Utterance) => void): Promise<void> {
      pending?.(); // never leave an older speak() hanging
      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          if (pending === finish) pending = null;
          resolve();
        };
        pending = finish;

        const utterance: Utterance = {
          get current(): boolean {
            return pending === finish;
          },
          done: finish,
        };

        try {
          run(utterance);
        } catch {
          // A throw while starting an utterance is still a finished utterance
          // as far as the class is concerned. Silence beats a stall.
          finish();
        }
      });
    },
    cancel(): void {
      pending?.();
    },
  };
}

/**
 * Cancellable timer, injected so tests have no clock.
 *
 * Returns its own cancel function rather than a handle, so callers never have
 * to know whether the timer came from setTimeout, a fake, or a frame loop.
 */
export type Schedule = (fn: () => void, ms: number) => () => void;

export const defaultSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => {
    clearTimeout(timer);
  };
};
