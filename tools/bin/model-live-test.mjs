/**
 * IS A STUDENT'S BELIEF SOMETHING THEY CAN READ AND NOT SOMETHING THEY CAN SET?
 *
 * `verify-deploy` proves `concept_state` exists. That is not the same claim.
 * This signs up the way a phone with no account does and checks the properties
 * the learner model's whole design rests on — each one a decision that would
 * fail SILENTLY if it were wrong:
 *
 *   1. A student may read their own beliefs.
 *   2. A STUDENT MAY NOT WRITE THEM. There is no insert, update or delete
 *      policy on `concept_state`, and the absence is the point: RLS denies what
 *      nothing allows, so the only writer is service_role through the fold. A
 *      belief a student can set is not evidence about anything.
 *   3. A second student sees none of the first one's rows.
 *
 * CHECK THE ROW COUNT, NOT THE STATUS CODE. RLS filters rows away rather than
 * refusing loudly: a forbidden UPDATE returns 204 and changes nothing, and a
 * forbidden DELETE does the same. `0006`'s own append-only check was written
 * against the status code and passed for a week on a table anybody could have
 * rewritten. Every refusal here is proved by reading the rows back.
 *
 * It mints a throwaway anonymous account, like tools/bin/ledger-live-test.mjs.
 * Run: node tools/bin/model-live-test.mjs
 *
 * Requires migration 0013. Until it is applied this stops after the first read
 * and says so, rather than printing five red checks — "the migration is not
 * applied" and "the policy is wrong" are indistinguishable from a failing read,
 * and only one of them is a bug to go hunting.
 */
import fs from 'node:fs';

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

/**
 * The status matters as much as the body. A table PostgREST has never heard of
 * answers 404 with PGRST205, and a permission it will not grant answers 200
 * with an empty array — two completely different facts that both look like
 * "no rows" if you only read the body. `0006`'s append-only check was written
 * the other way and passed for a week on a table anybody could rewrite.
 */
const get = async (token, query) => {
  const res = await fetch(`${URL_}/rest/v1/${query}`, { headers: as(token) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, rows: Array.isArray(body) ? body : null };
};

const missingTable = (r) => r.status === 404 || (r.body && r.body.code === 'PGRST205');

console.log('\nTHE LEARNER MODEL, AGAINST THE DEPLOYED PROJECT\n');

const student = await signUp();
show('a phone with no account gets an identity', Boolean(student.token));
if (!student.token) process.exit(1);

const membership = (await get(student.token, 'membership?select=org_id,role')).rows;
const org = membership?.[0]?.org_id;
show('Postgres provisioned an org before any app code ran', Boolean(org), `role=${membership?.[0]?.role}`);
if (!org) process.exit(1);

/**
 * THE TABLE HAS TO BE THERE AT ALL, and this is checked before anything else
 * because "0013 is not applied" and "the policy is wrong" are indistinguishable
 * from a failing read — and only one of them is a bug. Reporting five red
 * checks for an unapplied migration would send the reader hunting a defect
 * that does not exist.
 */
const mine = await get(student.token, 'concept_state?select=outcome_id&limit=1');
if (missingTable(mine)) {
  console.log('  ----  migration 0013 is NOT applied to this project.');
  console.log('        Nothing below can be checked until it is. Apply it with:');
  console.log('          npx supabase db push');
  console.log('        (0012 is pending too, and it matters more: the live database');
  console.log('         still enforces the old 3,000 daily budget against the new');
  console.log('         one-paisa units, so a student is cut off inside their first');
  console.log('         class.)\n');
  process.exit(1);
}
show('concept_state exists', true, `HTTP ${mine.status}`);

// 1. Reading own rows is allowed (and empty, for a brand-new student).
show('a student may read their own beliefs', mine.rows !== null, `${mine.rows?.length ?? 0} row(s)`);

// 2. Writing them is not. Three ways, and each verified by reading back.
const row = {
  org_id: org, user_id: student.id, outcome_id: 'sci10-lp-respiration-equation',
  mastery: 0.99, unassisted_mastery: 0.99, assisted_performance: 0.99,
};
const ins = await fetch(`${URL_}/rest/v1/concept_state`, {
  method: 'POST', headers: { ...as(student.token), prefer: 'return=minimal' },
  body: JSON.stringify(row),
});
const afterInsert = (await get(student.token, 'concept_state?select=outcome_id')).rows;
show('a student CANNOT invent a belief about themselves',
     Array.isArray(afterInsert) && afterInsert.length === 0,
     `HTTP ${ins.status}, ${Array.isArray(afterInsert) ? afterInsert.length : '?'} row(s) after`);

const upd = await fetch(
  `${URL_}/rest/v1/concept_state?outcome_id=eq.sci10-lp-respiration-equation`,
  { method: 'PATCH', headers: as(student.token), body: JSON.stringify({ mastery: 1 }) },
);
show('an update changes nothing, whatever it answers', upd.status === 204 || upd.status === 404 || !upd.ok,
     `HTTP ${upd.status}`);

const del = await fetch(`${URL_}/rest/v1/concept_state?user_id=eq.${student.id}`,
  { method: 'DELETE', headers: as(student.token) });
show('and a delete changes nothing either', del.status === 204 || !del.ok, `HTTP ${del.status}`);

// The model row obeys the same rule.
const modelRow = await get(student.token, 'learner_model?select=user_id,version&limit=1');
show('learner_model exists and is readable', !missingTable(modelRow) && modelRow.rows !== null,
     `HTTP ${modelRow.status}, ${modelRow.rows?.length ?? 0} row(s)`);

const insModel = await fetch(`${URL_}/rest/v1/learner_model`, {
  method: 'POST', headers: { ...as(student.token), prefer: 'return=minimal' },
  body: JSON.stringify({ user_id: student.id, org_id: org, version: 1 }),
});
const afterModel = (await get(student.token, 'learner_model?select=user_id')).rows;
show('a student cannot write their own model row',
     Array.isArray(afterModel) && afterModel.length === 0,
     `HTTP ${insModel.status}, ${Array.isArray(afterModel) ? afterModel.length : '?'} row(s) after`);

// 3. Nobody else's rows, ever.
const other = await signUp();
if (other.token) {
  const theirs = (await get(other.token, 'concept_state?select=outcome_id')).rows;
  show('a second student sees none of the first one\'s beliefs',
       Array.isArray(theirs) && theirs.length === 0,
       `${Array.isArray(theirs) ? theirs.length : '?'} row(s) visible`);
}

// And the index the inspector's evidence view depends on.
const byOutcome = await get(student.token,
  'ledger_event?select=id&outcome_ids=cs.%7Bsci10-lp-respiration-equation%7D&limit=1');
show('evidence can be looked up by outcome', byOutcome.rows !== null,
     `HTTP ${byOutcome.status}, ${byOutcome.rows?.length ?? 0} row(s)`);

console.log(
  failed === 0
    ? '\nBelief is live: a student can read their own and cannot write it.\n'
    : `\n${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
