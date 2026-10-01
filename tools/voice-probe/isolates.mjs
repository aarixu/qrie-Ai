/**
 * ARE EDGE ISOLATES REUSED? Sends the same small answer twelve times in a row
 * and prints, per call, the Server-Timing split and the execution id, so a
 * per-isolate cache (keys, tokens, verified sign-ins) can be seen working or
 * not. Signs up one anonymous user.
 *   node tools/voice-probe/isolates.mjs --spend
 */
import { readFileSync } from 'node:fs';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

if (!process.argv.includes('--spend')) {
  console.log('Calls the production relay and signs up one anonymous user. Re-run with --spend.');
  process.exit(0);
}
const env = readEnvLocal('.env.local');
const signup = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: '{}',
});
const { access_token: token } = await signup.json();
const clip = readFileSync('tools/voice-probe/out/clip-7.webm');
for (let i = 0; i < 12; i++) {
  const t0 = performance.now();
  const res = await fetch(`${env.VITE_RELAY_URL}/api/hear`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/webm' },
    body: clip,
  });
  await res.arrayBuffer();
  console.log(
    `${String(Math.round(performance.now() - t0)).padStart(5)} ms  ${res.headers.get('server-timing')}  exec ${res.headers.get('x-deno-execution-id')?.slice(0, 8)}`,
  );
}
