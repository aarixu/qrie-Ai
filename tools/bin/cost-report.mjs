/**
 * WHAT A STUDENT-HOUR ACTUALLY COSTS — the number Phase 2 prices a credit from.
 *
 * Reads the accounting the relay writes (migration 0008, columns widened by
 * 0018) and prints: the headline rupees per hour of a student actually
 * learning, the models that have been used but never priced, where the money
 * went by preparation and by bucket (live/warm — 0018's attribution columns,
 * read as "unattributed" while nothing writes them), and the most expensive
 * recent sessions. It does no arithmetic of its own; the rupee figure is the
 * database's `cost_per_student_hour`, so this and any other reader agree.
 *
 * `--student-hour` prints just the headline number WITH ITS FORMULA, so the
 * figure can be checked by eye against the two quantities it divides.
 *
 * An empty project degrades honestly: zero rows is "no data yet", never NaN.
 *
 * EVERY SECTION OBEYS THE SAME WINDOW. The headline comes from
 * cost_per_student_hour(p_days); the sections below used to read the newest
 * 2,000 usage rows whenever they landed and print the totals under a "Last N
 * days" heading — spend from outside the window included, spend past row 2,000
 * silently dropped. A total that under-reports without saying so is the same
 * defect as a floor that does not say it is a floor.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in the environment or in .env.local. That key
 * is deliberately NOT in .env.local today — it can read every student's rows —
 * so this refuses plainly rather than falling back to the anon key. The anon key
 * could not do this job anyway: cost_per_student_hour is revoked from anon and
 * granted only to service_role (0008 lines 213-216), and usage_event's RLS is
 * auth.uid() = user_id, which a keyed-but-unauthenticated caller never
 * satisfies. The fallback would fail outright or read an empty book on a
 * project with real spend — so the refusal is stated here, with its reason,
 * rather than surfacing later as a bare 403.
 *
 * Run: SUPABASE_SERVICE_ROLE_KEY=... node tools/bin/cost-report.mjs [days] [--student-hour]
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

const inr = (n) => (n === null || n === undefined ? '—' : `Rs ${Number(n).toFixed(2)}`);

/**
 * The whole report, callable: the tests run it against a mocked PostgREST
 * because the service key is deliberately not on every machine, and main()
 * below runs it against the real one when the key is.
 */
