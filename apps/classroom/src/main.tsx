import { StrictMode } from 'react';
import { initTelemetry } from './lib/telemetry';
import { isNative } from './lib/platform';
import { createRoot } from 'react-dom/client';
import './fonts';
import './index.css';
import App from './App';
import { startAccountSync } from './lib/account';
import { drainLedger, startLedgerDrain } from './lib/ledgerSync';
import { ensureIdentity } from './lib/relay';
import { nudgeIfDue, watchScheduleForNative } from './lib/reminders';

// Body owns no colour: the page ground is `html { background }` in index.css,
// which reads --c-background and so follows the theme. An inline background
// here would be a hardcoded light hex winning over every dark rule — which is
// exactly what it used to be, and what a dark-theme student saw when the page
// overscrolled.
document.body.style.margin = '0';

/**
 * Before anything else that can fail.
 *
 * Above the service-worker registration and the two async kickoffs below it,
 * so a throw in any of them is seen. A complete no-op until a DSN exists.
 */
initTelemetry();

// Offline shell + installability — production only, so dev never fights a
// stale cache.
/**
 * The service worker is a WEB thing, and only a web thing.
 *
 * Inside the native shell every asset is already on the phone — the build
 * output is copied into the app at `cap sync`, so there is nothing for a
 * cache to make faster. What it CAN still do is serve a stale copy of the app
 * after an update, which is the exact failure this file was rewritten to
 * prevent (a0314a2). So it does not run there at all.
 */
if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator) {
  /**
   * A NEW VERSION IS NEVER TAKEN MID-CLASS.
   *
   * The worker no longer calls skipWaiting on install, so a new one sits in
   * "waiting" until this asks for it — and this only asks when the student is
   * somewhere a reload costs nothing.
   *
   * Three things the first version of this got wrong, all found in review:
   *
   *  - A FIRST visit has no controller. When the very first worker activates
   *    and claims the page, controllerchange fires and the old code reloaded —
   *    on a pasted /class/... link that meant reloading inside the room. Only
   *    a page that WAS controlled is a page whose controller changed.
   *  - A worker that installed during a class is already waiting on the next
   *    visit, and "updatefound" never fires again for it. It has to be looked
   *    for directly, or it waits until every tab closes.
   *  - A reload is not free on every screen. The placement test and the quiz
   *    hold their state in memory, so a reload there restarts them from the
   *    first question.
   */
  const SAFE_TO_RELOAD = (): boolean =>
    !/^\/(lesson|class|diagnostic|quiz)\b/.test(window.location.pathname);

  window.addEventListener('load', () => {
    // Captured BEFORE registering: this is what tells a first visit apart
    // from an update.
    const wasControlled = navigator.serviceWorker.controller !== null;

    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        const askWhenSafe = (worker: ServiceWorker | null): void => {
          if (!worker || !SAFE_TO_RELOAD()) return;
          worker.postMessage('take-over');
        };

        // One that installed during an earlier class is sitting here already.
        askWhenSafe(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const incoming = registration.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', () => {
            if (incoming.state === 'installed') askWhenSafe(incoming);
          });
        });

        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          // A first visit has nothing to reload INTO — the page it is showing
          // is already the new version.
          if (!wasControlled || reloaded || !SAFE_TO_RELOAD()) return;
          reloaded = true;
          window.location.reload();
        });
      })
      .catch(() => {
        /* not installable here — the app works fine without it */
      });
  });
}

// The student work follows their account when there is one. With no project
// configured this is a no-op and the app stays exactly the local-only app it
// has always been - nothing is gated behind signing in.
startAccountSync();

/**
 * Drain the interaction ledger whenever this phone has signal.
 *
 * Separate from startAccountSync on purpose. That carries the key-value stores
 * and is last-write-wins per blob; the ledger is an append-only queue and must
 * never be carried that way, or one device's outbox would replace another's.
 *
 * Nothing is gated behind it either: with no project configured, or nobody
 * signed in, the events simply wait on the device. A class must never block on
 * a network.
 */
startLedgerDrain();

/**
 * And give the ledger somewhere to drain TO.
 *
 * The identity used to be created lazily, by the first relay call. A student
 * replaying a cached class with on-device speech never makes one — so they had
 * no account, and everything the class recorded about them waited in the outbox
 * for a network request that was never going to happen.
 *
 * The drain listeners are registered first, above, so nothing is missed while
 * this resolves; this only asks for one more flush once there is a student to
 * attribute the rows to.
 */
void ensureIdentity().then((ok) => {
  if (ok) void drainLedger();
});

/**
 * Put the student's own study schedule on the phone.
 *
 * A no-op in a browser. On a phone it is what actually brings anybody back:
 * the OS fires it with the app closed and no connection, which is the whole
 * retention design working for the first time.
 */
watchScheduleForNative();

/**
 * The nudge, checked once when the app opens.
 *
 * Not a timer: a student who leaves the tab open all evening is one person
 * having one evening, and studySchedule already refuses to fire twice in a
 * day or to speak at all on a day they have studied. On a phone this becomes
 * a Capacitor local notification scheduled ahead of time, which needs no
 * server and no network - the device holds the schedule itself.
 */
void nudgeIfDue().catch(() => {
  // A reminder that fails is a reminder not shown, never a broken app.
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
