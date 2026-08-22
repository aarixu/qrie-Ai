import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

document.body.style.margin = '0';
document.body.style.background = '#0f1116';

// Placeholder — replaced by the real Classroom UI during app assembly.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ color: '#cfd4dc', font: '14px system-ui', padding: 24 }}>AI Tutor — assembling…</div>
  </StrictMode>,
);
