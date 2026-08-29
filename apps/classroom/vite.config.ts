import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));

/**
 * A dev-only relay to the LLM provider.
 *
 * The canvas lab prepares a class live, which means the browser needs a model —
 * but putting the key in a `VITE_` variable would bake it into the bundle for
 * anyone who opens devtools. The key stays here, in the dev server, and the
 * browser posts to a same-origin path that knows nothing.
 *
 * Dev only, deliberately: in production this is a real backend route with auth
 * and a per-student budget, not a plugin.
 */
function llmRelay(key: string): Plugin {
  return {
    name: 'curie-llm-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/llm', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        if (!key) {
          res.statusCode = 503;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { message: 'No OPENROUTER_API_KEY in .env.local' } }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          void fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${key}`,
              'HTTP-Referer': 'https://github.com/aarixu/curie',
              'X-Title': 'Curie',
            },
            body: Buffer.concat(chunks).toString('utf8'),
          })
            .then(async (upstream) => {
              res.statusCode = upstream.status;
              res.setHeader('content-type', 'application/json');
              res.end(await upstream.text());
            })
            .catch((e: unknown) => {
              res.statusCode = 502;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: { message: String(e) } }));
            });
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read from the repo root, where .env.local lives beside the tools that share it.
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');

  return {
    plugins: [react(), llmRelay(env.OPENROUTER_API_KEY ?? '')],
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
        '@ai-tutor/pedagogy': pkg('pedagogy'),
        '@ai-tutor/voice': pkg('voice'),
        '@ai-tutor/class-prep': pkg('class-prep'),
        '@ai-tutor/action-player': pkg('action-player'),
        '@ai-tutor/maic-adapter': pkg('maic-adapter'),
      },
    },
    server: { port: 5173 },
  };
});
