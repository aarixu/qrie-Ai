/**
 * NOTHING SECRET MAY REACH THE BUNDLE.
 *
 * Vite inlines every VITE_ variable, which is how two provider keys ended up
 * in dist/assets/index-*.js and stayed there through a public tunnel. That
 * was fixed by hand; this is what stops it coming back.
 *
 * Three checks, because they fail differently:
 *
 *  1. If .env.local exists (a developer's machine), every long value in it is
 *     searched for verbatim in the build output.
 *  2. If .secrets/ holds a Google service account, its private key material
 *     and its account address are searched for the same way. That file is a
 *     far more dangerous credential than any API key here — it can spend a
 *     Cloud balance and reach whatever the account is granted — and it lives
 *     in a FILE rather than in .env.local, so check (1) never looked at it.
 *  3. Always: the built files are searched for the SHAPES of the keys this
 *     project uses, so CI catches a leak even with nothing to compare
 *     against.
 *
 * Three values in .env.local are PUBLIC BY DESIGN and belong in the bundle:
 * the Supabase URL and anon key (a published identifier — what a signed-in
 * student may read is decided by row-level security on the server, never by
 * hiding it) and the relay's base URL (a URL, and every relay behind it checks
 * who is asking). They are excluded BY NAME rather than by shape, so adding
 * one is a deliberate line in this file and never an accident.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'apps/classroom/dist';
const PUBLIC_BY_DESIGN = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_RELAY_URL',
  'VITE_SENTRY_DSN',
  'VITE_POSTHOG_KEY',
  'VITE_POSTHOG_HOST',
]);

/** Shapes of the credentials this project uses, for a CI run with no .env. */
const SHAPES = [
  { name: 'OpenRouter key', re: /sk-or-v1-[A-Za-z0-9]{16,}/ },
  { name: 'Google API key', re: /AIza[A-Za-z0-9_-]{20,}/ },
  { name: 'RunPod key', re: /\brpa_[A-Za-z0-9]{24,}/ },
  { name: 'ElevenLabs key', re: /\bsk_[a-f0-9]{40,}/ },
  // Any PEM private key at all. Nothing in a browser bundle has a reason to
  // carry one, whoever issued it.
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // A service account address. Harmless alone, but it is the give-away that a
  // whole key file went in, and it survives minification where the PEM might
  // have been re-encoded.
  { name: 'service account address', re: /[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/ },
];

/**
 * The long values inside a service account key file.
 *
 * The private key is compared with its whitespace stripped, because the JSON
 * holds it with \n escapes and a bundler could re-encode those a dozen ways —
 * a verbatim comparison would miss the leak it exists to find.
 */
function serviceAccountSecrets() {
  const dir = '.secrets';
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    let account;
    try {
      account = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
    } catch {
      continue;
    }
    if (typeof account.private_key === 'string') {
      const body = account.private_key
        .replace(/-----[^-]+-----/g, '')
        .replace(/\\n/g, '')
        .replace(/\s+/g, '');
      /**
       * SEVERAL SHORT WINDOWS, not one long slice.
       *
       * A planted-leak test caught this: one 64-character slice missed a key
       * that had been split across two string literals, because the slice
       * spanned the join. Twenty-four base64 characters is a hundred and
       * forty bits — specific enough that a match is never a coincidence —
       * and taking three of them from different offsets means a split has to
       * land inside all three to hide.
       */
      for (const at of [0, Math.floor(body.length / 3), Math.floor((body.length * 2) / 3)]) {
        const window = body.slice(at, at + 24);
        if (window.length === 24) out.push({ name: `${entry} private_key`, value: window });
      }
    }
    for (const field of ['client_email', 'private_key_id', 'client_id']) {
      if (typeof account[field] === 'string' && account[field].length > 18) {
        out.push({ name: `${entry} ${field}`, value: account[field] });
      }
    }
  }
  return out;
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
})(DIST);

const leaks = [];

const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const secrets = [...fs.readFileSync(envPath, 'utf8').matchAll(/^(\w+)=(\S+)$/gm)]
    .map((m) => ({ name: m[1], value: m[2] }))
    .filter((s) => s.value.length > 18 && !PUBLIC_BY_DESIGN.has(s.name));

  for (const file of files) {
    let body;
    try {
      body = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const secret of secrets) {
      if (body.includes(secret.value)) leaks.push(`${secret.name} appears in ${file}`);
    }
  }
}

const accountSecrets = serviceAccountSecrets();
for (const file of files) {
  let body;
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const squashed = body.replace(/\s+/g, '');
  for (const secret of accountSecrets) {
    if (body.includes(secret.value) || squashed.includes(secret.value)) {
      leaks.push(`${secret.name} appears in ${file}`);
    }
  }
  for (const shape of SHAPES) {
    if (shape.re.test(body)) leaks.push(`something shaped like a ${shape.name} appears in ${file}`);
  }
}

if (leaks.length > 0) {
  console.error('A secret reached the bundle:');
  for (const leak of leaks) console.error(`  - ${leak}`);
  process.exit(1);
}

console.log(`No secret found in ${files.length} built files.`);
