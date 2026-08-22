import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

document.body.style.margin = '0';
document.body.style.background = '#0d1411';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
