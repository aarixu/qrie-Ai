import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src`, import.meta.url));

export default defineConfig({
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
      '@ai-tutor/pedagogy': pkg('pedagogy'),
      '@ai-tutor/voice': pkg('voice'),
      '@ai-tutor/class-prep': pkg('class-prep'),
      '@ai-tutor/board-layout': pkg('board-layout'),
      '@ai-tutor/action-player': pkg('action-player'),
      '@ai-tutor/maic-adapter': pkg('maic-adapter'),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'packages/*/tests/**/*.test.{ts,tsx}',
      'apps/*/tests/**/*.test.{ts,tsx}',
      'tools/*/tests/**/*.test.ts',
    ],
  },
});
