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
 * Folding a tick late is harmless: the model is a derived cache of a record
 * that has already been written. Nothing reads belief between the event landing
 * and the microtask that folds it.
 */
export function recordLocally(
  session: LearningSession,
  events: readonly LedgerEvent[],
): Promise<void> {
  // Returned so a test can await the fold. The ledger does not: a class must
  // never wait on a derived cache.
  if (events.length === 0) return Promise.resolve();
  return import('./graphContext')
    .then(({ currentIndex, currentParams }) => {
      const index = currentIndex();
      if (!index) return;
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
      // A map that will not load is a class that still runs. The ledger has the
      // events either way, and a server fold rebuilds from those.
    });
}
