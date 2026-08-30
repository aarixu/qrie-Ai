import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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

/**
 * Icons, served from the bundled sets.
 *
 * The Iconify package is 443 MB and must never reach a browser, so the lookup
 * lives here and the page asks for the handful of nouns one lesson needs.
 * Sets are tried in order: a friendly colour icon first, a line icon after,
 * because a school board wants a picture a child recognises before it wants a
 * tidy glyph.
 *
 * Dev only. In production this is a small static index built at deploy time.
 */
function iconRelay(): Plugin {
  const require = createRequire(import.meta.url);
  const PREFERRED = ['noto', 'fluent-emoji', 'ph', 'tabler'];
  let sets: unknown[] | null = null;

  const load = () => {
    if (sets) return sets;
    sets = PREFERRED.map((prefix) => {
      const json = require(`@iconify/json/json/${prefix}.json`);
      return {
        prefix,
        width: json.width ?? 24,
        height: json.height ?? 24,
        icons: json.icons,
        categories: json.categories,
      };
    });
    return sets;
  };

  return {
    name: 'curie-icon-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/icons', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        // One parameter per noun: no separator means no noun can be split
        // by one. The comma-joined list tore "salt, sugar" into two.
        const nouns = url.searchParams.getAll('noun').filter(Boolean);
        res.setHeader('content-type', 'application/json');
        try {
          // Resolution itself lives in @ai-tutor/graphics; this only feeds it.
          // Every plausible candidate, not one guess: which meaning of "tank"
          // a lesson wants is decided by the lesson, and the page has a model
          // to ask. The pencilled circle is always included as the last resort.
          const { candidatesFor, pencilGlyph } = require('../../packages/graphics/src/resolve.ts');
          const out: Record<string, unknown> = {};
          for (const noun of nouns) {
            out[noun] = {
              candidates: candidatesFor(noun, load(), 8),
              pencil: pencilGlyph(noun),
            };
          }
          res.end(JSON.stringify(out));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { message: String(e) } }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read from the repo root, where .env.local lives beside the tools that share it.
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');

  return {
    plugins: [react(), llmRelay(env.OPENROUTER_API_KEY ?? ''), iconRelay()],
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
      '@ai-tutor/board-layout': pkg('board-layout'),
      '@ai-tutor/graphics': pkg('graphics'),
        '@ai-tutor/action-player': pkg('action-player'),
        '@ai-tutor/maic-adapter': pkg('maic-adapter'),
      },
    },
    server: { port: 5173 },
  };
});
