/**
 * WHAT A STUDENT-HOUR ACTUALLY COSTS — the number Phase 2 prices a credit from.
 *
 * Reads the accounting the relay writes (migration 0008) and prints three
 * things: the headline rupees per hour of a student actually learning, the
 * models that have been used but never priced, and the most expensive recent
 * sessions. It does no arithmetic of its own; the rupee figure is the
 * database's `cost_per_student_hour`, so this and any other reader agree.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in the environment or in .env.local. That key
 * is deliberately NOT in .env.local today — it can read every student's rows —
 * so this refuses plainly rather than falling back to the anon key, which would
 * see only the operator's own sessions and report a number that looks real.
 *
 * Run: SUPABASE_SERVICE_ROLE_KEY=... node tools/bin/cost-report.mjs [days]
 */
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const days = Number(process.argv[2] ?? 30);

if (!KEY) {
  console.error(
    'cost-report needs SUPABASE_SERVICE_ROLE_KEY. It reads every student\'s usage, so it is not\n' +
    'in .env.local; export it for this one command (Supabase → Project Settings → API).',
  );
  process.exit(2);
}

const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
const rpc = async (fn, body) => {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
};
const rest = async (path) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

const inr = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toFixed(2)}`);

// 1. The headline.
const [head] = await rpc('cost_per_student_hour', { p_days: days });
console.log(`\nLast ${days} days`);
console.log(`  closed sessions     ${head.sessions}`);
console.log(`  hours on task       ${head.active_hours ?? 0}`);
console.log(`  spend               ${inr(head.inr)}`);
console.log(`  PER STUDENT-HOUR    ${inr(head.inr_per_hour)}${head.unpriced_calls > 0 ? `   (a FLOOR — ${head.unpriced_calls} calls unpriced)` : ''}`);

// 2. What has been used but never priced. Until these are filled the number
//    above is a floor, and it says so.
const used = await rest('usage_event?select=provider,model&order=provider,model');
const priced = await rest('model_price?select=provider,model,unit');
const pricedKey = new Set(priced.map((p) => `${p.provider}/${p.model}`));
const unpriced = [...new Set(used.map((u) => `${u.provider}/${u.model ?? '-'}`))].filter((k) => !pricedKey.has(k));
if (unpriced.length > 0) {
  console.log(`\nUsed but never priced — insert rows into model_price for these:`);
  for (const k of unpriced) console.log(`  ${k}`);
} else if (used.length > 0) {
  console.log('\nEvery model in use has a price.');
} else {
  console.log('\nNo usage recorded yet. Take a class through the deployed relay and run this again.');
}

// 3. Where the money went, by session.
const sessions = await rest(
  `usage_cost?select=session_id,inr,unpriced&session_id=not.is.null&order=at.desc&limit=500`,
);
const bySession = new Map();
for (const row of sessions) {
  const s = bySession.get(row.session_id) ?? { inr: 0, calls: 0, unpriced: 0 };
  s.inr += Number(row.inr ?? 0);
  s.calls += 1;
  if (row.unpriced) s.unpriced += 1;
  bySession.set(row.session_id, s);
}
const top = [...bySession.entries()].sort((a, b) => b[1].inr - a[1].inr).slice(0, 8);
if (top.length > 0) {
  console.log('\nMost expensive recent sessions:');
  for (const [id, s] of top) {
    console.log(`  ${id.slice(0, 8)}  ${inr(s.inr).padStart(9)}  ${String(s.calls).padStart(3)} calls${s.unpriced ? `  (${s.unpriced} unpriced)` : ''}`);
  }
}
console.log();
