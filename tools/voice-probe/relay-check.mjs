/**
 * AFTER ANY RELAY DEPLOY: hear and speak through the LIVE relay, the way the
 * app does (an anonymous sign-in, then POSTs with its access token).
 *
 * A mocked Vertex cannot catch a parameter the real model rejects (the TTS
 * model once refused maxOutputTokens and took her voice down), so this sends
 * the clips probe.mjs made (tools/voice-probe/out/clip-*.wav) to /api/hear
 * and one line to /api/speech, and prints status, time and what came back.
 * Each run signs up one anonymous user in production.
 *   node tools/voice-probe/relay-check.mjs --spend
 */
import { readFileSync, existsSync } from 'node:fs';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

if (!process.argv.includes('--spend')) {
  console.log('Calls the production relay (a few paise) and signs up one anonymous user. Re-run with --spend.');
  process.exit(0);
}
const env = readEnvLocal('.env.local');
const SUPABASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const RELAY = env.VITE_RELAY_URL;
if (!SUPABASE || !ANON || !RELAY) throw new Error('.env.local needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_RELAY_URL');

const signup = await fetch(`${SUPABASE}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: '{}',
});
const { access_token: token } = await signup.json();
if (!token) throw new Error(`anonymous sign-up failed: ${signup.status}`);
const headers = { authorization: `Bearer ${token}`, 'x-session-id': `voice-check-${Date.now()}` };

const SAID = [
  'I think breathing gives us energy directly.',
  'Respiration happens in the mitochondria.',
  'Glucose breaks down into pyruvate first.',
  'mujhe lagta hai saans lene se energy milti hai',
  'yeast mein oxygen nahi hoti toh alcohol banta hai',
  'muscles mein lactic acid banta hai isliye cramp aata hai',
  'pata nahi, ek hint do na',
  'haan samajh aa gaya, aage chalo',
];
// Each answer as the WAV and, where probe.mjs's clips were also encoded
// (ffmpeg, 32 kbps Opus), as the compressed recording the app now sends.
for (const [ext, type] of [['wav', 'audio/wav'], ['webm', 'audio/webm']]) {
  const times = [];
  const inside = [];
  for (let i = 0; i < SAID.length; i++) {
    const file = `tools/voice-probe/out/clip-${i}.${ext}`;
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    const t0 = performance.now();
    const res = await fetch(`${RELAY}/api/hear`, { method: 'POST', headers: { ...headers, 'content-type': type }, body: bytes });
    const ms = Math.round(performance.now() - t0);
    const body = await res.json().catch(() => ({}));
    const timing = res.headers.get('server-timing') ?? '';
    const part = (name) => Number(new RegExp(`${name};dur=([0-9]+)`).exec(timing)?.[1] ?? NaN);
    const [verify, claim, model] = [part('verify'), part('claim'), part('model')];
    times.push(ms);
    if (Number.isFinite(model)) inside.push({ verify, claim, model, network: ms - verify - claim - model });
    console.log(`hear ${ext} ${res.status} ${ms} ms (${bytes.length} B; ${timing || 'no server-timing'})  heard "${body.text ?? JSON.stringify(body).slice(0, 120)}"${/[ऀ-ॿ]/.test(body.text ?? '') ? '  <-- DEVANAGARI' : ''}`);
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  if (times.length) {
    console.log(`hear ${ext} through the relay: median ${med(times)} ms, slowest ${Math.max(...times)} ms` +
      (inside.length ? `; median verify ${med(inside.map((x) => x.verify))} ms, claim ${med(inside.map((x) => x.claim))} ms, model ${med(inside.map((x) => x.model))} ms, network+edge ${med(inside.map((x) => x.network))} ms` : ''));
  }
}

for (const [lang, text] of [
  ['en', 'Good thinking. So where in the cell does the glucose start breaking down?'],
  ['hi-en', 'Achha socha! Toh batao, cell ke andar glucose sabse pehle kahan tootta hai?'],
]) {
  const t0 = performance.now();
  const res = await fetch(`${RELAY}/api/speech`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ text, lang, format: 'pcm' }),
  });
  let first, bytes = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (first === undefined && value.byteLength) first = Math.round(performance.now() - t0);
    bytes += value.byteLength;
  }
  console.log(`speech [${lang}] ${res.status} ${res.headers.get('content-type')}  first audio ${first} ms, ${(bytes / 48000).toFixed(1)} s of audio, total ${Math.round(performance.now() - t0)} ms`);
}
