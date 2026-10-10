import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../fonts';
import '../index.css';
import { Board } from '../screens/CanvasLab';
import { readSavedClass, type SavedClass } from './savedClass';

/**
 * THE VIEWER: one prepared class, played from `class.json` beside this page.
 *
 * Built on its own (vite.viewer.config.ts) so a class the lab saved can be put
 * on a static host and opened on a phone: no relay, no model, no sign-in.
 */
function Viewer() {
  const [made, setMade] = useState<SavedClass | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}class.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`class.json: ${res.status}`))))
      .then((json) => {
        const saved = readSavedClass(json);
        if (saved) setMade(saved);
        else setError('This file is not a class.');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 12, background: '#fff', color: '#1b1f24', minHeight: '100vh', fontFamily: 'Quicksand, system-ui, sans-serif' }}>
      {made ? (
        <>
          <h1 style={{ fontSize: 16, margin: '4px 0 8px' }}>{made.lesson.title}</h1>
          <p style={{ color: '#5b6672', fontSize: 13, margin: '0 0 8px' }}>
            Tap Play to hear the class. Turn the phone sideways for a bigger board.
          </p>
          <Board lesson={made.lesson} assets={made.assets} />
        </>
      ) : (
        <p style={{ color: error ? '#b91c1c' : '#5b6672' }}>{error ?? 'Loading the class…'}</p>
      )}
    </main>
  );
}

document.body.style.margin = '0';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Viewer />
  </StrictMode>,
);
