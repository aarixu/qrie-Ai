/**
 * DOES A CALL'S COST ACTUALLY GET WRITTEN DOWN?
 *
 * verify-deploy proves the accounting table and its function exist. This
 * proves the whole path: a real student, a real relay call, and a row that
 * says what it cost — attributed to the session the app named. The same shape
 * as ledger-live-test, one layer down.
 *
 * It makes ONE tiny speech call (a five-character line, about a hundredth of a
 * rupee) and one deliberately-refused llm call, so the books show both a cost
 * and a refusal that cost nothing. It mints a throwaway anonymous account.
 *
 * Run: node tools/bin/usage-live-test.mjs
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
const RELAY = env.VITE_RELAY_URL;

let failed = 0;
const show = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK   ' : '  FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A student, exactly as the app makes one.
const signup = await fetch(`${URL_}/auth/v1/signup`, {
  method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: '{}',
});
const session = await signup.json();
const token = session.access_token;
show('a phone with no account gets an identity', Boolean(token));
if (!token) process.exit(1);
const as = { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' };

// The sitting this call belongs to. The app mints this in the ledger outbox
// and sends it on every relay call; here it is minted by hand.
const sittingId = crypto.randomUUID();

// 1. A spoken line, with the session on the query string as the app sends it.
const ticket = await (await fetch(`${RELAY}/api/ticket`, { method: 'POST', headers: as })).json();
show('speech ticket minted', typeof ticket.ticket === 'string');
const line = 'hello';
const speech = await fetch(
  `${RELAY}/api/speech?text=${encodeURIComponent(line)}&ticket=${encodeURIComponent(ticket.ticket)}&session=${sittingId}`,
);
// Drain the stream so the call is genuinely made end to end.
await speech.arrayBuffer().catch(() => null);
show('her voice streamed for the line', speech.ok, `HTTP ${speech.status}`);

// 2. A refused llm call — a model the relay does not serve. Refused BEFORE the
//    model is called, so it must cost nothing and leave no usage row... but it
//    is admitted (the meter runs first), so it MAY leave a row with a 400 status.
//    Either is honest; what is not honest is a row claiming tokens were spent.
const refused = await fetch(`${RELAY}/api/llm`, {
  method: 'POST', headers: { ...as, 'x-session-id': sittingId },
  body: JSON.stringify({ model: 'google/not-a-real-model', messages: [{ role: 'user', content: 'x' }], max_tokens: 5 }),
});
show('an unserved model is refused', refused.status === 400, `HTTP ${refused.status}`);

// The sink is fire-and-forget on the server; give it a moment to land.
await sleep(1500);

// 3. Read the books back as the student. RLS lets them see their own rows.
const rows = await (await fetch(
  `${URL_}/rest/v1/usage_event?select=relay,provider,model,status,characters,prompt_tokens,session_id&order=at.asc`,
  { headers: as },
)).json();

const spoken = Array.isArray(rows) ? rows.find((r) => r.relay === 'speech') : null;
show('the spoken line was written down', Boolean(spoken), spoken ? `${spoken.provider}/${spoken.model}` : `${rows?.length ?? '?'} row(s)`);
show('with the characters it was billed for', spoken?.characters === [...line].length, `characters=${spoken?.characters}`);
show('attributed to the sitting the app named', spoken?.session_id === sittingId, `session_id=${spoken?.session_id?.slice(0, 8)}`);

const llm = Array.isArray(rows) ? rows.find((r) => r.relay === 'llm') : null;
show('the refused call, if recorded, claims no tokens',
     !llm || (llm.prompt_tokens === null && llm.status !== 200),
     llm ? `status=${llm.status} prompt_tokens=${llm.prompt_tokens}` : 'no row (refused before the meter)');

// 4. The cost join, as the student sees it: unpriced until an operator prices it.
const cost = await (await fetch(
  `${URL_}/rest/v1/usage_cost?select=relay,inr,unpriced&session_id=eq.${sittingId}`,
  { headers: as },
)).json();
const costRow = Array.isArray(cost) ? cost.find((r) => r.relay === 'speech') : null;
show('the cost view answers for this sitting', Boolean(costRow),
     costRow ? (costRow.unpriced ? 'UNPRICED (no model_price row yet — expected until tools/sql/model_price.sql is applied)' : `₹${costRow.inr}`) : 'no row');

// 5. And nobody else can see it.
const other = await (await fetch(`${URL_}/auth/v1/signup`, {
  method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: '{}',
})).json();
const theirs = await (await fetch(
  `${URL_}/rest/v1/usage_event?select=relay&session_id=eq.${sittingId}`,
  { headers: { apikey: ANON, authorization: `Bearer ${other.access_token}` } },
)).json();
show("a second student cannot read the first one's usage", Array.isArray(theirs) && theirs.length === 0, `${theirs?.length ?? '?'} visible`);

if (failed > 0) {
  console.log(`\n${failed} check${failed === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nThe accounting is live: a call reaches the relay, its cost reaches Postgres, attributed to the sitting.');
