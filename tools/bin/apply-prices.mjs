/**
 * THE PRICES, APPLIED REPEATABLY — WITHOUT TAKING THE DECISION FROM THE PERSON
 * WHO PAYS THE BILL.
 *
 * model_price on the live project is empty, so cost_per_student_hour reports a
 * floor and every LLM row is unpriced. tools/sql/model_price.sql holds the
 * rows and is deliberately applied by no script: the numbers are a fact about
 * Aarav's vendor contract, and the person who pays confirms them. This CLI
 * splits the difference. It READS that file (never changes it), prints the
 * rows and their as-of date, DIFFS them against the live table over PostgREST,
 * and inserts ONLY when the operator typed --yes.
 *
 * Idempotent by diff, not by constraint: effective_from is part of the PK and
 * defaults to now(), so a blind re-run would insert a duplicate price at a new
 * timestamp. The diff is what prevents that — a row whose latest live price
 * already matches the file is UNCHANGED and never re-inserted, so running this
 * twice inserts nothing the second time.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY, and refuses the anon key the same way
 * cost-report.mjs does — plus by VALUE: if the key handed in IS the anon key
 * from .env.local, that is refused too. Be exact about why, because the
 * tempting sentence is wrong: model_price is world-READABLE (0008 lines
 * 108-110, policy "anyone may read prices" — for select using (true); an
 * anonymous GET against the live project returns 200). So the anon key would
 * print a perfectly good diff and then 401 on the INSERT, after the operator
 * had already typed --yes. Refusing up front is what keeps the failure from
 * landing half-way through.
 *
 * Run:  SUPABASE_SERVICE_ROLE_KEY=... node tools/bin/apply-prices.mjs        (diff only)
 *       SUPABASE_SERVICE_ROLE_KEY=... node tools/bin/apply-prices.mjs --yes  (diff, then insert)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseModelPriceSql } from '../prewarm/lib/modelPriceSql.mjs';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRICE_FILE = path.resolve(HERE, '../sql/model_price.sql');

/**
 * The guard, in cost-report's words and one step further. cost-report refuses
 * to run without the service role key rather than falling back to the anon key
 * (which cannot execute cost_per_student_hour at all — 0008 revokes it from
 * anon); this tool also refuses a key that EQUALS the anon key, because here
 * the failure mode is worse — the READ succeeds, so the diff looks right, and
 * only the write 401s, after the operator said --yes.
 */
export function assertServiceRoleKey(key, anonKey) {
  if (!key) {
    throw new Error(
      'apply-prices needs SUPABASE_SERVICE_ROLE_KEY. It writes the price table, so it is not\n' +
        'in .env.local; export it for this one command (Supabase → Project Settings → API).',
    );
  }
  if (anonKey && key === anonKey) {
    throw new Error(
      'that is the anon key, not the service role key. The anon key CAN read model_price\n' +
        '(0008 lets anyone read prices), so the diff would look right and only the insert\n' +
        'would 401 — half-applied, after you said --yes. Refusing before that.',
    );
  }
}

const keyOf = (r) => `${r.provider}/${r.model}/${r.unit}`;

/** Latest live row per (provider, model, unit) — history keeps older prices. */
export function latestLive(liveRows) {
  const latest = new Map();
  for (const row of liveRows) {
    const k = keyOf(row);
    const seen = latest.get(k);
    if (!seen || String(row.effective_from) > String(seen.effective_from)) latest.set(k, row);
  }
  return latest;
}

/**
 * File vs live, from the file's point of view: `missing` has no live row at
 * all, `changed` has a latest live price that differs, `unchanged` matches.
 * PostgREST serialises numeric as a string, so the comparison parses and
 * allows a relative tolerance rather than demanding bit-equality between a
 * JS double and Postgres numeric.
 */
export function diffPrices(fileRows, liveRows, tolerance = 1e-9) {
  const latest = latestLive(liveRows);
  const same = (a, b) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));

  const missing = [];
  const changed = [];
  const unchanged = [];
  for (const row of fileRows) {
    const live = latest.get(keyOf(row));
    if (!live) missing.push(row);
    else if (same(row.inrPerUnit, Number(live.inr_per_unit))) unchanged.push({ ...row, live });
    else changed.push({ ...row, live });
  }
  return { missing, changed, unchanged };
}

