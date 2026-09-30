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
const times = [];
for (let i = 0; i < SAID.length; i++) {
  const file = `tools/voice-probe/out/clip-${i}.wav`;
  if (!existsSync(file)) continue;
  const t0 = performance.now();
  const res = await fetch(`${RELAY}/api/hear`, { method: 'POST', headers: { ...headers, 'content-type': 'audio/wav' }, body: readFileSync(file) });
  const ms = Math.round(performance.now() - t0);
  const body = await res.json().catch(() => ({}));
  times.push(ms);
  console.log(`hear ${res.status} ${ms} ms  said "${SAID[i]}"  heard "${body.text ?? JSON.stringify(body).slice(0, 120)}"${/[ऀ-ॿ]/.test(body.text ?? '') ? '  <-- DEVANAGARI' : ''}`);
}
times.sort((a, b) => a - b);
if (times.length) console.log(`hear through the relay: median ${times[Math.floor(times.length / 2)]} ms, slowest ${times[times.length - 1]} ms`);

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
