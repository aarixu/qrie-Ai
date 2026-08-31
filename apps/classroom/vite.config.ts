import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
/**
 * `HTTPS=1 npm run dev -- --host` — a self-signed cert, for testing on a phone.
 *
 * A phone on the LAN reaching this server over plain http is not a SECURE
 * CONTEXT, and a browser withholds most of what this product now depends on
 * there: WebGPU, the Cache API, the microphone, even the device-memory
 * reading. Testing that way measures the protocol rather than the phone, which
 * cost a whole round of device measurements before anyone noticed.
 *
 * Kept, rather than thrown away with the bench that needed it, because the
 * phone is the primary device and testing on one is not a one-off.
 */
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

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
/**
 * HER VOICE, PIPED THROUGH AS IT IS MADE.
 *
 * A GET, deliberately: the browser's own `<audio>` element can stream a URL,
 * and streaming is the whole point. Measured on a real class line, the first
 * byte arrives at 0.36 s while the full 8.4 seconds of speech takes 2.5 to
 * generate — so playing it as it arrives starts her almost at once, and
 * downloading it first would have cost every line two and a half seconds for
 * nothing.
 *
 * The bytes are piped, never buffered. Buffering here would undo the streaming
 * this endpoint exists for.
 *
 * Dev only, like the others: in production this is a real backend route with
 * auth and a per-student budget.
 */
function speechRelay(key: string): Plugin {
  const DEFAULT_MODEL = 'deepgram/aura-2';
  return {
    name: 'curie-speech-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/speech', (req, res) => {
        const fail = (code: number, message: string) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { message } }));
        };
        if (!key) return fail(503, 'No OPENROUTER_API_KEY in .env.local');

        const asked = new URL(req.url ?? '', 'http://localhost');
        const text = asked.searchParams.get('text')?.trim();
        if (!text) return fail(400, 'nothing to say');

        void fetch('https://openrouter.ai/api/v1/audio/speech', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
            'HTTP-Referer': 'https://github.com/aarixu/curie',
            'X-Title': 'Curie',
          },
          body: JSON.stringify({
            model: asked.searchParams.get('model') ?? DEFAULT_MODEL,
            input: text,
            // Named, and the same every line. Aura refuses to speak without
            // one — "An explicit voice is required for this TTS provider" —
            // which is the consistency guarantee stated as an error.
            ...(asked.searchParams.get('voice')
              ? { voice: asked.searchParams.get('voice') }
              : {}),
            // Not raw PCM: an audio element can play mp3 straight from the
            // wire, and it is a tenth of the bytes.
            response_format: 'mp3',
          }),
        })
          .then(async (upstream) => {
            if (!upstream.ok || !upstream.body) {
              const why = await upstream.text().catch(() => '');
              return fail(upstream.status, `speech ${upstream.status}: ${why.slice(0, 200)}`);
            }
            res.statusCode = 200;
            res.setHeader('content-type', upstream.headers.get('content-type') ?? 'audio/mpeg');
            // Piped as it arrives. Collecting it first would defeat the point.
            Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
          })
          .catch((e: unknown) => fail(502, String(e)));
      });
    },
  };
}

/**
 * HER EAR. The student's spoken answer, piped to a transcriber.
 *
 * Raw audio bytes in the POST body (the browser records a webm/opus blob),
 * wrapped into the multipart form OpenRouter's transcription endpoint expects.
 * nova-3 was measured against her own synthesised speech: word-perfect in
 * 0.8s. Dev only, like every relay here.
 */
