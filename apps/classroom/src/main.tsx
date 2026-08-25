import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

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
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* not installable here — the app works fine without it */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
