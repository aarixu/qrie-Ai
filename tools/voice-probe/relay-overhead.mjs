/**
 * WHERE THE RELAY'S TIME GOES (Aarav, 2026-09-30: "relay ka 0.7 sec bhi fix
 * karo"). Times, against the live relay, requests that stop at each stage:
 *   - no Authorization header  -> refused before anything: the edge round trip;
 *   - /api/hear with an empty body -> verified and claimed, then refused (400):
 *     the round trip plus identity and the meter;
 *   - /api/hear with a real answer -> everything, including Vertex.
 * Signs up one anonymous user in production; the empty-body calls each claim
 * the hear relay's units for a zero-second clip.
 *   node tools/voice-probe/relay-overhead.mjs --spend
 */
import { readFileSync } from 'node:fs';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

if (!process.argv.includes('--spend')) {
  console.log('Calls the production relay and signs up one anonymous user. Re-run with --spend.');
  process.exit(0);
}
const env = readEnvLocal('.env.local');
const RELAY = env.VITE_RELAY_URL;
const signup = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: '{}',
});
const { access_token: token } = await signup.json();
const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
console.log('access token header:', header);

const clip = readFileSync('tools/voice-probe/out/clip-3.wav');
const auth = { authorization: `Bearer ${token}`, 'x-session-id': `overhead-${Date.now()}` };
const stages = {
  'no auth (edge round trip)': () => fetch(`${RELAY}/api/hear`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: clip }),
  'empty body (+ identity + meter)': () => fetch(`${RELAY}/api/hear`, { method: 'POST', headers: { ...auth, 'content-type': 'audio/wav' }, body: new Uint8Array() }),
  'real answer (+ Vertex)': () => fetch(`${RELAY}/api/hear`, { method: 'POST', headers: { ...auth, 'content-type': 'audio/wav' }, body: clip }),
};
for (const [label, run] of Object.entries(stages)) {
  const times = [];
  let status;
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    const res = await run();
    await res.arrayBuffer();
    status = res.status;
    times.push(Math.round(performance.now() - t0));
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`${label}: status ${status}, median ${sorted[4]} ms, min ${sorted[0]}, max ${sorted[7]}  [${times.join(', ')}]`);
}