function hearRelay(key: string): Plugin {
  return {
    name: 'curie-hear-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/hear', (req, res) => {
        const fail = (code: number, message: string) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { message } }));
        };
        if (req.method !== 'POST') return fail(405, 'POST only');
        if (!key) return fail(503, 'No OPENROUTER_API_KEY in .env.local');

        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const audio = Buffer.concat(chunks);
          if (audio.length < 200) return fail(400, 'no audio to hear');
          const form = new FormData();
          form.set('model', 'deepgram/nova-3');
          form.set(
            'file',
            new Blob([new Uint8Array(audio)], {
              type: req.headers['content-type'] ?? 'audio/webm',
            }),
            'answer.webm',
          );
          void fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
            method: 'POST',
            headers: { authorization: `Bearer ${key}` },
            body: form,
          })
            .then(async (upstream) => {
              res.statusCode = upstream.status;
              res.setHeader('content-type', 'application/json');
              res.end(await upstream.text());
            })
            .catch((e: unknown) => fail(502, String(e)));
        });
      });
    },
  };
}

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
          // Cap max_tokens when the caller left it open. OpenRouter
          // pre-authorises the model's FULL context (65k) per request, so a
          // low balance 402s even though the actual reply costs a fraction
          // of it. No reply in this app comes near 24k tokens.
          let body = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = JSON.parse(body) as { max_tokens?: number };
            if (parsed.max_tokens === undefined) {
              parsed.max_tokens = 24_000;
              body = JSON.stringify(parsed);
            }
          } catch {
            // Not JSON — forward untouched and let upstream complain.
          }
          void fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${key}`,
              'HTTP-Referer': 'https://github.com/aarixu/curie',
              'X-Title': 'Curie',
            },
            body,
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

/**
 * The first live class on a topic, written down.
 *
 * A cold topic costs most of a minute and a few rupees to prepare; the second
 * student on it should pay neither. So the class that was just taught is
 * written into `content/` in exactly the shape the hand-authored lessons have,
 * and the catalogue's join by `topicRef` makes that topic warm for everyone —
 * no new lookup, no cache to invalidate, and the content lint in the test
 * suite checks the saved class the same way it checks the authored ones.
 *
 * WHAT to write is decided by `saveable` in @ai-tutor/class-prep, which is
 * pure and tested. This only puts bytes on a disk.
 *
 * Dev only, deliberately: in production this is a real backend route with auth
 * and a per-student budget, not a plugin.
 */
function classWriter(): Plugin {
  const root = fileURLToPath(new URL('../../content', import.meta.url));
  return {
    name: 'curie-class-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/class', (req, res) => {
        const fail = (code: number, message: string) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { message } }));
        };
        if (req.method !== 'POST') return fail(405, 'POST only');

        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const saved = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              id: string;
              entry: { id: string };
              files: { path: string; body: string; encoding: 'utf8' | 'base64' }[];
            };
            // A folder name is a path, and this one arrives over HTTP.
            if (!/^[a-z0-9][a-z0-9-]*$/.test(saved.id)) return fail(400, 'bad class id');

            const dir = path.join(root, saved.id);
            // A topic is only cold once. Refusing rather than overwriting means
            // a second student cannot replace the recording a first one made.
            if (fs.existsSync(dir)) return fail(409, `${saved.id} already exists`);

            for (const file of saved.files) {
              if (file.path.includes('..')) return fail(400, 'bad file path');
              const full = path.join(dir, file.path);
              fs.mkdirSync(path.dirname(full), { recursive: true });
              fs.writeFileSync(full, Buffer.from(file.body, file.encoding));
            }

            const indexPath = path.join(root, 'index.json');
            const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
              lessons: { id: string }[];
            };
            if (!index.lessons.some((l) => l.id === saved.entry.id)) {
              index.lessons.push(saved.entry as { id: string });
              fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
            }

            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, id: saved.id }));
          } catch (e) {
            fail(500, String(e));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read from the repo root, where .env.local lives beside the tools that share it.
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');

  return {
    plugins: [
      react(),
      llmRelay(env.OPENROUTER_API_KEY ?? ''),
      speechRelay(env.OPENROUTER_API_KEY ?? ''),
      hearRelay(env.OPENROUTER_API_KEY ?? ''),
      iconRelay(),
      classWriter(),
      ...(env.HTTPS === '1' ? [basicSsl()] : []),
    ],
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
    server: {
      port: 5173,
      /**
       * Vite refuses requests whose Host it does not recognise, which is the
       * right default and exactly wrong for a tunnel: a public URL forwards
       * its own hostname and every page comes back "Blocked request".
       *
       * Dev only — this config's `server` block does not exist in a build —
       * and the tunnel itself is the thing that decides who can reach this,
       * not the host header.
       */
      allowedHosts: true,
    },
  };
});
