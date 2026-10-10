/**
 * THE EAR LAB - real voice in, so the ear is judged on a real voice.
 *
 * Every accuracy number this project has for the ear was measured on clips a
 * TTS voice read aloud (probe.mjs says so itself: "an optimistic bound, never a
 * verdict on real phones"). This is the missing half: Aarav reads sentences into
 * his own mic, and each one is saved three ways so a bad transcript can be
 * blamed on the right thing:
 *
 *   s<id>-app.wav   what the app's mic sends: echo cancellation + noise
 *                   suppression + auto gain ON (packages/voice createMicCapture)
 *   s<id>-raw.wav   the same moment with all three OFF
 *   s<id>-app.webm  the app-style stream as Opus at 32 kbps, what listenOnce uploads
 *
 *   node tools/voice-probe/ear-lab/server.mjs     then open http://localhost:5190
 *   node tools/voice-probe/ear-bench.mjs --spend  scores every clip on every ear
 *
 * Listens on 127.0.0.1 only. Clips land in tools/voice-probe/out/real/, which is
 * gitignored: it holds a person's voice and must never be committed.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.EAR_LAB_OUT ?? join(here, '..', 'out', 'real');
const PORT = Number(process.env.PORT ?? 5199);
mkdirSync(OUT, { recursive: true });

/** `s03-app.wav`, `s03-raw.wav`, `s03-app.webm` and nothing else gets written. */
const CLIP_NAME = /^s\d{2}-(app|raw)\.(wav|webm)$/;
const MAX_BYTES = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(200, 'text/html; charset=utf-8', readFileSync(join(here, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      const refsFile = join(OUT, 'refs.json');
      const refs = existsSync(refsFile) ? JSON.parse(readFileSync(refsFile, 'utf8')) : {};
      return send(200, 'application/json', JSON.stringify({ refs, files: readdirSync(OUT).filter((f) => CLIP_NAME.test(f)) }));
    }
    if (req.method === 'POST' && url.pathname === '/refs') {
      const refs = JSON.parse((await readBody(req)).toString('utf8'));
      writeFileSync(join(OUT, 'refs.json'), JSON.stringify(refs, null, 2));
      return send(200, 'application/json', '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/clip') {
      const name = url.searchParams.get('name') ?? '';
      if (!CLIP_NAME.test(name)) return send(400, 'text/plain', 'bad name');
      writeFileSync(join(OUT, name), await readBody(req));
      return send(200, 'application/json', '{"ok":true}');
    }
    return send(404, 'text/plain', 'not found');
  } catch (e) {
    return send(500, 'text/plain', String(e?.message ?? e));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Ear lab: http://localhost:${PORT}   (clips go to ${OUT})`);
});
