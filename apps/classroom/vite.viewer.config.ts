import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import base from './vite.config.ts';

/**
 * THE VIEWER'S BUILD: viewer.html alone, with no relay and nothing else of the
 * app, for a static host. A saved class goes beside it as `class.json`.
 *
 *   VIEWER_PUBLIC=<folder with class.json> VIEWER_OUT=<folder> \
 *     npx vite build --config apps/classroom/vite.viewer.config.ts
 *
 * The package aliases are the app's own, read from vite.config.ts, so the board
 * here is the board the classroom draws.
 */
export default defineConfig((env) => {
  const app = (base as unknown as (e: typeof env) => { resolve: { alias: Record<string, string> } })(env);
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './',
    plugins: [react()],
    resolve: { alias: app.resolve.alias },
    publicDir: process.env.VIEWER_PUBLIC ?? false,
    build: {
      outDir: process.env.VIEWER_OUT ?? fileURLToPath(new URL('./dist-viewer', import.meta.url)),
      emptyOutDir: true,
      rollupOptions: { input: { index: fileURLToPath(new URL('./viewer.html', import.meta.url)) } },
    },
  };
});
