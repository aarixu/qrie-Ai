import type { Mastery } from '@ai-tutor/knowledge-graph';
import {
  emptyModel,
  foldSession,
  masteryView,
  type LearnerModel,
} from '@ai-tutor/learner-model';
import type { LearningSession, LedgerEvent } from '@ai-tutor/ledger';
import { createLocalStore } from '../stores/localStore';

/**
 * THE DEVICE'S COPY OF WHAT WE BELIEVE ABOUT THIS STUDENT.
 *
 * Folded from the same events the ledger is writing, in the same place they are
 * written, so belief and the record cannot come apart. One call site, because
 * two would eventually disagree and the disagreement would be invisible.
 *
 * AUTHORITATIVE ONLY UNTIL THERE IS A SERVER FOLD, WHICH THERE IS NOT YET. The
 * design has this same reducer running in the Edge Function over the ledger in
 * `(started_at, seq)` order, with the server winning any disagreement. Until
 * that lands this is the only model there is, and its cursor is in the DEVICE's
 * clock — `Outbox.session.startedAt` is stamped by `stores/ledger.ts`, not by
 * Postgres.
 *
 * That is safe precisely because there is nothing to disagree with yet. It
 * stops being safe the moment a server model exists, so when that arrives it
 * must REBUILD FROM ZERO rather than continue this cursor: the two clocks are
 * not the same clock, and a cursor carried across them would silently skip
 * whatever fell between them.
 */
const modelStore = createLocalStore<LearnerModel>('ai-tutor:learner-model', emptyModel());

export const learnerModelStore = modelStore;

export const loadModel = (): LearnerModel => modelStore.get();

/** What every existing reader of `profile.diagnostic.mastery` asks for instead. */
export const masteryFromModel = (): Mastery => masteryView(modelStore.get());

/**
 * Fold what just happened into the replica.
 *
 * Silent on a class with no map behind it — a free topic or a brought file
 * teaches for real and has no outcomes to be evidence about, and inventing some
 * would put ids in the model that exist in no graph.
 *
 * THE GRAPH IS IMPORTED LAZILY, AND THAT IS NOT A DETAIL. This is called from
 * `stores/ledger.ts`, which every surface that records anything loads at
 * start-up. A static import of the map loader would pull megabytes of syllabus
 * JSON into the eager bundle — the exact cost `App.tsx:27-35` is written to
 * avoid on a ten-thousand-rupee Android, and it cost ten seconds a test file
 * before it was caught here.
 *
 * IT IS NOT A TICK. MEASURED: 3,920 ms on a warm laptop.
 *
 * `import('./graphContext')` pulls `diagnosticData`'s eager glob over all 26
 * syllabus maps, which on a phone is a chunk fetch. An earlier version of this
 * comment claimed the fold lands in a microtask and that nothing reads belief
 * inside the window; both halves were false. `LiveClass.tsx:391` reads
 * `masteryFromModel()` straight after an awaited network call, and
 * `Diagnostic.tsx` reads `evidenceSet(loadModel())` one commit after the last
 * answer is logged. Both sit inside four seconds of nothing.
 *
 * So the promise is returned and `settled()` is exported: a caller that needs
 * the fold to have happened can await it, and the ledger — which must never
 * wait on a derived cache — does not.
 */
let inFlight: Promise<void> = Promise.resolve();

/**
 * Resolves once every fold asked for so far has finished.
 *
 * For the two readers that genuinely need it — the planner and the placement
 * screen, both already inside `async` functions — and for tests. Never awaited
 * by the ledger.
 */
export const settled = (): Promise<void> => inFlight;

/**
 * HOW FAR BEHIND ITS OWN LEDGER THIS MODEL IS.
 *
 * Counts events the device recorded and did NOT fold: no map loaded, or the
 * fold threw. They are still on their way to the server, so the belief is not
 * lost — but this device's copy is behind, and "Rebuild from the ledger" will
 * report the difference.
 *
 * It exists because the alternative is worse than the gap. Without it the
 * inspector accuses the record: it says "belief exists here that no surviving
 * event accounts for, or something wrote belief that should not have" — about
 * a model that is simply behind. `Outbox` already counts `dropped`, `rejected`
 * and `orphaned` for exactly this reason: losing events is bad and losing them
 * QUIETLY is worse.
 */
const UNFOLDED_KEY = 'ai-tutor:learner-model-unfolded';

export const unfoldedCount = (): number => {
  try {
    return Number(localStorage.getItem(UNFOLDED_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
};

const missed = (n: number): void => {
  try {
    localStorage.setItem(UNFOLDED_KEY, String(unfoldedCount() + n));
  } catch {
    // A locked-down WebView. The count is a diagnostic, not the record.
  }
};

export function recordLocally(
  session: LearningSession,
  events: readonly LedgerEvent[],
): Promise<void> {
  if (events.length === 0) return Promise.resolve();
  const done = import('./graphContext')
    .then(({ currentIndex, currentParams }) => {
      const index = currentIndex();
      if (!index) {
        // No class set, or a map that will not load for it. Ordinary, and NOT
        // silent: `foldAppended` only ever folds events that are new to the
        // outbox, so a fold skipped here is never revisited.
        missed(events.length);
        return;
      }
      modelStore.set(
        foldSession(
          modelStore.get(),
          { id: session.id, startedAt: session.startedAt },
          events,
          index,
          currentParams(),
        ),
      );
    })
    .catch(() => {
      // A class still runs. The ledger has the events either way and a server
      // fold rebuilds from those — but this device is behind, and says so.
      missed(events.length);
    });
  inFlight = inFlight.then(() => done).catch(() => undefined);
  return done;
}
