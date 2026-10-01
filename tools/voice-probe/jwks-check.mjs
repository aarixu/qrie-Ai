/**
 * THE LOCAL TOKEN CHECK AGAINST THE REAL PROJECT, before it is deployed.
 *
 * Signs up one anonymous user on the live project (as the app does), then
 * checks that access token with createJwksVerifier against the project's own
 * published keys, and times the check against the network one it replaces.
 * A tampered copy of the token must be refused. Creates one anonymous user.
 *   node tools/voice-probe/jwks-check.mjs --spend
 */
import '../prewarm/lib/register.mjs';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

if (!process.argv.includes('--spend')) {
  console.log('Signs up one anonymous user on the live project. Re-run with --spend.');
  process.exit(0);
}
const { createJwksVerifier, createSupabaseVerifier } = await import('../../packages/relay/src/auth.ts');
const env = readEnvLocal('.env.local');
const SUPABASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;

const signup = await fetch(`${SUPABASE}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: '{}',
});
const { access_token: token, user } = await signup.json();
console.log('signed up anonymous user', user?.id ? 'ok' : 'FAILED');

let fellBack = 0;
const network = createSupabaseVerifier(SUPABASE, ANON);
const local = createJwksVerifier(SUPABASE, {
  fallback: async (h) => {
    fellBack++;
    return network(h);
  },
});

const t0 = performance.now();
const first = await local(`Bearer ${token}`);
const firstMs = Math.round(performance.now() - t0);
const times = [];
for (let i = 0; i < 10; i++) {
  const t = performance.now();
  await local(`Bearer ${token}`);
  times.push(performance.now() - t);
}
const netTimes = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  await network(`Bearer ${token}`);
  netTimes.push(performance.now() - t);
}
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(1);
console.log('local check:', JSON.stringify(first), `| user id matches: ${first.ok && first.user.userId === user.id}`);
console.log(`first check ${firstMs} ms (fetches the keys), then median ${med(times)} ms; network check median ${med(netTimes)} ms; fell back ${fellBack} times`);

const [h, p, s] = token.split('.');
const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, sub: '00000000-0000-0000-0000-000000000000' })).toString('base64url')}.${s}`;
console.log('tampered token:', JSON.stringify(await local(`Bearer ${forged}`)));
console.log('anon key itself:', JSON.stringify(await local(`Bearer ${ANON}`)));
