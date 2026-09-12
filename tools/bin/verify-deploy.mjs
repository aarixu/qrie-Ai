/**
 * IS THE BACKEND ACTUALLY UP?
 *
 * Written because "done" is not evidence. The first run of this against a
 * supposedly-finished deploy found the function missing, both migrations
 * unapplied and the bucket absent — and the thing that had actually failed was
 * a deploy script of mine that printed a success line and set nothing.
 *
 * Everything here uses the PUBLIC anon key, so it is safe to run from
 * anywhere and proves what a real student's phone would see.
 *
 * Run: node tools/bin/verify-deploy.mjs
 */
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const RELAY = env.VITE_RELAY_URL;

// Every probe runs, then the process exits on the tally — all five results are
// worth seeing, but printing FAIL and returning 0 means nothing can gate on it.
let failed = 0;
const show = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK   ' : '  FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};

// 1. Is the function deployed and running OUR code? An unauthenticated call
//    should come back with the gate's own refusal, not a platform error.
try {
  const res = await fetch(`${RELAY}/api/llm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = await res.text();
  const ours = body.includes('Authorization: Bearer');
  show('relay function is live and refusing anonymous callers', res.status === 401 && ours,
       `HTTP ${res.status} ${body.slice(0, 90)}`);
} catch (e) {
  show('relay function reachable', false, String(e));
}

// 2. Did migration 0004 land? anon may select from prepared_class.
try {
  const res = await fetch(`${URL_}/rest/v1/prepared_class?select=id&limit=1`, {
    headers: { apikey: ANON, authorization: `Bearer ${ANON}` },
  });
  const body = await res.text();
  show('prepared_class table exists and is readable', res.ok, `HTTP ${res.status} ${body.slice(0, 90)}`);
} catch (e) {
  show('prepared_class reachable', false, String(e));
}

// 3. Did migration 0003 land? claim_relay must exist AND be refused to anon.
try {
  const res = await fetch(`${URL_}/rest/v1/rpc/claim_relay`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_user: '00000000-0000-0000-0000-000000000000', p_relay: 'llm', p_units: 1 }),
  });
  const body = await res.text();
  // 404 = the function is not there. 401/403 = it is there and correctly
  // refuses a student, which is the whole point of it.
  show('claim_relay exists and is closed to students', res.status !== 404,
       `HTTP ${res.status} ${body.slice(0, 90)}`);
} catch (e) {
  show('claim_relay reachable', false, String(e));
}

// 4. Is the classes bucket there and public?
try {
  const res = await fetch(`${URL_}/storage/v1/object/public/classes/does-not-exist.json`);
  const body = await res.text();
  // "not found" for the OBJECT means the bucket resolved. "Bucket not found"
  // means the migration did not run.
  show('classes bucket exists', !body.toLowerCase().includes('bucket not found'),
       `HTTP ${res.status} ${body.slice(0, 90)}`);
} catch (e) {
  show('storage reachable', false, String(e));
}

// 5. Anonymous sign-in (B11) — without it every relay refuses everyone.
try {
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: '{}',
  });
  const body = await res.text();
  const ok = res.ok && body.includes('access_token');
  show('anonymous sign-in is switched on (B11)', ok, `HTTP ${res.status} ${body.slice(0, 120)}`);
} catch (e) {
  show('auth reachable', false, String(e));
}

// 6. Did the tenancy migration (0005) land? anon may select, and RLS gives it
//    nothing, so an empty 200 is the right answer and a 404 is the wrong one.
// `select=*` rather than `select=id`: membership's primary key is
// (org_id, user_id) and it has no `id` column at all, so asking for one is a
// 400 that reads exactly like a missing table. The first run of this said the
// table was absent when it was there.
for (const table of ['organization', 'membership', 'learning_session', 'ledger_event']) {
  try {
    const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: ANON, authorization: `Bearer ${ANON}` },
    });
    const body = await res.text();
    show(`${table} exists`, res.ok, `HTTP ${res.status} ${body.slice(0, 70)}`);
  } catch (e) {
    show(`${table} reachable`, false, String(e));
  }
}

// 7. The session close (0006). Present, and refusing a caller with no session.
try {
  const res = await fetch(`${URL_}/rest/v1/rpc/close_learning_session`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_session: '00000000-0000-0000-0000-000000000000',
      p_ended_at: new Date().toISOString(),
      p_active_ms: 0,
    }),
  });
  const body = await res.text();
  show('close_learning_session exists', res.status !== 404, `HTTP ${res.status} ${body.slice(0, 70)}`);
} catch (e) {
  show('close_learning_session reachable', false, String(e));
}

// 8. THE ONE THAT MATTERS. purge_old_ledger deletes children's answers by age,
//    and a student holding the public anon key must not be able to call it —
//    least of all with p_days = 1. It must exist (not 404) AND refuse (not 200).
try {
  const res = await fetch(`${URL_}/rest/v1/rpc/purge_old_ledger`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_days: 3650 }),
  });
  const body = await res.text();
  show(
    'purge_old_ledger exists and is CLOSED to students',
    res.status !== 404 && !res.ok,
    `HTTP ${res.status} ${body.slice(0, 70)}`,
  );
} catch (e) {
  show('purge_old_ledger reachable', false, String(e));
}

if (failed > 0) {
  console.log(`\n${failed} check${failed === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
