/**
 * UNASSISTED MASTERY GAIN PER LEARNING MINUTE, FROM THE LEDGER ALONE.
 *
 * Phase 3's own definition of done, computed the only honest way: read one
 * student's sittings and events off the server, fold them from zero in
 * (started_at, seq) order — the same `foldSession` the device and the
 * inspector run — and divide the unassisted movement by the time on task the
 * sittings themselves recorded. Nothing here trusts a stored model; the
 * ledger is the record and this prints what the record says was learned.
 *
 * Until 2026-09-16 the metric existed only as a pure function over two
 * in-memory snapshots (commit 83036a1 was TITLED "from the ledger alone" and
 * shipped no ledger in sight). This is the tool that sentence promised.
 *
 * Run:  npm run model:metric            — seeds a synthetic student, then measures them
 *       npm run model:metric -- --token <jwt> [--map class10-science]
 *                                        — measures a real student through their own
 *                                          session token; RLS scopes every read to them
 *
 * The seed needs no service key: it sends the student's events through
 * public.record_evidence (0107), with the student's own token, which is exactly
 * how the app itself writes them; since 0110 a direct insert into the tables is
 * refused. The synthetic history is two sittings — help laundered onto a recorded rung 0
 * that deriveRung must catch, a cold success, a spoken answer, a cold LOSS —
 * so the number printed exercises every rule the metric depends on.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  emptyModel,
  foldSession,
  gainPerLearningMinute,
  unassistedGain,
} from '@ai-tutor/learner-model';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env.local');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const mapName = flag('--map') ?? 'class10-science';
let token = flag('--token');

const as = (t) => ({ apikey: ANON, authorization: `Bearer ${t}`, 'content-type': 'application/json' });

/** The map the fold propagates over — the same file the app merges for this class. */
const graph = JSON.parse(
  fs.readFileSync(new URL(`../../packages/knowledge-graph/data/${mapName}.json`, import.meta.url), 'utf8'),
);
const index = new GraphIndex(graph);
const params = emptyParams();

// ---------------------------------------------------------------- seeding
const seed = async () => {
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: '{}',
  });
  const body = await res.json();
  const student = { token: body.access_token, id: body.user?.id };
  if (!student.token) {
    console.error('could not mint a throwaway student:', JSON.stringify(body).slice(0, 200));
    process.exit(1);
  }
  // record_evidence takes the org from the token and refuses a student with none.
  const membership = await (await fetch(`${URL_}/rest/v1/membership?select=org_id`, { headers: as(student.token) })).json();
  if (!membership?.[0]?.org_id) {
    console.error('no org was provisioned for the throwaway student — is the trigger deployed?');
    process.exit(1);
  }

  // Two REAL node ids, prerequisite and dependent, so propagation is real.
  const nodes = graph.nodes;
  const dependent = nodes.find((n) => n.prerequisites.length > 0) ?? nodes[1];
  const basis = dependent.prerequisites[0] ?? nodes[0].id;
  const n2 = dependent.id;

  const day = 24 * 60 * 60 * 1000;
  const s1At = new Date(Date.now() - day).toISOString();
  const s2At = new Date().toISOString();
  const s1 = randomUUID();
  const s2 = randomUUID();

  // In the outbox's own LedgerEvent shape, as record_evidence reads it.
  const ev = (sessionId, seq, at, kind, outcomeIds, payload, surface = 'tap') => ({
    id: randomUUID(), sessionId, seq, at, kind, source: 'quiz', surface, outcomeIds, payload,
  });
  const answered = (correct, extra = {}) => ({
    correct, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: 0, ...extra,
  });

  const close = (id, endedAt, activeMs) => fetch(`${URL_}/rest/v1/rpc/close_learning_session`, {
    method: 'POST', headers: as(student.token),
    body: JSON.stringify({ p_session: id, p_ended_at: endedAt, p_active_ms: activeMs }),
  });

  // record_evidence opens each sitting from its entry here when its first event arrives.
  const sittings = [
    { id: s1, source: 'quiz', topicRef: null, startedAt: s1At },
    { id: s2, source: 'quiz', topicRef: null, startedAt: s2At },
  ];
  const rows = [
    // Sitting one: help laundered onto a recorded rung 0 (deriveRung must
    // refuse it), then a genuinely cold success.
    ev(s1, 0, s1At, 'helped', [n2], { beatId: 'B1', rung: 3, requested: false }),
    ev(s1, 1, s1At, 'answered', [n2], { ...answered(true), beatId: 'B1' }),
    ev(s1, 2, s1At, 'answered', [n2], { ...answered(true), beatId: 'B2', chosenIndex: 1 }),
    ev(s1, 3, s1At, 'session-ended', [], { activeMs: 240_000, completed: true }),
    // Sitting two: a spoken cold success, and a cold LOSS — the metric must
    // count movement in both directions.
    ev(s2, 0, s2At, 'answered', [n2], { correct: true, ms: 6000, attempt: 1, assistanceRung: 0, hintsShown: 0, verdict: 'right', beatId: 'B3' }, 'voice'),
    ev(s2, 1, s2At, 'answered', [basis], { ...answered(false), beatId: 'B4' }),
    ev(s2, 2, s2At, 'session-ended', [], { activeMs: 180_000, completed: true }),
  ];
  const ins = await fetch(`${URL_}/rest/v1/rpc/record_evidence`, {
    method: 'POST', headers: as(student.token), body: JSON.stringify({ p_sessions: sittings, p_events: rows }),
  });
  const answers = ins.ok ? await ins.json() : null;
  if (!Array.isArray(answers) || answers.length !== rows.length || answers.some((a) => a.status !== 'recorded')) {
    console.error('record_evidence did not record every event:', ins.ok ? JSON.stringify(answers).slice(0, 300) : await ins.text());
    process.exit(1);
  }
  await close(s1, new Date(Date.parse(s1At) + 300_000).toISOString(), 240_000);
  await close(s2, new Date(Date.parse(s2At) + 200_000).toISOString(), 180_000);

  console.log(`seeded a synthetic student ${student.id}`);
  console.log(`  outcomes: ${n2} (dependent) resting on ${basis}`);
  return student.token;
};

