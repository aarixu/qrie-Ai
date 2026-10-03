/**
 * THE RUNNER'S BODY. Loaded by run.mjs AFTER the resolve hook is in, because
 * this file is what imports the app's TypeScript.
 *
 * Per topic it mirrors prepareLiveClass (apps/classroom/src/lib/liveClass.ts)
 * deliberately, model for model and step for step — plan, review, draw,
 * dress the nouns, then keep — because a runner that prepared a DIFFERENT
 * class than the app would have made is not pre-warming the product, it is
 * shipping a second product.
 *
 * THREE DELIBERATE DIVERGENCES FROM THE APP, all named so none is mistaken
 * for drift:
 *
 *   1. THE FACTUAL REVIEWER IS ON — and since C10 the app's is too
 *      (liveClass.ts passes one with the same model id, and its keep()
 *      refuses a report with no review), so this is no longer a divergence
 *      unless it is turned off. A kept class is stored 'pending' by the
 *      relay (classStore.ts, I1) and served to no student until an operator
 *      publishes it; once published it is served to every later student
 *      until retracted. `--no-review` turns it off, and in a spending run it demands
 *      `--i-accept-unreviewed` on top, because that flag industrialises
 *      whatever the reviewer would have caught. It is NOT free: it adds a
 *      planner-grade call per topic (plus a repair plan and a second review
 *      when anything is flagged) that PRD-6's Rs 26-40 band does not price.
 *
 *   2. GRAPHICS FAILURES ARE SURVIVED, exactly as liveClass.ts survives them
 *      ("The board shows what it has"). Letting an icon-picker hiccup throw
 *      would discard a fully prepared and fully PAID-FOR lesson and put it
 *      back in the pending set to be bought again.
 *
 *   3. A CLASS THE KEEP GATE WILL REFUSE IS STOPPED EARLY. prepareClass is
 *      called with `stopWhenUnkeepable`, so a plan still failing the keep gate
 *      after its repair round throws before the reviewer and the pictures,
 *      and a class refused at the end is not sent to the icon picker. The app
 *      teaches such a class to the student who is waiting and keeps none of
 *      it; with no student here, everything after the refusal was waste.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { ALL_CLASS_9_10_SCIENCE, outcomesFor } from './topics.mjs';
import { dedupeSyllabi, planFor } from './plan.mjs';
import {
  acquireStateLock,
  dropRefused,
  loadRefused,
  markTopic,
  refusedPath,
  saveRefused,
  saveState,
  shouldStop,
  MAX_CONSECUTIVE_FAILURES,
} from './state.mjs';
import { PER_TOPIC_INR, estimate } from './estimate.mjs';
import { parseModelPriceSql } from './modelPriceSql.mjs';
import { readEnvLocal } from './envLocal.mjs';
import { writeClassTo } from './out.mjs';
import { createRelayClient, priceCalls } from './relayAdapters.mjs';

// The pipeline itself — imported by path, READ-ONLY. Any browser-coupling
// found here is a named handoff to phase E, never an edit.
import {
  createCommonsSearch,
  drawMissingIcons,
  pickIcons,
  prepareClass,
  rekeep,
  saveable,
  whyNotSaveable,
} from '../../../packages/class-prep/src/index.ts';
import { candidatesFor, pencilGlyph } from '../../../packages/graphics/src/resolve.ts';
import { askAgainLater } from '../../../packages/class-prep/src/notNow.ts';

/**
 * EVERY MODEL CALL HERE WAITS OUT "NOT NOW". class-prep keeps its wait to the
 * repair rounds because the app's calls have a student waiting; nothing in this
 * runner is interactive, and every call is paid for. A 429 on the fact-check
 * threw away a Respiration plan that had already passed the keep gate
 * (2026-10-02, Rs 5.13).
 */
