import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  // 5173 is the classroom app's, 5180 the teacher app's.
  server: { port: 5181, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@ai-tutor/lms-client': path.resolve(import.meta.dirname, '../../packages/lms-client/src/index.ts'),
      '@ai-tutor/lms-report': path.resolve(import.meta.dirname, '../../packages/lms-report/src/index.ts'),
    },
  },
})
