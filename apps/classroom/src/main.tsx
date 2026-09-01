import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { startAccountSync } from './lib/account';

// Body owns no colour: the page ground is `html { background }` in index.css,
// which reads --c-background and so follows the theme. An inline background
// here would be a hardcoded light hex winning over every dark rule — which is
// exactly what it used to be, and what a dark-theme student saw when the page
// overscrolled.
document.body.style.margin = '0';

// Offline shell + installability — production only, so dev never fights a
// stale cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        /**
         * A new version is never taken mid-class.
         *
         * The worker no longer calls skipWaiting on its own, so a waiting
         * version sits there until this asks for it — and this only asks when
         * the student is on a screen where a reload costs nothing. Anywhere
         * else it waits, and the next ordinary visit picks it up.
         */
        registration.addEventListener('updatefound', () => {
          const incoming = registration.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', () => {
            if (incoming.state !== 'installed' || !navigator.serviceWorker.controller) return;
            const inAClass = /^\/(lesson|class)\//.test(window.location.pathname);
            if (inAClass) return;
            incoming.postMessage('take-over');
          });
        });

        // The new worker is in charge; reload once so the page matches it.
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
