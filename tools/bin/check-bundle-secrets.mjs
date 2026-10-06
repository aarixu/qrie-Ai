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

// Which builds to search: the paths given on the command line, else the tutor's.
// The admin console's build is checked in CI by passing apps/admin/dist.
const DISTS = process.argv.length > 2 ? process.argv.slice(2) : ['apps/classroom/dist'];
const PUBLIC_BY_DESIGN = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_RELAY_URL',
  // The two telemetry credentials are WRITE-ONLY INGEST endpoints, which is a
  // different kind of thing from a key. Both vendors publish them in their own
  // client snippets: a Sentry DSN names a project to send events TO and cannot
  // read one, and a PostHog project key beginning `phc_` can capture and cannot
  // query. Neither reaches a report, a session replay or another project.
  //
  // The exposure they DO carry is quota: anybody who reads the bundle can post
  // junk events and spend our monthly allowance. That is a bill, not a breach,
  // and it is answered on the vendor's side -- Sentry inbound filters and
  // allowed domains, PostHog's own rate limits -- not by hiding a string that
  // has to be in the browser to do its job.
  //
  // The personal-api-key forms (`sntrys_`, `phx_`) are a different matter
  // entirely and must never appear here or in a bundle.
  'VITE_SENTRY_DSN',
  'VITE_POSTHOG_KEY',
  'VITE_POSTHOG_HOST',
]);

/** Shapes of the credentials this project uses, for a CI run with no .env. */
const SHAPES = [
  { name: 'OpenRouter key', re: /sk-or-v1-[A-Za-z0-9]{16,}/ },
  { name: 'Google API key', re: /AIza[A-Za-z0-9_-]{20,}/ },
  { name: 'RunPod key', re: /\brpa_[A-Za-z0-9]{24,}/ },
  // The counterweight to allowing the DSN and the project key above. These are
  // the PERSONAL tokens of the same two vendors -- they read projects, issues
  // and events, and one in a bundle is a real breach rather than a quota bill.
  // Allowing the write-only pair by name is only defensible while the readable
  // pair is refused by shape.
  { name: 'Sentry auth token', re: /\bsntrys_[A-Za-z0-9+/=]{20,}/ },
  { name: 'PostHog personal key', re: /\bphx_[A-Za-z0-9]{20,}/ },
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

/**
 * A Supabase service-role key is a JWT whose payload says role = service_role.
 * The anon key is a JWT too, and belongs in the bundle, so the shape alone cannot
 * tell them apart: the payload can. Nothing in a browser has a reason to hold the
 * key that bypasses row-level security, whichever app it is.
 */
function serviceRoleTokens(body) {
  const found = [];
  for (const m of body.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload && payload.role === 'service_role') found.push(m[0]);
    } catch {
      // not a JWT after all
    }
  }
  return found;
}

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
}
for (const dist of DISTS) walk(dist);

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
  if (serviceRoleTokens(body).length > 0) leaks.push(`a service-role key appears in ${file}`);
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
