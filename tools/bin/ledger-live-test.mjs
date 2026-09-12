/**
 * DOES A STUDENT'S EVENT ACTUALLY REACH THE DATABASE?
 *
 * verify-deploy proves the tables exist. That is not the same claim. This signs
 * up the way a phone with no account does, and then checks the five properties
 * the ledger's whole design rests on — because each of them is a decision that
 * would fail silently if it were wrong:
 *
 *   1. Postgres provisioned the org and the membership from a TRIGGER, before
 *      the student's first event. Doing this in app code would race a slow phone.
 *   2. An event inserts at all.
 *   3. REPLAY IS FREE. The id is minted on the device and is the primary key,
 *      so re-sending a batch whose response was lost is a no-op rather than a
 *      duplicate answer inflating mastery.
 *   4. APPEND-ONLY. There is no update or delete policy, deliberately: the
 *      learner model is rebuilt from these rows.
 *   5. A second student cannot read the first one's rows.
 *
 * It mints a throwaway anonymous account, like tools/bin/live-test.mjs.
 * Run: node tools/bin/ledger-live-test.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;

let failed = 0;
const show = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK   ' : '  FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};

const signUp = async () => {
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: '{}',
  });
  const body = await res.json();
  return { token: body.access_token, id: body.user?.id };
};

const as = (token) => ({
  apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json',
});

const student = await signUp();
show('a phone with no account gets an identity', Boolean(student.token));
if (!student.token) process.exit(1);

// 1. The trigger, not the app.
const memRes = await fetch(`${URL_}/rest/v1/membership?select=org_id,role`, { headers: as(student.token) });
const membership = await memRes.json();
const org = membership?.[0]?.org_id;
show('Postgres provisioned an org and a membership before any app code ran',
     Boolean(org) && membership[0].role === 'student',
     `${membership.length} row(s), role=${membership?.[0]?.role}`);
if (!org) process.exit(1);

// 2. An event lands.
const sessionId = crypto.randomUUID();
const eventId = crypto.randomUUID();
const event = {
  id: eventId, org_id: org, user_id: student.id, session_id: sessionId, seq: 0,
  at: new Date().toISOString(), kind: 'answered', source: 'quiz', surface: 'tap',
  outcome_ids: ['sci10-lp-respiration-equation'], topic_ref: 'class10-science/life-processes/respiration',
  payload: { correct: true, ms: 4200, attempt: 1, assistanceRung: 0, hintsShown: 0 },
};
const ins = await fetch(`${URL_}/rest/v1/ledger_event`, {
  method: 'POST', headers: { ...as(student.token), prefer: 'return=representation' },
  body: JSON.stringify(event),
});
const insBody = await ins.text();
show('an answer reaches the database', ins.ok, `HTTP ${ins.status} ${insBody.slice(0, 70)}`);

// 3. Replay is free — the whole offline outbox depends on this.
const again = await fetch(`${URL_}/rest/v1/ledger_event`, {
  method: 'POST',
  headers: { ...as(student.token), prefer: 'resolution=ignore-duplicates,return=minimal' },
  body: JSON.stringify(event),
});
const readBack = await (await fetch(
  `${URL_}/rest/v1/ledger_event?select=id,payload&id=eq.${eventId}`, { headers: as(student.token) },
)).json();
show('re-sending the same event is a no-op, not a duplicate',
     again.ok && readBack.length === 1, `HTTP ${again.status}, ${readBack.length} row(s)`);
show('the payload survived the round trip',
     readBack?.[0]?.payload?.assistanceRung === 0 && readBack?.[0]?.payload?.ms === 4200,
     JSON.stringify(readBack?.[0]?.payload ?? {}).slice(0, 70));

// 4. Append-only, enforced by the absence of a policy.
const upd = await fetch(`${URL_}/rest/v1/ledger_event?id=eq.${eventId}`, {
  method: 'PATCH', headers: as(student.token), body: JSON.stringify({ payload: { correct: false } }),
});
const updated = await (await fetch(
  `${URL_}/rest/v1/ledger_event?select=payload&id=eq.${eventId}`, { headers: as(student.token) },
)).json();
show('a student cannot rewrite what they answered',
     updated?.[0]?.payload?.correct === true, `HTTP ${upd.status}, correct is still ${updated?.[0]?.payload?.correct}`);

const del = await fetch(`${URL_}/rest/v1/ledger_event?id=eq.${eventId}`, {
  method: 'DELETE', headers: as(student.token),
});
const afterDel = await (await fetch(
  `${URL_}/rest/v1/ledger_event?select=id&id=eq.${eventId}`, { headers: as(student.token) },
)).json();
show('and cannot delete it either', afterDel.length === 1, `HTTP ${del.status}, ${afterDel.length} row(s) remain`);

// 5. One student's record is theirs alone.
const other = await signUp();
const theirs = await (await fetch(
  `${URL_}/rest/v1/ledger_event?select=id&id=eq.${eventId}`, { headers: as(other.token) },
)).json();
show('a second student cannot read the first one\'s rows',
     Array.isArray(theirs) && theirs.length === 0, `${theirs.length ?? '?'} row(s) visible`);

// And the session close, through the function rather than an update.
await fetch(`${URL_}/rest/v1/learning_session`, {
  method: 'POST', headers: as(student.token),
  body: JSON.stringify({ id: sessionId, org_id: org, user_id: student.id, source: 'quiz',
                         started_at: new Date().toISOString() }),
});
await fetch(`${URL_}/rest/v1/rpc/close_learning_session`, {
  method: 'POST', headers: as(student.token),
  body: JSON.stringify({ p_session: sessionId, p_ended_at: new Date().toISOString(), p_active_ms: 92000 }),
});
const sess = await (await fetch(
  `${URL_}/rest/v1/learning_session?select=active_ms,ended_at&id=eq.${sessionId}`, { headers: as(student.token) },
)).json();
show('time on task is recorded by closing the session',
     sess?.[0]?.active_ms === 92000 && Boolean(sess?.[0]?.ended_at), `active_ms=${sess?.[0]?.active_ms}`);

if (failed > 0) {
  console.log(`\n${failed} check${failed === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nThe ledger is live: a student\'s answer reaches Postgres, replays harmlessly, and cannot be rewritten.');
