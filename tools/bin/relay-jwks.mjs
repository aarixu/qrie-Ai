/**
 * PUSH THE PROJECT'S PUBLIC SIGNING KEYS TO THE RELAY (RELAY_JWKS).
 *
 * The relay checks a sign-in's signature itself (packages/relay/src/auth.ts
 * createJwksVerifier). Nearly every call lands on a fresh Edge isolate
 * (measured 2026-10-01: 11 of 12 in a row), so fetching the keys per isolate
 * cost a fetch on almost every call; given up front they cost nothing. These
 * are PUBLIC keys — the same JSON anyone can read at
 * <project>/auth/v1/.well-known/jwks.json — so nothing secret moves here.
 *
 * Run it again after rotating the project's signing keys. Until then a token
 * signed by a key this set lacks is still accepted: the relay fetches the
 * live set, and failing that asks the identity service.
 *
 * Run: node tools/bin/relay-jwks.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

const ROOT = process.cwd();
const env = readEnvLocal(path.join(ROOT, '.env.local'));
const SUPABASE = env.VITE_SUPABASE_URL;
if (!SUPABASE) {
  console.error('No VITE_SUPABASE_URL in .env.local.');
  process.exit(1);
}
const ref = new URL(SUPABASE).hostname.split('.')[0];

const res = await fetch(`${SUPABASE}/auth/v1/.well-known/jwks.json`);
const jwks = await res.json();
if (!res.ok || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
  console.error(`The project published no signing keys (${res.status}).`);
  process.exit(1);
}
console.log(`${jwks.keys.length} public key(s): ${jwks.keys.map((k) => `${k.kid} (${k.alg ?? k.kty})`).join(', ')}`);

// A temp env file, as relay-secrets.mjs does; single-quoted so the JSON's own
// quotes survive.
const temp = path.join(ROOT, `.relay-jwks.${process.pid}.env`);
fs.writeFileSync(temp, `RELAY_JWKS='${JSON.stringify({ keys: jwks.keys })}'\n`);
try {
  const out = spawnSync(`npx supabase secrets set --env-file "${temp}" --project-ref ${ref}`, {
    shell: true,
    stdio: 'inherit',
  });
  if (out.status !== 0) process.exit(out.status ?? 1);
  console.log('RELAY_JWKS set. Takes effect on the next isolate; no deploy needed.');
} finally {
  fs.rmSync(temp, { force: true });
}