const patient = (adapter) => ({
  ...adapter,
  complete: (system, user) =>
    askAgainLater(
      () => adapter.complete(system, user),
      {},
      (ms) => process.stdout.write(`\n    busy      waiting ${Math.round(ms / 1000)} s and asking again\n`),
    ),
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const require = createRequire(import.meta.url);

/**
 * The exact models liveClass.ts uses, for the reasons its docblocks measure.
 * Restated rather than imported because liveClass.ts pulls in the app's
 * stores; if these ever drift from liveClass.ts, the runner is warming the
 * wrong product — which is why tests/models.test.ts reads both files as text
 * and fails the day they disagree.
 */
const PLANNER_MODEL = 'google/gemini-3.7-flash';
const ARTIST_MODEL = 'google/gemini-3.7-flash';
const PICKER_MODEL = 'google/gemini-3.1-flash-lite';
const IMAGE_MODEL = 'google/gemini-3.1-flash-image';
const VISION_MODEL = 'google/gemini-3.7-flash';
/** The factual gate reads more than it writes; same planner-grade model.
 *  liveClass.ts declares the same id since C10 — see the header above. */
const REVIEWER_MODEL = 'google/gemini-3.7-flash';

const inr = (n) => `Rs ${Number(n).toFixed(2)}`;

// ------------------------------------------------------------------ args ----

export function parseArgs(argv) {
  const args = {
    syllabi: [],
    chapter: undefined,
    topic: undefined,
    dryRun: false,
    spend: false,
    review: true,
    acceptUnreviewed: false,
    force: false,
    rekeep: false,
    out: undefined,
    as: undefined,
    relay: process.env.PREWARM_RELAY_URL,
    token: process.env.PREWARM_TOKEN,
    stateDir: path.resolve(HERE, '../state'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${a} needs a value`);
      return argv[i];
    };
    if (a === '--syllabus') args.syllabi.push(next());
    else if (a === '--chapter') args.chapter = next();
    else if (a === '--topic') args.topic = next();
    else if (a === '--all-class9-10-science') args.syllabi.push(...ALL_CLASS_9_10_SCIENCE);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--spend') args.spend = true;
    else if (a === '--no-review') args.review = false;
    else if (a === '--i-accept-unreviewed') args.acceptUnreviewed = true;
    else if (a === '--force') args.force = true;
    else if (a === '--rekeep') args.rekeep = true;
    else if (a === '--out') args.out = path.resolve(next());
    else if (a === '--as') args.as = next();
    else if (a === '--relay') args.relay = next();
    else if (a === '--token') args.token = next();
    else if (a === '--state-dir') args.stateDir = path.resolve(next());
    else throw new Error(`unknown argument: ${a} (see tools/prewarm/README.md)`);
  }
  // BEFORE the single-syllabus check below, so `--syllabus x --syllabus x
  // --chapter y` stays legal: it names one syllabus, clumsily.
  args.syllabi = dedupeSyllabi(args.syllabi);
  if (args.syllabi.length === 0) {
    throw new Error('say what to warm: --syllabus <id> (repeatable) or --all-class9-10-science');
  }
  if ((args.chapter || args.topic) && args.syllabi.length !== 1) {
    throw new Error('--chapter/--topic filters need exactly one --syllabus');
  }
  // `--as` puts ONE class in the place of one lesson; two topics under one id
  // would overwrite each other.
  if (args.as && (!args.out || !args.topic)) {
    throw new Error('--as <id> needs --out <dir> and exactly one --topic');
  }
  return args;
}

// ------------------------------------------------------- already kept? ------

/**
 * WHICH PROJECT THE SKIP CHECK SPEAKS FOR. Derived from --relay, not from
 * .env.local: the classes are kept THROUGH the relay, so the only project
 * whose catalogue can answer "would this keep be a duplicate?" is the relay's
 * own. Reading .env.local instead let an operator warming a staging relay ask
 * project A about work being written to project B — and a false yes is
 * written as `skipped`, which never comes back. .env.local is the fallback
 * only when --relay is not a Supabase functions URL, and then the answer is
 * about whatever project that file names.
 */
export function catalogueOrigin(relayUrl, envUrl) {
  const m = /^(https?:\/\/[^/]+)\/functions\/v1\//.exec(String(relayUrl ?? ''));
  if (m) return { origin: m[1], from: '--relay' };
  if (envUrl) return { origin: envUrl, from: '.env.local' };
  return { origin: null, from: null };
}

/**
 * Is this topic already IN THE CATALOGUE on the project being written to?
 *
 * Asks prepared_class, not the storage bucket, and the difference is a
 * permanent catalogue hole. keepClass writes every file FIRST and the
 * catalogue row LAST on purpose (packages/relay/src/classStore.ts:56-64 —
 * "files with no row are invisible"), so a half-finished keep leaves exactly
 * the lesson.json a bucket probe would read as success, and the one topic
 * that most needs warming would be recorded as warm forever. prepared_class
 * is the authoritative catalogue, it is anon-readable ("anyone may read
 * prepared classes", supabase/migrations/0004_prepared_class.sql:44-47), and
 * topic_ref is `not null unique` there — so one GET answers it exactly.
 *
 * WHY THE CHECK EXISTS AT ALL: a second keep is NOT refused. classStore
 * tolerates a 409 on every file ("a race, not a fault", classStore.ts:89-93)
 * and posts the catalogue row with `prefer: resolution=ignore-duplicates`
 * (classStore.ts:103-105), then returns 200 {ok:true}. So re-preparing a kept
 * topic spends the money, has the new class silently discarded in favour of
 * the stored one, and reports `done`. Nothing anywhere signals that the
 * Rs ~30 bought nothing. Any failure here means "unknown", and unknown
 * proceeds — an unknown that skipped would be the catalogue hole again.
 */
export async function alreadyKeptLive(probe, topicRef, fetchImpl = fetch) {
  if (!probe?.origin || !probe?.key) return false;
  try {
    const res = await fetchImpl(
      `${probe.origin}/rest/v1/prepared_class?topic_ref=eq.${encodeURIComponent(topicRef)}&select=id`,
      { headers: { apikey: probe.key, authorization: `Bearer ${probe.key}` } },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------- the nouns -------

/** Same sets, same order as the dev icon relay (apps/classroom/vite.config.ts). */
const PREFERRED_SETS = ['noto', 'fluent-emoji', 'ph', 'tabler'];
let iconSets = null;
function loadIconSets() {
  if (iconSets) return iconSets;
  iconSets = PREFERRED_SETS.map((prefix) => {
    const json = require(`@iconify/json/json/${prefix}.json`);
    return {
      prefix,
      width: json.width ?? 24,
      height: json.height ?? 24,
      icons: json.icons,
      categories: json.categories,
    };
  });
  return iconSets;
}

/**
 * fetchGraphics from liveClass.ts, without the HTTP hop: the 443 MB icon
 * package is right here on disk, so the lookup that the dev server does for
 * the browser is done in-process. The MODEL steps are identical — pickIcons
 * chooses which meaning of a word the lesson wants, drawMissingIcons draws
 * the nouns nothing depicts, the pencilled circle is the last resort.
 */
async function dressNouns(lesson, topic, picker, iconArtist) {
  const nouns = [
    ...new Set(lesson.elements.filter((el) => el.kind === 'graphic').map((el) => el.noun)),
  ];
  if (nouns.length === 0) return {};

  const sets = loadIconSets();
  const found = Object.fromEntries(
    nouns.map((noun) => [noun, { candidates: candidatesFor(noun, sets, 8), pencil: pencilGlyph(noun) }]),
  );
  const options = Object.fromEntries(
    nouns.map((noun) => [
      noun,
      found[noun].candidates.map((c) => ({
        icon: c.source.icon,
        set: c.source.set,
        ...(c.category ? { category: c.category } : {}),
      })),
    ]),
  );
  const chosen = await pickIcons(topic, options, picker);

  // A deliberate refusal stays refused — the armoured-tank rule from
  // liveClass.ts. Falling back to candidates[0] after a refusal put the
  // refused icon back on the board.
  const glyphFor = (noun) => {
    const f = found[noun];
    if (!f) return null;
    const pick = chosen[noun];
    if (pick?.deliberate) {
      const named =
        pick.icon && pick.set
          ? f.candidates.find((c) => c.source.icon === pick.icon && c.source.set === pick.set)
          : undefined;
      return named?.glyph ?? null;
    }
    return f.candidates[0]?.glyph ?? null;
  };

  const missing = nouns.filter((n) => glyphFor(n) === null);
  const drawn = missing.length > 0 ? await drawMissingIcons(topic, missing, iconArtist) : {};

  const assets = {};
  for (const el of lesson.elements) {
    if (el.kind !== 'graphic') continue;
    const custom = drawn[el.noun];
    if (custom) {
      assets[el.id] = custom;
      continue;
    }
    const glyph = glyphFor(el.noun) ?? found[el.noun]?.pencil;
    if (!glyph) continue;
    assets[el.id] =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${glyph.width} ${glyph.height}">` +
      `${glyph.body}</svg>`;
  }
  return assets;
}

// ---------------------------------------------------------- one topic -------

/** The meta a topic is kept under — the same for a first keep and a re-keep. */
const metaFor = (row) => ({
  topicRef: row.path,
  klass: row.klass,
  subject: row.subject,
  subtitle: `Class ${row.klass} · ${row.chapterTitle}`,
  // Anonymous by construction — the runner has no student and passes no
  // studentLines, so the name check has nothing to catch. Stated so the
  // empty array is a decision, not an omission.
  studentNames: [],
});

/**
 * Dress a prepared class's nouns and keep it. Divergence 2 from the header:
 * the app's try/catch, for the app's reason ("The board shows what it has",
 * liveClass.ts). Here it is a money rule as well — the lesson is bought and
 * paid for, and throwing it away over an icon would put it back in the
 * pending set and buy it again next run.
 */
async function dressAndKeep(made, row, client, keepRefused, writeOut) {
  let graphics = {};
  try {
    graphics = await dressNouns(
      made.lesson,
      row.topic.title,
      patient(client.llm(PICKER_MODEL, { json: true })),
      patient(client.llm(ARTIST_MODEL)),
    );
  } catch (e) {
    console.warn(
      `    nouns left undressed (${e instanceof Error ? e.message : e}) — keeping the class` +
        ' anyway, as the app does',
    );
  }
  Object.assign(made.assets, graphics);

  const meta = metaFor(row);
  const saved = saveable(made, meta);
  if (!saved) {
    // WHICH rule refused it, from the same function saveable refuses by, and
    // the report itself carried on the error: this topic is already paid for,
    // and the state file is the only place left to diagnose it from.
    const why = whyNotSaveable(made, meta);
    const reason = `prepared but NOT kept — ${why.length > 0 ? why.join('; ') : 'saveable named no reason'}; nothing was kept`;
    keepRefused?.(made, meta, reason);
    throw Object.assign(new Error(reason), { issues: made.report.issues, gateProblems: made.report.gate?.problems ?? [] });
  }

  // Written out BEFORE the keep, so a keep the catalogue refuses (a topic it
  // already holds) still leaves the class that was paid for on disk.
  writeOut?.(saved);
  const kept = await client.keep(saved);
  if (!kept.ok) {
    throw new Error(`keep refused (${kept.status}): ${kept.body?.error?.message ?? 'no message'}`);
  }
  return { keptId: saved.id, issues: made.report.issues };
}

async function warmOne(row, opts, client, keepRefused, writeOut) {
  // Exactly what LiveClass.tsx builds from a topicRef: title as the topic,
  // the syllabus' own minutes clamped to 1..4, subtitle for the catalogue.
  const minutes = Math.min(4, Math.max(1, row.topic.estMinutes ?? 2));
  const outcomes = outcomesFor(row.path);

  const made = await prepareClass({
    topic: row.topic.title,
    klass: row.klass,
    minutes,
    outcomes,
    // A full, well-annotated page per subtopic (board composer), as the live classroom prepares.
    composed: true,
    planner: patient(client.llm(PLANNER_MODEL, { json: true })),
    artist: patient(client.llm(ARTIST_MODEL)),
    ...(opts.review ? { reviewer: patient(client.llm(REVIEWER_MODEL, { json: true })) } : {}),
    imageArtist: client.imageArtist(IMAGE_MODEL),
    eyes: client.vision(VISION_MODEL),
    web: createCommonsSearch(),
    // THE RUNNER ONLY KEEPS, so a class the keep gate will refuse is stopped
    // right after its repair round — before the reviewer and the pictures are
    // paid for. On 2026-10-01 all three refused Class 10 Science topics were
    // already refused there and went on to spend about thirty more calls each
    // (canvas audit, item 1). The thrown error carries `gateProblems` and
    // `issues`, which the catch in main() writes to the state file. The app
    // does not set this: a student is waiting for that class.
    stopWhenUnkeepable: true,
    onProgress: (p) => {
      process.stdout.write(`\r    ${p.phase.padEnd(9)} ${p.message.padEnd(60).slice(0, 60)}`);
    },
  });
  process.stdout.write('\n');

  // A class the keep gate refused is not dressed: the icon picker and the
  // icon artist are paid calls, and saveable would refuse the class anyway.
  // Everything already bought for it is written down for `--rekeep`.
  if (made.report.gate && made.report.gate.problems.length > 0) {
    const reason = `prepared but NOT kept — the keep gate failed it: ${made.report.gate.problems
      .map((p) => `${p.rule}@${p.where}`)
      .join(', ')}; nothing was kept, and its nouns were not dressed`;
    keepRefused?.(made, metaFor(row), reason);
    throw Object.assign(new Error(reason), { issues: made.report.issues, gateProblems: made.report.gate.problems });
  }
  return dressAndKeep(made, row, client, keepRefused, writeOut);
}

/**
 * `--rekeep`: one refused class, laid out again with today's engine
 * (class-prep `rekeep`, no model call for the class), then dressed and kept
 * the ordinary way. Throws, with the gate's words, when today's layout still
 * refuses it — and leaves its record where it was for the next fix.
 */
async function rekeepOne(row, record, client, writeOut) {
  const again = rekeep(record.made, { outcomes: outcomesFor(row.path) });
  if (again.problems.length > 0) {
    throw Object.assign(
      new Error(
        `laid out again, still refused: ${again.problems.map((p) => `${p.rule}@${p.where}`).join(', ')}; ` +
          'the record stays for the next fix',
      ),
      { gateProblems: again.problems },
    );
  }
  return dressAndKeep(again.made, row, client, undefined, writeOut);
}

// --------------------------------------------------------------- main -------

/**
 * The gate's own words for "not now" (gate.ts:166). None of them is a broken
 * prompt, so none of them counts towards the three-strike stop.
 */
const BUDGET_REASONS = new Set(['budget', 'capped', 'halted']);

export async function main(argv) {
  const opts = parseArgs(argv);
  const env = readEnvLocal(path.join(ROOT, '.env.local'));
  const prices = parseModelPriceSql(
    fs.readFileSync(path.join(ROOT, 'tools/sql/model_price.sql'), 'utf8'),
  );

  // The plan, before any money: every syllabus' pending topics after the
  // state file has said what is already done. ONE entry per syllabus however
  // many times it was named — see plan.mjs for why that is a money rule.
  const plan = planFor({
    syllabi: opts.syllabi,
    chapter: opts.chapter,
    topic: opts.topic,
    stateDir: opts.stateDir,
  });

  const totalTopics = plan.reduce((n, p) => n + p.rows.length, 0);
  const pendingCount = plan.reduce((n, p) => n + p.pending.size, 0);
  const est = estimate(pendingCount);

  if (opts.dryRun) {
    console.log('DRY RUN — nothing is planned, nothing is spent.\n');
    for (const p of plan) {
      console.log(`${p.syllabusId} — ${p.rows.length} topics`);
      for (const r of p.rows) {
        const seen = p.state.topics[r.path];
        const mark = seen ? `[${seen.status}]` : '[pending]';
        console.log(`  ${mark.padEnd(10)} ${r.path}  — ${r.topic.title}`);
      }
    }
    console.log(
      `\n${totalTopics} topics, ${pendingCount} pending after the state file` +
        ` (${totalTopics - pendingCount} already done/skipped).`,
    );
    console.log(
      `Estimated spend for the pending ${pendingCount}: ${inr(est.plan)} at the` +
        ` Rs ${PER_TOPIC_INR.plan}/topic planning number — band ${inr(est.low)} to ${inr(est.high)}` +
        ` (Rs ${PER_TOPIC_INR.low}-${PER_TOPIC_INR.high}/topic, PRD-6).`,
    );
    if (opts.review) {
      console.log(
        'THE BAND DOES NOT PRICE THE REVIEWER, and the reviewer is on (--no-review turns it off).',
      );
      console.log(
        '  PRD-6 measured a class prepared WITHOUT one, so add a planner-grade call per topic,' +
          '\n  plus a repair plan and a second review on any topic it flags. The estimate above is' +
          '\n  a floor while the gate runs.',
      );
    }
    console.log(
      `Prices for the spend line come from tools/sql/model_price.sql (checked ${prices.checked}).`,
    );
    console.log(
      '\nTHE GATE MAKES A CATALOGUE WARM A MULTI-DAY OPERATION. Every call here is metered like' +
        '\n  a student: 85 units per /api/llm call and 10 per keep (packages/relay/src/gate.ts:102,' +
        '\n  :105), 12,000 units per identity per UTC day (gate.ts:385) and 50,000 for the whole' +
        '\n  project (gate.ts:160) — shared with real children. At 8-12 llm calls a topic (NOT' +
        '\n  VERIFIED — no topic has yet been warmed through this runner) that is roughly 700-1,000' +
        '\n  units, so one identity buys on the order of 12-17 topics a day. A budget refusal STOPS' +
        '\n  the run rather than counting as a failure, and the state file resumes tomorrow; but a' +
        '\n  refusal that lands mid-topic still wastes what that topic had already spent.',
    );
    return;
  }

  if (!opts.relay || !opts.token) {
    throw new Error(
      'a live run needs --relay <url> and --token <bearer> (or PREWARM_RELAY_URL / PREWARM_TOKEN).' +
        ' Use --dry-run to see the plan without either.',
    );
  }
  // --rekeep touches only topics with a refused record, and buys no plan,
  // review or picture for them — only their nouns' icons and the keep.
  const refusedCount = opts.rekeep
    ? plan.reduce((n, p) => n + p.rows.filter((r) => loadRefused(opts.stateDir, p.syllabusId, r.path)).length, 0)
    : 0;
  if (!opts.spend) {
    throw new Error(
      opts.rekeep
        ? `this run would lay out again and keep ${refusedCount} refused classes, paying only for their icons and` +
            ' the keep. Add --spend if you mean it.'
        : `this run would prepare ${pendingCount} topics for roughly ${inr(est.plan)} of real money` +
            ` (band ${inr(est.low)}–${inr(est.high)}). Add --spend if you mean it, or --dry-run to look.`,
    );
  }
  if (!opts.review && !opts.acceptUnreviewed) {
    // A kept class, once published, is served to every later student until
    // it is retracted, and topic_ref is unique, so a wrong one is not quietly
    // replaced later. review.ts:5-14
    // puts it plainly: pre-warming without the gate is industrialising the
    // error. One flag should not be able to do that to a catalogue silently.
    throw new Error(
      `--no-review would keep ${pendingCount} classes that NOTHING has fact-checked, permanently,` +
        ` for children. If that is deliberate, add --i-accept-unreviewed as well.`,
    );
  }

  const probe = {
    ...catalogueOrigin(opts.relay, env.VITE_SUPABASE_URL),
    key: process.env.PREWARM_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? null,
  };
  if (!probe.origin || !probe.key) {
    console.warn(
      'NO DUPLICATE CHECK THIS RUN: reading prepared_class needs the project origin and an anon' +
        ' key (PREWARM_ANON_KEY, or .env.local). A topic already in the catalogue will be' +
        ' prepared, paid for, and silently discarded by the keep. The state file is the only' +
        ' guard left, so do not point a fresh --state-dir at a warm project.',
    );
  } else {
    console.log(`Duplicate check reads ${probe.origin} (from ${probe.from}).`);
  }

  // ONE PROCESS AT A TIME per state directory. saveState is atomic per write,
  // but two runs both read the pending set before either writes, so both
  // prepare every topic — the same double-pay the dedupe closes, one step out.
  const locks = plan.map((p) => acquireStateLock(opts.stateDir, p.syllabusId, { force: opts.force }));

  let consecutiveFailures = 0;
  let totalInr = 0;
  let totalUnmeasured = 0;
  let stoppedBy = null;

  try {
    for (const p of plan) {
      if (stoppedBy) break;
      for (const row of p.rows) {
        if (stoppedBy) break;
        const refused = opts.rekeep ? loadRefused(opts.stateDir, p.syllabusId, row.path) : null;
        if (opts.rekeep ? !refused : !p.pending.has(row.path)) continue;

        // With --out the class is wanted on disk whatever the catalogue holds.
        if (!opts.out && (await alreadyKeptLive(probe, row.path))) {
          // Carry forward what an earlier failed attempt spent. The topic is
          // genuinely in the catalogue now, so paying again would buy a class
          // the keep would silently discard — but the money already burnt on
          // it must not disappear from the books along with the note.
          const before = p.state.topics[row.path];
          markTopic(p.state, row.path, {
            status: 'skipped',
            reason:
              before?.status === 'failed'
                ? `already in the catalogue; an earlier attempt failed here (${before.reason ?? 'no reason recorded'})`
                : 'already in the catalogue on the project this relay writes to',
            ...(before?.spendInr ? { spendInr: before.spendInr, calls: before.calls } : {}),
          });
          saveState(opts.stateDir, p.state);
          console.log(`  skipped   ${row.path} — already in the catalogue`);
          continue;
        }

        console.log(`\n  ${refused ? 'rekeeping' : 'warming  '} ${row.path} — ${row.topic.title}`);
        // One prep id per topic, minted here so the FAILED arm can still write
        // it down beside what the failure cost.
        const prepId = randomUUID();
        const client = createRelayClient({ relayUrl: opts.relay, token: opts.token, prepId });
        /** A class refused at the end, written down with everything it was laid out from. */
        const keepRefused = (made, meta, reason) => {
          if (!made.replay) return;
          const file = saveRefused(opts.stateDir, p.syllabusId, row.path, {
            prepId,
            reason,
            meta,
            made: { lesson: made.lesson, assets: made.assets, report: made.report, replay: made.replay },
          });
          console.log(`  saved     the refused class for --rekeep: ${file}`);
        };
        const writeOut = opts.out
          ? (saved) => console.log(`  written   ${path.join(opts.out, writeClassTo(opts.out, saved, opts.as))}`)
          : undefined;
        try {
          const done = refused ? await rekeepOne(row, refused, client, writeOut) : await warmOne(row, opts, client, keepRefused, writeOut);
          if (refused) dropRefused(opts.stateDir, p.syllabusId, row.path);
          const spend = priceCalls(client.calls, prices);
          totalInr += spend.inr;
          totalUnmeasured += spend.unmeasured;
          markTopic(p.state, row.path, {
            status: 'done',
            prepId,
            keptId: done.keptId,
            spendInr: Number(spend.inr.toFixed(4)),
            calls: client.calls.length,
            unmeasured: spend.unmeasured,
            // WHICH classes skipped the factual gate, and what the reviewer
            // and the repair round had to say. A catalogue children read
            // forever should not make a later operator guess either.
            reviewed: opts.review,
            ...(refused ? { rekept: true, firstPrepId: refused.prepId } : {}),
            ...(done.issues?.length ? { issues: done.issues } : {}),
          });
          consecutiveFailures = 0;
          console.log(
            `  done      ${row.path}  kept (pending publish)  ${inr(spend.inr)} across ${client.calls.length} relay calls` +
              `${spend.unmeasured > 0 ? ` (${spend.unmeasured} unmeasured — the figure is a floor)` : ''}`,
          );
        } catch (e) {
          // The money is already spent; write down how much beside the reason.
          const spend = priceCalls(client.calls, prices);
          totalInr += spend.inr;
          totalUnmeasured += spend.unmeasured;
          const reason = e instanceof Error ? e.message : String(e);
          // A GATE REFUSAL IS NOT A BROKEN PROMPT. The relay says which it is
          // (gate.ts:245 puts `reason` in the refusal body, and relayAdapters
          // carries it through). Counting a daily ceiling as a content failure
          // trips the three-strike stop and tells the operator a prompt is
          // broken when the truth is "come back tomorrow".
          const gate = e?.reason && BUDGET_REASONS.has(e.reason) ? e.reason : null;
          markTopic(p.state, row.path, {
            status: 'failed',
            prepId,
            reason: gate ? `relay ${gate} — the gate's daily ceiling, not a content failure` : reason,
            spendInr: Number(spend.inr.toFixed(4)),
            calls: client.calls.length,
            unmeasured: spend.unmeasured,
            reviewed: opts.review,
            // What the prepared class's report said, when there was one: the
            // keep gate's problems (or the maths that refused the class) and
            // the issues the repair rounds wrote down. Without them the only
            // way to learn why is to pay for the topic again.
            ...(e?.issues?.length ? { issues: e.issues } : {}),
            ...((e?.gateProblems ?? e?.mathsProblems)?.length ? { gate: e.gateProblems ?? e.mathsProblems } : {}),
          });
          // A plan stopped before its pictures: written down beside the
          // refused classes, so the layout fault can be reproduced for nothing.
          if (e?.plan) {
            const file = refusedPath(opts.stateDir, p.syllabusId, row.path).replace(/\.json$/, '.plan.json');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `${JSON.stringify({ prepId, reason, plan: e.plan }, null, 2)}\n`);
            console.log(`  saved     its plan: ${file}`);
          }
          if (gate) stoppedBy = gate;
          else consecutiveFailures += 1;
          console.error(
            `  FAILED    ${row.path} — ${reason} (spent ${inr(spend.inr)} across ${client.calls.length} calls)`,
          );
          if (!gate && shouldStop(consecutiveFailures)) {
            saveState(opts.stateDir, p.state);
            throw new Error(
              `${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping so a broken prompt` +
                ` cannot burn the catalogue budget. Fix the cause, then re-run; the state file resumes.`,
            );
          }
        }
        saveState(opts.stateDir, p.state);
      }
    }
  } finally {
    for (const release of locks) release();
  }

  if (stoppedBy) {
    console.log(
      `\nSTOPPED: the relay refused with "${stoppedBy}" — its ceiling, not a broken prompt` +
        `${stoppedBy === 'halted' ? ' (halted is a deliberate stop in relay_control)' : ''}.` +
        ' Re-run later; the state file remembers what is already done.',
    );
  }
  console.log(
    `\nRun complete. Priced spend this run: ${inr(totalInr)}` +
      `${totalUnmeasured > 0 ? ` (${totalUnmeasured} calls unmeasured — a floor; check cost-report against the books)` : ''}.`,
  );
}
