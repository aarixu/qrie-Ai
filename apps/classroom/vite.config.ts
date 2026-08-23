import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Lessons are data, served as static files: /index.json, /<lesson>/lesson.json
  publicDir: fileURLToPath(new URL('../../content', import.meta.url)),
  resolve: {
    alias: {
      '@ai-tutor/lesson-format': pkg('lesson-format'),
      '@ai-tutor/stage': pkg('stage'),
      '@ai-tutor/player': pkg('player'),
      '@ai-tutor/doubt-session': pkg('doubt-session'),
      '@ai-tutor/syllabus': pkg('syllabus'),
      '@ai-tutor/knowledge-graph': pkg('knowledge-graph'),
      '@ai-tutor/diagnostic': pkg('diagnostic'),
      '@ai-tutor/persona': pkg('persona'),
      '@ai-tutor/voice': pkg('voice'),
    },
  },
  server: { port: 5173 },
});
