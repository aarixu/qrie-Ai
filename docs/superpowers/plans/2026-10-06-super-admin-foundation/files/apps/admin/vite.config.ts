import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Not 5173 (the tutor), 5180 (teachers) or 5181 (students).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5182, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@ai-tutor/admin-client': path.resolve(import.meta.dirname, '../../packages/admin-client/src/index.ts'),
    },
  },
});
