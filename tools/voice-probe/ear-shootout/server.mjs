/**
 * THE EAR SHOOTOUT - say something once, read what every ear heard.
 *
 * The ear lab (../ear-lab) asked Aarav to read twenty scripted lines. This asks
 * for nothing but talking: the page runs the BROWSER's own recogniser (the
 * Web Speech API: Google's on Chrome, Apple's on Safari) while it records the
 * same moment, and the clip is sent from here to every server-side ear that is
 * set up. Each ear's words appear side by side; he taps right / half / wrong on
 * each, and the tally per ear is the accuracy on a real voice.
 *
 *   node tools/voice-probe/ear-shootout/server.mjs   then open http://127.0.0.1:5199
 *
 * Server-side ears, each on only when its key is present:
 *   gemini      the ear the app has today (relay vertexHear.ts, same prompt)
 *               needs VERTEX_SA=<path to the service-account json>
 *   groq        whisper-large-v3-turbo                    GROQ_API_KEY
 *   sarvam      saaras v4, and v3 in translit / codemix   SARVAM_API_KEY
 *   elevenlabs  scribe_v2                                  ELEVENLABS_API_KEY
 *   deepgram    nova-3 multilingual                        DEEPGRAM_API_KEY
 * Keys are read from the environment or from tools/voice-probe/ear-shootout/.env.shootout
 * (KEY=value lines; gitignored by the repo's `.env.*` rule). They are never
 * logged and never sent to the page.
 *
 * Everything said is appended to tools/voice-probe/out/shootout/log.jsonl,
 * which is gitignored: it holds a person's voice transcripts.
 * Listens on 127.0.0.1 only.
 */
import '../../prewarm/lib/register.mjs';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const OUT = process.env.SHOOTOUT_OUT ?? join(here, '..', 'out', 'shootout');
const PORT = Number(process.env.PORT ?? 5199);
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- keys
const env = { ...process.env };
const envFile = join(here, '.env.shootout');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------------------------------------------------------------- the ears
const form = (fields, audio, name = 'clip.wav', type = 'audio/wav') => {
  const f = new FormData();
  for (const [k, v] of fields) if (v !== undefined && v !== '') f.append(k, v);
  f.append('file', new Blob([audio], { type }), name);
  return f;
};
const terms = (vocab) => vocab.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

async function must(res) {
  if (res.ok) return res.json();
  throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 220)}`);
}

const engines = [];

const saPath = env.VERTEX_SA ?? join(repo, '.secrets', 'vertex-service-account.json');
if (existsSync(saPath)) {
  const { readServiceAccount, createTokenSource } = await import('../../../packages/relay/src/googleAuth.ts');
  const { hearOnVertex } = await import('../../../packages/relay/src/vertexHear.ts');
  const tokens = createTokenSource(readServiceAccount(readFileSync(saPath, 'utf8')));
  engines.push({
    id: 'gemini',
    label: 'Gemini (jo app mein hai)',
    async hear(audio) {
      const out = await hearOnVertex(new Uint8Array(audio), 'audio/wav', { tokens });
      if (out.status !== 200) throw new Error(`${out.status} ${JSON.stringify(out.response.body).slice(0, 200)}`);
      return { text: out.response.body.value.text };
    },
  });
}

if (env.GROQ_API_KEY) {
  engines.push({
    id: 'groq',
    label: 'Groq Whisper-large-v3-turbo',
    async hear(audio, { lang, vocab }) {
      // Whisper takes its steer from a prompt: Roman Hinglish examples keep the Hindi words in Roman letters.
      const prompt = ['mujhe lagta hai ye energy hai, pata nahi.', ...terms(vocab)].join(' ');
      const body = form(
        [['model', 'whisper-large-v3-turbo'], ['response_format', 'json'], ['temperature', '0'], ['language', lang === 'en' ? 'en' : 'hi'], ['prompt', prompt]],
        audio,
      );
      const j = await must(await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${env.GROQ_API_KEY}` }, body }));
      return { text: j.text };
    },
  });
}

if (env.SARVAM_API_KEY) {
  const sarvam = (id, label, model, mode) => ({
    id,
    label,
    async hear(audio, { lang, vocab }) {
      const body = form(
        [['model', model], ['mode', mode], ['language_code', lang === 'en' ? 'en-IN' : 'hi-IN'], ['keyterms', terms(vocab).join(',')]],
        audio,
      );
      const j = await must(await fetch('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': env.SARVAM_API_KEY }, body }));
      return { text: j.transcript, note: j.language_code };
    },
  });
  engines.push(
    sarvam('sarvam-v4', 'Sarvam saaras v4', 'saaras:v4'),
    sarvam('sarvam-v3-translit', 'Sarvam v3 (Roman script)', 'saaras:v3', 'translit'),
    sarvam('sarvam-v3-codemix', 'Sarvam v3 (codemix)', 'saaras:v3', 'codemix'),
  );
}

if (env.ELEVENLABS_API_KEY) {
  engines.push({
    id: 'elevenlabs',
    label: 'ElevenLabs Scribe v2',
    async hear(audio, { lang, vocab }) {
      const f = form([['model_id', 'scribe_v2'], ['language_code', lang === 'en' ? 'eng' : '']], audio);
      for (const t of terms(vocab)) f.append('keyterms', t);
      const j = await must(await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }, body: f }));
      return { text: j.text, note: j.language_code };
    },
  });
}

if (env.DEEPGRAM_API_KEY) {
  engines.push({
    id: 'deepgram',
    label: 'Deepgram Nova-3 (multi)',
    async hear(audio, { lang, vocab }) {
      const q = new URLSearchParams({ model: 'nova-3', language: lang === 'en' ? 'en-IN' : 'multi', smart_format: 'true' });
      for (const t of terms(vocab)) q.append('keyterm', t);
      const j = await must(
        await fetch(`https://api.deepgram.com/v1/listen?${q}`, { method: 'POST', headers: { authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'content-type': 'audio/wav' }, body: audio }),
      );
      return { text: j.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '' };
    },
  });
}

// ---------------------------------------------------------------- the server
const MAX_BYTES = 12 * 1024 * 1024;
const body = (req) =>
  new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        reject(new Error('too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, type, data) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  };
  const json = (status, value) => send(status, 'application/json; charset=utf-8', JSON.stringify(value));
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', readFileSync(join(here, 'index.html')));
    if (req.method === 'GET' && url.pathname === '/engines') return json(200, engines.map(({ id, label }) => ({ id, label })));
    if (req.method === 'POST' && url.pathname === '/hear') {
      const engine = engines.find((e) => e.id === url.searchParams.get('engine'));
      if (!engine) return json(404, { error: 'no such engine' });
      const t0 = performance.now();
      try {
        const out = await engine.hear(await body(req), { lang: url.searchParams.get('lang') ?? 'hi', vocab: url.searchParams.get('vocab') ?? '' });
        return json(200, { ...out, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        return json(200, { error: String(e?.message ?? e), ms: Math.round(performance.now() - t0) });
      }
    }
    if (req.method === 'POST' && url.pathname === '/log') {
      appendFileSync(join(OUT, 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...JSON.parse((await body(req)).toString('utf8')) }) + '\n');
      return json(200, { ok: true });
    }
    return send(404, 'text/plain', 'not found');
  } catch (e) {
    return send(500, 'text/plain', String(e?.message ?? e));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Ear shootout: http://127.0.0.1:${PORT}`);
  console.log(`server ears on: ${engines.map((e) => e.id).join(', ') || '(none - set VERTEX_SA or a vendor key)'}`);
});