export async function fetchLivePrices({ url, key, fetchImpl = fetch }) {
  const res = await fetchImpl(
    `${url}/rest/v1/model_price?select=provider,model,unit,inr_per_unit,effective_from,note&order=provider,model,unit,effective_from`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`model_price read: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Insert the given file rows. effective_from is left to the column default
 *  (now()), which is the "a price change is a NEW row" rule from 0008. */
export async function insertRows({ url, key, rows, fetchImpl = fetch }) {
  const res = await fetchImpl(`${url}/rest/v1/model_price`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(
      rows.map((r) => ({
        provider: r.provider,
        model: r.model,
        unit: r.unit,
        inr_per_unit: r.inrPerUnit,
        note: r.note,
      })),
    ),
  });
  if (!res.ok) throw new Error(`model_price insert: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// Rs, not the glyph: house voice, and the same spelling the pre-warm runner
// and cost-report use, so a figure can be grepped across all three.
const rupees = (n) => `Rs ${Number(n).toFixed(9)}`;

async function main() {
  // Guarded: no .env.local is the ordinary state of an operator's machine,
  // and it should meet the key refusal below rather than an ENOENT trace.
  const env = readEnvLocal(path.resolve(HERE, '../../.env.local'));
  const URL_ = env.VITE_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  const yes = process.argv.includes('--yes');

  // THE FILE FIRST, THE KEY SECOND. Printing the rows and their as-of date
  // needs neither a key nor the network, and it is half of what this tool is
  // for: the operator who is being asked to confirm Aarav's numbers should be
  // able to READ them without holding the key that writes them.
  const parsed = parseModelPriceSql(fs.readFileSync(PRICE_FILE, 'utf8'));
  console.log(`\ntools/sql/model_price.sql — ${parsed.rows.length} rows, sources checked ${parsed.checked}, USD/INR ${parsed.rate}`);
  for (const r of parsed.rows) {
    console.log(`  ${`${r.provider}/${r.model}`.padEnd(38)} ${r.unit.padEnd(13)} ${rupees(r.inrPerUnit)}${r.note ? `  (${r.note})` : ''}`);
  }

  try {
    assertServiceRoleKey(KEY, env.VITE_SUPABASE_ANON_KEY);
  } catch (e) {
    console.error(`\n${e.message}`);
    process.exit(2);
  }

  const live = await fetchLivePrices({ url: URL_, key: KEY });
  const { missing, changed, unchanged } = diffPrices(parsed.rows, live);

  console.log(`\nAgainst the live table (${live.length} rows):`);
  for (const r of unchanged) {
    console.log(`  unchanged  ${r.provider}/${r.model} ${r.unit}  (live since ${r.live.effective_from})`);
  }
  for (const r of changed) {
    console.log(
      `  CHANGED    ${r.provider}/${r.model} ${r.unit}  live ${rupees(r.live.inr_per_unit)} (since ${r.live.effective_from}) → file ${rupees(r.inrPerUnit)}`,
    );
  }
  for (const r of missing) {
    console.log(`  NEW        ${r.provider}/${r.model} ${r.unit}  ${rupees(r.inrPerUnit)}`);
  }

  const toApply = [...missing, ...changed];
  if (toApply.length === 0) {
    console.log('\nNothing to apply — the live table already matches the file.');
    return;
  }
  if (!yes) {
    console.log(
      `\nDiff only — ${toApply.length} row(s) would be inserted (a changed price becomes a NEW row;` +
        ` history keeps the price it was billed at). Re-run with --yes to apply.`,
    );
    return;
  }
  await insertRows({ url: URL_, key: KEY, rows: toApply });
  console.log(`\nInserted ${toApply.length} row(s). Run cost-report to see rows priced.`);
}

// Import-safe: the tests import the pure halves; only a direct invocation
// touches .env.local or the network.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
