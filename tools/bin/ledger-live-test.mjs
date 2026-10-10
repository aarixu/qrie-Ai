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
 *   2. An event lands at all, through public.record_evidence (0107), the one
 *      door a phone has since 0110; an insert straight into the table is
 *      refused.
 *   3. REPLAY IS FREE. The id is minted on the device and is the primary key,
 *      so re-sending a batch whose response was lost is answered 'duplicate'
 *      rather than becoming a second answer inflating mastery.
 *   4. APPEND-ONLY. There is no update or delete policy, and since 0110 no
 *      update or delete grant, deliberately: the learner model is rebuilt from
 *      these rows.
 *   5. A second student cannot read the first one's rows.
 *   6. THE OUTBOX'S OWN EVENTS LAND — not a row typed out here that happens to
 *      look like one. This is the check whose absence cost the most: the id of
 *      the event opening every sitting was derived as `<sessionId>:0`, which
 *      `ledger_event.id` (a `uuid` column) refuses with 22P02, and because a
 *      batch was sent as ONE statement the refusal took every other event with
 *      it, on every drain, for the life of the install. Checks 1-5 were all
 *      green, because check 2 hand-minted its own id and never touched the
 *      code the app runs. record_evidence now answers each event on its own,
 *      so this checks that every one of them comes back 'recorded'.
 *
 * It mints a throwaway anonymous account, like tools/bin/live-test.mjs.
 * Run: node tools/bin/ledger-live-test.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
// The real thing, not a re-description of it. Node loads this directly because
// the package's imports carry their extensions.
import {
  emptyOutbox, startSession, recordAnswer, endSession, batch,
} from '../../packages/ledger/src/outbox.ts';

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

// 2. An event lands, through the function; the table itself is shut to a phone.
const rpc = (token, name, args) => fetch(`${URL_}/rest/v1/rpc/${name}`, {
  method: 'POST', headers: as(token), body: JSON.stringify(args),
});
const sessionId = crypto.randomUUID();
const eventId = crypto.randomUUID();
// Five minutes back, so the sitting's span holds the 92 s of time on task
// closed below (close_learning_session bounds time on task by the span).
const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
const sitting = { id: sessionId, source: 'quiz', topicRef: 'class10-science/life-processes/respiration', startedAt };
const event = {
  id: eventId, sessionId, seq: 0, at: new Date().toISOString(), kind: 'answered', source: 'quiz', surface: 'tap',
  outcomeIds: ['sci10-lp-respiration-equation'], topicRef: 'class10-science/life-processes/respiration',
  payload: { correct: true, ms: 4200, attempt: 1, assistanceRung: 0, hintsShown: 0 },
};
const ins = await rpc(student.token, 'record_evidence', { p_sessions: [sitting], p_events: [event] });
const insBody = ins.ok ? await ins.json() : await ins.text();
show('an answer reaches the database through record_evidence',
     ins.ok && insBody?.[0]?.status === 'recorded', `HTTP ${ins.status} ${JSON.stringify(insBody).slice(0, 90)}`);

const direct = await fetch(`${URL_}/rest/v1/ledger_event`, {
  method: 'POST', headers: { ...as(student.token), prefer: 'return=minimal' },
  body: JSON.stringify({
    id: crypto.randomUUID(), org_id: org, user_id: student.id, session_id: sessionId, seq: 1,
    at: new Date().toISOString(), kind: 'answered', source: 'quiz', surface: 'tap', payload: { correct: true },
  }),
});
const directBody = direct.ok ? '' : await direct.text();
show('an insert straight into the table is refused',
     !direct.ok && /permission denied/i.test(directBody), `HTTP ${direct.status} ${directBody.slice(0, 70)}`);

// 3. Replay is free — the whole offline outbox depends on this.
const again = await rpc(student.token, 'record_evidence', { p_sessions: [sitting], p_events: [event] });
const againBody = again.ok ? await again.json() : [];
const readBack = await (await fetch(
  `${URL_}/rest/v1/ledger_event?select=id,payload&id=eq.${eventId}`, { headers: as(student.token) },
)).json();
show('re-sending the same event is a duplicate, not a second answer',
     again.ok && againBody?.[0]?.status === 'duplicate' && readBack.length === 1,
     `HTTP ${again.status}, ${againBody?.[0]?.status}, ${readBack.length} row(s)`);
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

// And the session close, through the function rather than an update. The
// sitting is the one record_evidence opened in check 2.
await fetch(`${URL_}/rest/v1/rpc/close_learning_session`, {
  method: 'POST', headers: as(student.token),
  body: JSON.stringify({ p_session: sessionId, p_ended_at: new Date().toISOString(), p_active_ms: 92000 }),
});
const sess = await (await fetch(
  `${URL_}/rest/v1/learning_session?select=active_ms,ended_at&id=eq.${sessionId}`, { headers: as(student.token) },
)).json();
show('time on task is recorded by closing the session',
     sess?.[0]?.active_ms === 92000 && Boolean(sess?.[0]?.ended_at), `active_ms=${sess?.[0]?.active_ms}`);

// 6. The events the OUTBOX produces, through the shape the drain sends.
const fresh = await signUp();

const mint = () => crypto.randomUUID();
const realSession = mint();
let outbox = startSession(emptyOutbox(), {
  id: realSession, eventId: mint(), at: new Date().toISOString(),
  source: 'class', topicRef: 'class10-science/life-processes/respiration',
});
outbox = recordAnswer(outbox, {
  id: mint(), at: new Date().toISOString(), surface: 'voice',
  outcomeIds: ['sci10-lp-respiration-equation'],
  correct: true, ms: 4200, attempt: 1, assistanceRung: 0, hintsShown: 0,
});
outbox = endSession(outbox, {
  id: mint(), at: new Date().toISOString(), activeMs: 240000, completed: true,
});

// Exactly lib/ledgerSync.ts's send: the outbox's own events, and the sittings
// their session-started events open (its sittingsOf), in one call.
const rows = batch(outbox);
const sittings = rows
  .filter((e) => e.kind === 'session-started')
  .map((e) => ({ id: e.sessionId, source: e.source, topicRef: e.topicRef ?? null, startedAt: e.at }));
const drain = await rpc(fresh.token, 'record_evidence', { p_sessions: sittings, p_events: rows });
const answers = drain.ok ? await drain.json() : [];
const drainBody = drain.ok
  ? answers.filter((r) => r.status !== 'recorded').map((r) => `${r.status}:${r.reason}`).join(' ')
  : await drain.text();
const landed = await (await fetch(
  `${URL_}/rest/v1/ledger_event?select=id,kind,seq&session_id=eq.${realSession}&order=seq`,
  { headers: as(fresh.token) },
)).json();
show('a whole sitting, built by the real outbox, lands in one call',
     drain.ok && answers.length === rows.length && answers.every((r) => r.status === 'recorded')
       && landed.length === rows.length,
     `HTTP ${drain.status}, ${landed.length}/${rows.length} row(s) ${drainBody.slice(0, 90)}`);
show('the sitting opens with session-started at seq 0, in order',
     landed?.[0]?.kind === 'session-started' && landed?.[0]?.seq === 0
       && landed?.[landed.length - 1]?.kind === 'session-ended',
     landed.map((r) => `${r.seq}:${r.kind}`).join(' '));

if (failed > 0) {
  console.log(`\n${failed} check${failed === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nThe ledger is live: a student\'s answer reaches Postgres through record_evidence, replays harmlessly, and cannot be rewritten.');
