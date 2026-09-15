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
      '@ai-tutor/ledger': pkg('ledger'),
      '@ai-tutor/learner-model': pkg('learner-model'),
      '@ai-tutor/tutor-judge': pkg('tutor-judge'),
      '@ai-tutor/persona': pkg('persona'),
      '@ai-tutor/pedagogy': pkg('pedagogy'),
      '@ai-tutor/voice': pkg('voice'),
      '@ai-tutor/teacher-clone': pkg('teacher-clone'),
      '@ai-tutor/relay': pkg('relay'),
      '@ai-tutor/safety': pkg('safety'),
      '@ai-tutor/class-prep': pkg('class-prep'),
      '@ai-tutor/board-layout': pkg('board-layout'),
      '@ai-tutor/graphics': pkg('graphics'),
      '@ai-tutor/action-player': pkg('action-player'),
      '@ai-tutor/maic-adapter': pkg('maic-adapter'),
    },
  },
  test: {
    environment: 'jsdom',
    /**
     * THIRTY SECONDS, NOT FIVE.
     *
     * The default failed four different files in one afternoon — the PDF
     * reader, the sign-up screen, and two others — every one of which passed
     * in seconds when run alone. None of them was a real failure; the suite
     * runs 194 files under jsdom and several load something genuinely heavy
     * (pdf.js, the syllabus maps), so under load a five-second budget is a
     * coin toss.
     *
     * A suite that goes red on a busy machine is worse than a slow one: it
     * teaches whoever runs it to read red as noise, and then the next REAL
     * failure gets the same shrug. Raising the ceiling costs nothing — a test
     * that genuinely hangs still fails, thirty seconds later.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      'packages/*/tests/**/*.test.{ts,tsx}',
      'apps/*/tests/**/*.test.{ts,tsx}',
      'tools/*/tests/**/*.test.ts',
    ],
  },
});
