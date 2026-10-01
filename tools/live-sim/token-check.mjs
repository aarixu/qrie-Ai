/**
 * AFTER A RELAY DEPLOY: does POST /api/live-token mint a token that opens a
 * real Gemini Live session? Signs up one anonymous user (as the app does),
 * mints one token (claims one Live session's units against that user), opens
 * the socket with it, waits for setupComplete, and closes without speaking —
 * no turn is generated, so no Live tokens are billed (UNVERIFIED that an idle
 * setup bills nothing).
 *   node tools/live-sim/token-check.mjs --spend
 */
import WebSocket from 'ws';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

if (!process.argv.includes('--spend')) {
  console.log('Claims one Live session on the production relay and signs up one anonymous user. Re-run with --spend.');
  process.exit(0);
}
const env = readEnvLocal('.env.local');
const signup = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: '{}',
});
const { access_token: auth } = await signup.json();

const t0 = performance.now();
const res = await fetch(`${env.VITE_RELAY_URL}/api/live-token`, {
  method: 'POST',
  headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
  body: '{}',
});
const body = await res.json().catch(() => ({}));
const mintMs = Math.round(performance.now() - t0);
const shape = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, k === 'token' ? `<${String(v).length} chars>` : v]));
console.log(`mint ${res.status} in ${mintMs} ms:`, JSON.stringify(shape));
if (res.status !== 200 || !body.token || !body.url) process.exit(1);

const t1 = performance.now();
await new Promise((resolve) => {
  const ws = new WebSocket(`${body.url}?access_token=${encodeURIComponent(body.token)}`);
  const done = (msg) => {
    console.log(msg);
    try { ws.close(); } catch {}
    resolve();
  };
  const timer = setTimeout(() => done('no setupComplete within 15 s'), 15_000);
  ws.on('open', () => {
    ws.send(JSON.stringify({
      setup: {
        model: `models/${body.model}`,
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: 'You are Meera, a tutor. Say nothing until asked.' }] },
      },
    }));
  });
  ws.on('message', (data) => {
    const text = data.toString();
    if (text.includes('setupComplete')) {
      clearTimeout(timer);
      done(`setupComplete in ${Math.round(performance.now() - t1)} ms on ${body.model}`);
    }
  });
  ws.on('close', (code, reason) => { clearTimeout(timer); done(`closed ${code} ${reason}`); });
  ws.on('error', (e) => { clearTimeout(timer); done(`error ${e.message}`); });
});