// ---------------------------------------------------------------- measuring
if (!token) token = await seed();

const sessions = await (await fetch(
  `${URL_}/rest/v1/learning_session?select=id,started_at,active_ms&order=started_at.asc&limit=1001`,
  { headers: as(token) },
)).json();
const events = await (await fetch(
  `${URL_}/rest/v1/ledger_event?select=id,session_id,seq,at,kind,source,surface,outcome_ids,topic_ref,payload&order=seq.asc&limit=1001`,
  { headers: as(token) },
)).json();
if (!Array.isArray(sessions) || !Array.isArray(events)) {
  console.error('could not read the ledger:', JSON.stringify({ sessions, events }).slice(0, 300));
  process.exit(1);
}
if (sessions.length > 1000 || events.length > 1000) {
  // The same refusal rebuildFromLedger makes: a capped page folds every
  // sitting's head and drops its tail, and the number printed would be wrong
  // while looking exact.
  console.error(`more than one page of history (${sessions.length} sittings, ${events.length} events) — this tool will not fold a partial ledger.`);
  process.exit(1);
}

const toEvent = (r) => ({
  id: r.id, sessionId: r.session_id, seq: r.seq, at: r.at, kind: r.kind,
  source: r.source, surface: r.surface, outcomeIds: r.outcome_ids ?? [],
  ...(r.topic_ref ? { topicRef: r.topic_ref } : {}), payload: r.payload,
});
const bySession = new Map();
for (const row of events) {
  const list = bySession.get(row.session_id) ?? [];
  list.push(toEvent(row));
  bySession.set(row.session_id, list);
}

let model = emptyModel();
let totalGain = 0;
let totalMs = 0;
console.log('');
console.log('session                                started            events  activeMs   gain     gain/min');
for (const s of sessions) {
  const own = (bySession.get(s.id) ?? []).sort((a, b) => a.seq - b.seq);
  if (own.length === 0) continue;
  const before = model;
  model = foldSession(model, { id: s.id, startedAt: s.started_at }, own, index, params);
  const endedEvent = own.find((e) => e.kind === 'session-ended');
  const activeMs = endedEvent?.payload?.activeMs ?? s.active_ms ?? 0;
  const gain = unassistedGain(before, model);
  const perMin = gainPerLearningMinute(before, model, activeMs);
  totalGain += gain;
  totalMs += activeMs;
  console.log(
    `${s.id}  ${s.started_at.slice(0, 16)}  ${String(own.length).padStart(4)}  ${String(activeMs).padStart(8)}  ${gain.toFixed(4).padStart(7)}  ${activeMs > 0 ? perMin.toFixed(4).padStart(8) : '       —'}`,
  );
}

const overall = totalMs > 0 ? totalGain / (totalMs / 60_000) : 0;
console.log('');
console.log(`sittings folded: ${sessions.length} · events: ${events.length} · outcomes with belief: ${Object.keys(model.states).length}`);
console.log(`unassisted gain: ${totalGain.toFixed(4)} over ${(totalMs / 60_000).toFixed(1)} learning minutes`);
console.log(`UNASSISTED MASTERY GAIN PER LEARNING MINUTE: ${overall.toFixed(4)}`);