export async function runReport({ url, key, days = 30, studentHour = false, fetchImpl = fetch, log = console.log }) {
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const rpc = async (fn, body) => {
    const res = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const rest = async (p) => {
    const res = await fetchImpl(`${url}/rest/v1/${p}`, { headers });
    if (!res.ok) throw new Error(`${p}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  // THE WINDOW, in the database's own terms. Every read below carries it, so
  // no figure on the page is computed from rows outside the heading.
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  // A cap, not a window: the newest N rows INSIDE the window. Disclosed when
  // it binds, because a total that quietly drops rows is a lie with a decimal
  // point on it.
  const ROW_CAP = 2000;

  // 1. The headline. On an empty project every field is null or zero, and the
  //    honest sentence is "no data yet" rather than ₹NaN.
  const [head] = await rpc('cost_per_student_hour', { p_days: days });
  const sessions = Number(head?.sessions ?? 0);

  if (studentHour) {
    log(`\nRs/student-hour, last ${days} days`);
    if (sessions === 0) {
      log('  no data yet — no closed sessions in the window. Take a class through the deployed relay first.');
      return;
    }
    log(`  spend ${inr(head.inr)} ÷ hours ${head.active_hours} = ${inr(head.inr_per_hour)} per student-hour`);
    log(
      '  (the division is done in the database: cost_per_student_hour = sum(usage_cost.inr over closed sessions)',
    );
    log('   ÷ sum(learning_session.active_ms)/3,600,000 — see migration 0008)');
    if (Number(head.unpriced_calls) > 0) {
      log(`  a FLOOR \u2014 ${head.unpriced_calls} calls in the window have no price row; run apply-prices.`);
    }
    // WHAT THE HEADLINE CANNOT SEE. cost_per_student_hour sums usage_cost rows
    // joined onto CLOSED learning_sessions (0008), and a preparation has no
    // session: the pre-warm runner sends no x-session-id, so every row it
    // writes lands with session_id null. That is the catalogue CAPEX \u2014 the
    // largest line in the cost model, and the whole reason pre-warming exists
    // \u2014 sitting outside the number somebody will price a credit from.
    const loose = await rest(`usage_cost?select=inr&session_id=is.null&at=gte.${since}`);
    const capex = loose.reduce((t, r) => t + Number(r.inr ?? 0), 0);
    if (capex > 0) {
      log(`  EXCLUDES ${inr(capex)} of spend attached to no sitting (preparation, mostly).`);
      log('   Amortised over the S students who reach those topics that is the same sum \u00f7 S per');
      log('   student-hour \u2014 so the figure above is the MARGINAL cost of a sitting, not the');
      log('   full cost of the product.');
    }
    return;
  }

  log(`\nLast ${days} days`);
  if (sessions === 0) {
    log('  no closed sessions — no data yet.');
  } else {
    log(`  closed sessions     ${head.sessions}`);
    log(`  hours on task       ${head.active_hours ?? 0}`);
    log(`  spend               ${inr(head.inr)}`);
    log(`  PER STUDENT-HOUR    ${inr(head.inr_per_hour)}${head.unpriced_calls > 0 ? `   (a FLOOR — ${head.unpriced_calls} calls unpriced)` : ''}`);
  }

  // 2. What has been used but never priced. Until these are filled the number
  //    above is a floor, and it says so — loudly, with the fix named.
  // PER UNIT, not per model. model_price's key is (provider, model, unit) and
  // 0008's own `unpriced` flag tests each quantity separately, so a model with
  // a prompt_token row and no output_token row is PARTLY priced. Keyed by
  // model alone, such a model read as fully priced — and the report could
  // print "a FLOOR — N calls unpriced" and "Every model in use has a price."
  // in the same run. A reader believes the sentence that names no fix.
  const QUANTITY_UNITS = [
    ['prompt_tokens', 'prompt_token'],
    ['output_tokens', 'output_token'],
    ['thought_tokens', 'thought_token'],
    ['images', 'image'],
    ['characters', 'character'],
    ['audio_bytes', 'audio_second'],
    ['bytes', 'byte'],
  ];
  const used = await rest(
    `usage_event?select=provider,model,${QUANTITY_UNITS.map(([c]) => c).join(',')}` +
      `&at=gte.${since}&order=provider,model`,
  );
  const priced = await rest('model_price?select=provider,model,unit');
  const pricedModel = new Set(priced.map((p) => `${p.provider}/${p.model}`));
  const pricedUnit = new Set(priced.map((p) => `${p.provider}/${p.model}/${p.unit}`));

  const holes = new Map();
  for (const u of used) {
    const model = `${u.provider}/${u.model ?? '-'}`;
    if (!pricedModel.has(model)) {
      holes.set(model, 'no price rows at all');
      continue;
    }
    for (const [column, unit] of QUANTITY_UNITS) {
      // A quantity of null or 0 was never billed, so it needs no price; only
      // a quantity that actually happened can be a hole.
      if (!u[column]) continue;
      if (!pricedUnit.has(`${model}/${unit}`)) {
        const said = holes.get(model);
        holes.set(model, said && said !== 'no price rows at all' ? `${said}, ${unit}` : unit);
      }
    }
  }

  if (holes.size > 0) {
    log(`\nUSED BUT NEVER PRICED — every Rs above is a floor until these have rows:`);
    for (const [model, what] of holes) log(`  ${model.padEnd(34)}  ${what}`);
    log('  Fix: node tools/bin/apply-prices.mjs   (diff first, then --yes to insert)');
  } else if (used.length > 0 && Number(head?.unpriced_calls ?? 0) > 0) {
    // The two answers disagree, so say so rather than printing the comfortable
    // one. 0008's flag does not test thought_tokens or bytes at all, so it can
    // also be reading a hole this list cannot see — a handoff, recorded in
    // tools/prewarm/README.md, not something this file can fix.
    log(`\nEvery unit this report can check has a price, yet the database counts`);
    log(`  ${head.unpriced_calls} unpriced call(s) in the window. Run apply-prices and re-read; if it`);
    log('  persists the hole is in a unit outside this check (see tools/prewarm/README.md).');
  } else if (used.length > 0) {
    log('\nEvery model in use has a price.');
  } else {
    log('\nNo usage recorded yet. Take a class through the deployed relay and run this again.');
  }

  // 3. Where the money went. One fetch serves both the 0018 attribution view
  //    and the per-session ranking — windowed like everything above it.
  const rows = await rest(
    `usage_cost?select=session_id,prep_id,bucket,inr,unpriced&at=gte.${since}` +
      `&order=at.desc&limit=${ROW_CAP}`,
  );
  if (rows.length === ROW_CAP) {
    log(
      `\n  (the sections below read the newest ${ROW_CAP} usage rows in the window and there` +
        ` are more — their totals are FLOORS, not the window's full spend)`,
    );
  }

  // 3a. By bucket and preparation (0018's prep_id/bucket). Null is every row
  //     written before attribution existed and every call that is neither
  //     side of the cache — read as "unattributed", never as either bucket.
  const attributed = rows.filter((r) => r.prep_id !== null || r.bucket !== null);
  if (rows.length > 0 && attributed.length === 0) {
    log('\nPrep attribution: no row carries prep_id or bucket yet (0018 columns).');
    log('  prep_id is WAITING ON DEPLOYMENT: migration 0019 gives record_usage a p_prep_id');
    log('   argument and the relay already passes it, but 0019 is an unapplied file here and');
    log('   the deployed relay predates it unless it has since been redeployed (NOT VERIFIED).');
    log('  bucket has NO WRITER ANYWHERE: nothing in packages/relay reads a bucket header or');
    log('   writes usage_event.bucket, so this section stays empty until somebody wires it.');
  } else if (attributed.length > 0) {
    const byBucket = new Map();
    for (const r of rows) {
      const b = r.bucket ?? 'unattributed';
      byBucket.set(b, (byBucket.get(b) ?? 0) + Number(r.inr ?? 0));
    }
    log('\nBy bucket (live = paid to prepare, warm = served the cached class):');
    for (const [bucket, total] of [...byBucket.entries()].sort((a, b) => b[1] - a[1])) {
      log(`  ${bucket.padEnd(13)} ${inr(total).padStart(10)}`);
    }

    const byPrep = new Map();
    for (const r of rows) {
      if (r.prep_id === null) continue;
      const p = byPrep.get(r.prep_id) ?? { inr: 0, calls: 0 };
      p.inr += Number(r.inr ?? 0);
      p.calls += 1;
      byPrep.set(r.prep_id, p);
    }
    if (byPrep.size > 0) {
      log('\nMost expensive preparations:');
      for (const [id, p] of [...byPrep.entries()].sort((a, b) => b[1].inr - a[1].inr).slice(0, 8)) {
        log(`  ${id.slice(0, 8)}  ${inr(p.inr).padStart(9)}  ${String(p.calls).padStart(3)} calls`);
      }
    }
  }

  // 3b. By session, as before.
  const bySession = new Map();
  for (const row of rows) {
    if (row.session_id === null) continue;
    const s = bySession.get(row.session_id) ?? { inr: 0, calls: 0, unpriced: 0 };
    s.inr += Number(row.inr ?? 0);
    s.calls += 1;
    if (row.unpriced) s.unpriced += 1;
    bySession.set(row.session_id, s);
  }
  const top = [...bySession.entries()].sort((a, b) => b[1].inr - a[1].inr).slice(0, 8);
  if (top.length > 0) {
    log('\nMost expensive recent sessions:');
    for (const [id, s] of top) {
      log(`  ${id.slice(0, 8)}  ${inr(s.inr).padStart(9)}  ${String(s.calls).padStart(3)} calls${s.unpriced ? `  (${s.unpriced} unpriced)` : ''}`);
    }
  }
  log('');
}

async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  // Guarded: a machine with no .env.local is the ordinary case for whoever
  // runs this, and it should meet the key refusal below rather than an ENOENT.
  const env = readEnvLocal(path.resolve(HERE, '../../.env.local'));
  const URL_ = env.VITE_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  const args = process.argv.slice(2);
  const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 30);
  const studentHour = args.includes('--student-hour');

  if (!KEY) {
    console.error(
      'cost-report needs SUPABASE_SERVICE_ROLE_KEY. It reads every student\'s usage, so it is not\n' +
        'in .env.local; export it for this one command (Supabase → Project Settings → API).',
    );
    process.exit(2);
  }

  await runReport({ url: URL_, key: KEY, days, studentHour });
}

// Import-safe for the tests; a direct run reads .env.local and the live books.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
