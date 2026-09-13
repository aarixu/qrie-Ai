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
import {
  cacheVerifier,
  createMemoryLedger,
  createSupabaseVerifier,
  createTokenSource,
  readServiceAccount,
  handleRelay,
  sendRelayResponse,
  toRelayRequest,
  transcribeViaFormData,
  type Gate,
  type UsageEvent,
} from '../../packages/relay/src/index.ts';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));

/**
 * The three OpenRouter relays, in dev — the SAME code the Edge Function runs.
 *
 * Not "the same logic": literally `handleRelay`, with a Node adapter around
 * it. That includes the lock and the meter, which is the part that matters —
 * a gate only exercised in production is a gate nobody has tried. A developer
 * who is not signed in gets the same 401 a stranger would, which is the honest
 * answer and takes one tap to fix.
 *
 * The two differences from production are both stated out loud:
 *   - the meter counts in a Map, because there is no Postgres on a laptop;
 *   - the ticket secret is a fixed dev string, so a restart does not invalidate
 *     a ticket the open page is still using.
 */
function openRouterRelays(key: string, supabaseUrl: string, anonKey: string): Plugin {
  const gate: Gate = {
    verify: cacheVerifier(createSupabaseVerifier(supabaseUrl, anonKey)),
    ledger: createMemoryLedger(),
    ticketSecret: 'dev-only-ticket-secret',
  };
  /**
   * The same Google credential the deployed relay uses, when there is one.
   *
   * Read from a FILE here rather than an env var, because that is the shape it
   * arrives in and pasting a PEM through a shell is how its newlines get lost.
   * Absent: the dev relays talk to OpenRouter exactly as they always have, so
   * nobody needs a Google account to run the app.
   */
  const accountPath =
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? '.secrets/vertex-service-account.json';
  // Relative to THIS file, not to the working directory. `npm run dev` from
  // the repo root and `npx vite` from apps/classroom have different cwds, and
  // the second one is how this was first tested.
  const accountFile = path.resolve(fileURLToPath(new URL('../..', import.meta.url)), accountPath);

  let vertex: { tokens: TokenSource } | undefined;
  if (fs.existsSync(accountFile)) {
    try {
      vertex = { tokens: createTokenSource(readServiceAccount(fs.readFileSync(accountFile, 'utf8'))) };
    } catch (e) {
      // Said out loud. A silent catch here cost a debugging round already:
      // the file was there, the path was right, and two missing imports made
      // it look exactly like a missing service account.
      console.error(`  relays: ${accountFile} is unusable — ${(e as Error).message}`);
    }
  }

  const deps = {
    key,
    gate,
    ...(vertex ? { vertex } : {}),
    transcribe: (model: string, contentType: string, audio: Uint8Array) =>
      transcribeViaFormData(key, model, contentType, audio),
    // On a laptop the accounting goes to the terminal. One line per call,
    // the same shape Postgres receives in production, so a developer sees
    // what a class spends while building it rather than on the bill.
    usage: {
      async record(e: UsageEvent) {
        const q = [
          e.promptTokens !== undefined ? `in=${e.promptTokens}` : '',
          e.outputTokens !== undefined ? `out=${e.outputTokens}` : '',
          e.thoughtTokens !== undefined ? `think=${e.thoughtTokens}` : '',
          e.images ? `images=${e.images}` : '',
          e.characters !== undefined ? `chars=${e.characters}` : '',
          e.audioBytes !== undefined ? `audio=${(e.audioBytes / 32000).toFixed(1)}s` : '',
          e.bytes !== undefined ? `bytes=${e.bytes}` : '',
        ].filter(Boolean).join(' ');
        console.log(`  usage: ${e.relay} ${e.model ?? '-'} ${q}${e.sessionId ? ` session=${e.sessionId.slice(0, 8)}` : ''}`);
      },
    },
  };
  console.log(
    vertex
      ? '  relays: models on Vertex, speech on OpenRouter'
      : '  relays: everything on OpenRouter (no service account file found)',
  );

  return {
    name: 'curie-openrouter-relays',
    apply: 'serve',
    configureServer(server) {
      for (const route of ['/api/llm', '/api/speech', '/api/hear', '/api/ticket']) {
        server.middlewares.use(route, (req, res) => {
          void (async () => {
            const relayRequest = await toRelayRequest(req);
            // Vite strips the mounted prefix from req.url, so the path the
            // relay sees would be "/" and match nothing. Put it back.
            const url = `${route}${relayRequest.url === '/' ? '' : relayRequest.url}`;
            await sendRelayResponse(res, await handleRelay({ ...relayRequest, url }, deps));
          })();
        });
      }
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
      openRouterRelays(
        env.OPENROUTER_API_KEY ?? '',
        env.VITE_SUPABASE_URL ?? '',
        env.VITE_SUPABASE_ANON_KEY ?? '',
      ),
      iconRelay(),
      classWriter(),
      ...(env.HTTPS === '1' ? [basicSsl()] : []),
    ],
    build: {
      rollupOptions: {
        output: {
          /**
           * THE OUTCOME MAPS ARE DATA, AND DATA GETS ITS OWN FILE.
           *
           * packages/knowledge-graph/data is 406 kB of JSON — three maps and
           * their probe banks — imported with a glob that has to be eager,
           * because a placement test cannot choose its first question from a
           * map that is still arriving.
           *
           * Rollup had been splitting it out on its own, and that was luck
           * rather than design: it was shared between an eager screen and two
           * lazy ones, so the heuristic gave it a chunk. Adding one small
           * module that the entry and a lazy route both import was enough to
           * change its mind, and the entry went from 129 kB gzipped to 200 —
           * a 70 kB regression on the ₹10,000 Android this product is for,
           * caused by a file with nothing to do with lessons.
           *
           * Naming it is what stops that happening again. Two things it buys
           * and one it does not:
           *
           *   - the entry stays the app's own code, so a Rollup heuristic can
           *     no longer decide otherwise;
           *   - the curriculum caches on its own, so shipping a bug fix does
           *     not make every student re-download 78 kB of maps that did not
           *     change.
           *
           * What it does NOT buy is deferral. lib/outcomeLookup is imported by
           * the classroom, which is eager, so this chunk is still modulepreloaded
           * on first load. Making it genuinely lazy means outcomeLookup becoming
           * async, which is a change to the classroom and not to a build config.
           */
          manualChunks(id) {
            if (id.includes('knowledge-graph') && id.endsWith('.json')) return 'outcome-maps';
            return undefined;
          },
        },
      },
    },
    /**
     * ONE ENVIRONMENT FILE, AT THE REPO ROOT.
     *
     * Vite defaults this to the project root — apps/classroom — while the
     * line above already reads the REPO root for OPENROUTER_API_KEY. Two
     * files, and the app silently read only one of them: VITE_SUPABASE_URL
     * and VITE_SUPABASE_ANON_KEY live at the root, so `supabase()` returned
     * null and the cloud was quietly switched off. Harmless while that only
     * meant no sync; fatal the moment every relay call started needing a
     * session token, because a null client cannot mint one and every class
     * fails with a 401.
     *
     * One file. The tools and the app read the same keys from the same place,
     * and there is no second file for a value to hide in.
     */
    envDir: fileURLToPath(new URL('../..', import.meta.url)),
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
        '@ai-tutor/ledger': pkg('ledger'),
        '@ai-tutor/tutor-judge': pkg('tutor-judge'),
        '@ai-tutor/persona': pkg('persona'),
        '@ai-tutor/pedagogy': pkg('pedagogy'),
        '@ai-tutor/voice': pkg('voice'),
        '@ai-tutor/class-prep': pkg('class-prep'),
        '@ai-tutor/safety': pkg('safety'),
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
