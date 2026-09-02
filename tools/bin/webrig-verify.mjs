/**
 * DOES THE VERIFIER ACTUALLY LET ANYTHING THROUGH?
 *
 * The one number left unmeasured about rung three. Supply is known — 12 of 12
 * briefs have openly licensed candidates on Commons — but a candidate is only
 * worth anything if a model looking at it says "yes, that is the thing, and
 * nothing is printed on it". Most educational images on the web are labelled,
 * so this could plausibly come back near zero.
 *
 * It runs the REAL decision functions: searchQuery, mayReuse, VERIFIER_SYSTEM,
 * verifierUser, parseVerdict and refusalFor are imported from the shipping
 * module, not restated here. Only the loop is rewritten, so that every
 * candidate's picture and verdict can be kept for the report — findOnTheWeb
 * stops at the first yes and hands back reasons without images.
 *
 *   node --experimental-strip-types tools/bin/webrig-verify.mjs
 *
 * Writes .scratch/webrig/report.json and .scratch/webrig/report.html.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  VERIFIER_SYSTEM,
  mayReuse,
  parseVerdict,
  refusalFor,
  searchQuery,
  verifierUser,
} from '../../packages/class-prep/src/fromWeb.ts';
import { createCommonsSearch } from '../../packages/class-prep/src/commons.ts';

// ------------------------------------------------------------------ setup --

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const KEY = env.GEMINI_API_KEY;
if (!KEY) throw new Error('GEMINI_API_KEY is not in .env.local');

/**
 * MEASURED, not chosen from the name.
 *
 * Aarav asked for gemini-3.7-flash and it IS in the model list — but it never
 * answers: three separate calls with a one-pixel image aborted at 30 and 45
 * seconds. So did gemini-3-flash-preview and gemini-flash-latest.
 * gemini-2.5-flash is retired for new keys and 3.6-flash rejects the request
 * shape. gemini-3.8-flash answers in 3.7s and 3.1-flash-lite in 3.2s.
 *
 * 3.8-flash it is: newer than the one asked for, and it actually replies.
 */
const MODEL = process.env.MODEL ?? 'gemini-3.8-flash';

/** One stuck call must not stall the run. */
const CALL_TIMEOUT_MS = 45_000;

/**
 * THE LIMIT IS RATE, NOT MONEY.
 *
 * The first run spent its whole budget in about four minutes and then took
 * 429 "quota exceeded" for eighteen calls straight — six of sixteen briefs
 * never got a verdict at all and were recorded as refusals, which is a
 * measurement lying about its own subject. The calls themselves are trivially
 * cheap; what is scarce is calls per minute on a key with no billing attached.
 *
 * So: a gap between calls, and a real backoff on 429 and 503 rather than
 * counting them as a no.
 */
const PACE_MS = Number(process.env.PACE_MS ?? 6500);
const RETRIES = 4;

/** Commons asks for a real user agent and a civilised rate. Both, then. */
const UA = 'CurieEdu/1.0 (https://curie.co.in; 1208aarav@gmail.com)';
const breathe = (ms = 1100) => new Promise((r) => setTimeout(r, ms));

const OUT = '.scratch/webrig';
fs.mkdirSync(OUT, { recursive: true });

/**
 * Progress to a FILE as well as stdout.
 *
 * Node block-buffers stdout when it is a pipe, so a run watched through `tail`
 * shows nothing at all until it exits — which looked exactly like a hang for
 * ten minutes when the only real problem was a slow model.
 */
const LOG = path.join(OUT, 'progress.txt');
fs.writeFileSync(LOG, '');
const say = (line) => {
  console.log(line);
  fs.appendFileSync(LOG, line + String.fromCharCode(10));
};

// ------------------------------------------------------------- the briefs --

/**
 * Briefs in the shape the planner really writes them, spread across the
 * subjects a Class 6-12 syllabus actually contains — and deliberately
 * including the hard cases. A kidney cross section is the one picture.ts opens
 * by saying nobody can draw; a bar magnet with filings is the sort of thing
 * that is nearly always a labelled diagram.
 */
const BRIEFS = [
  { id: 'kidney', brief: 'a kidney cut lengthwise, showing the cortex, medulla and renal pelvis', alt: 'a kidney cut in half', parts: ['cortex', 'medulla'] },
  { id: 'heart', brief: 'a human heart seen from the front, whole', alt: 'a human heart', parts: ['left ventricle'] },
  { id: 'leaf', brief: 'a leaf in cross section showing the epidermis and the mesophyll', alt: 'a leaf cross section', parts: ['epidermis'] },
  { id: 'plantcell', brief: 'a plant cell under a microscope', alt: 'a plant cell', parts: ['cell wall'] },
  { id: 'moon', brief: 'the Moon photographed at full phase', alt: 'the full Moon', parts: [] },
  { id: 'quartz', brief: 'a sample of quartz crystal', alt: 'a quartz crystal', parts: [] },
  { id: 'bunsen', brief: 'a laboratory Bunsen burner', alt: 'a Bunsen burner', parts: ['barrel'] },
  { id: 'pendulum', brief: 'a simple pendulum hanging from a stand', alt: 'a pendulum', parts: ['bob'] },
  { id: 'greatwall', brief: 'the Great Wall of China seen along its length', alt: 'the Great Wall', parts: [] },
  { id: 'magnet', brief: 'a bar magnet with iron filings around it', alt: 'a bar magnet and filings', parts: [] },
  { id: 'ammeter', brief: 'an ammeter used in a school laboratory', alt: 'an ammeter', parts: ['dial'] },
  { id: 'neuron', brief: 'a mature neuron showing the cell body and its axon', alt: 'a neuron', parts: ['axon'] },
  { id: 'volcano', brief: 'a volcano erupting, seen from a distance', alt: 'an erupting volcano', parts: [] },
  { id: 'microscope', brief: 'a compound light microscope as used in a school laboratory', alt: 'a microscope', parts: ['objective lens'] },
  { id: 'stomata', brief: 'stomata on the underside of a leaf under a microscope', alt: 'stomata', parts: ['guard cell'] },
  { id: 'testtube', brief: 'a test tube held in a clamp over a flame', alt: 'a test tube being heated', parts: [] },
];

/** How many candidates to look at per brief. The same budget findOnTheWeb has. */
const TRIES = Number(process.env.TRIES ?? 3);

// ------------------------------------------------------------- the verifier --

let calls = 0;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function ask(dataUrl, system, user) {
  let wait = 8000;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await askOnce(dataUrl, system, user);
    } catch (e) {
      const status = Number(String(e.message ?? '').slice(0, 3));
      if (attempt >= RETRIES || !RETRYABLE.has(status)) throw e;
      say(`    …${status}, waiting ${Math.round(wait / 1000)}s`);
      await breathe(wait);
      wait = Math.min(wait * 2, 90_000);
    }
  }
}

async function askOnce(dataUrl, system, user) {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.slice(5).split(';')[0];
  calls += 1;
  await breathe(PACE_MS);

  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), CALL_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        signal: stop.signal,
        headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            {
              role: 'user',
              parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: user }],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            // The flash models think by default and take minutes over it. This
            // is a yes/no about a picture; there is nothing to deliberate.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 200)}`);
  }
  const json = await response.json();
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

// ------------------------------------------------------------------- run --

const search = createCommonsSearch({
  fetch: (url, init) =>
    fetch(url, { ...init, headers: { ...(init?.headers ?? {}), 'user-agent': UA } }),
});

/**
 * RESUME, so a rate limit costs one run rather than all of them.
 *
 * A brief that already has a real verdict — accepted, or refused by something
 * that actually looked — is kept as it was. Only the ones where every attempt
 * ended in an HTTP error are asked again.
 */
const previous = fs.existsSync(path.join(OUT, 'report.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')).results
  : [];
const settled = new Map(
  previous
    .filter((r) => r.accepted || r.looked.some((l) => !l.error))
    .map((r) => [r.id, r]),
);
if (settled.size > 0) say(`resuming: ${settled.size} briefs already have a verdict`);

const results = [];

for (const brief of BRIEFS) {
  const done = settled.get(brief.id);
  if (done) {
    results.push(done);
    continue;
  }

  await breathe();
  const query = searchQuery(brief);
  const row = { id: brief.id, brief: brief.brief, query, looked: [], accepted: null };

  let candidates = [];
  try {
    candidates = await search.search(query, 12);
  } catch (e) {
    row.error = String(e.message ?? e);
  }

  const usable = candidates.filter((c) => c.url && mayReuse(c.license));
  row.found = candidates.length;
  row.licensed = usable.length;

  for (const candidate of usable) {
    if (row.looked.length >= TRIES || row.accepted) break;

    let src = null;
    try {
      src = await search.fetch(candidate.url);
    } catch {
      src = null;
    }
    if (!src) continue;

    let verdict;
    let raw = '';
    try {
      raw = await ask(src, VERIFIER_SYSTEM, verifierUser(brief));
      verdict = parseVerdict(raw);
    } catch (e) {
      row.looked.push({ url: candidate.url, error: String(e.message ?? e).slice(0, 200) });
      continue;
    }

    const refusal = refusalFor(verdict);
    const looked = {
      url: candidate.url,
      source: candidate.source ?? null,
      license: candidate.license ?? null,
      title: candidate.title ?? null,
      src,
      verdict,
      refusal,
      raw: raw.slice(0, 300),
    };
    row.looked.push(looked);
    if (!refusal) row.accepted = looked;
  }

  results.push(row);
  const mark = row.accepted ? 'TAKEN  ' : 'refused';
  say(
    `${mark} ${brief.id.padEnd(12)} q="${query}"  ${row.licensed}/${row.found} licensed, ` +
      `${row.looked.length} looked at` +
      (row.accepted ? '' : `  [${row.looked.map((l) => l.refusal ?? l.error).join(' | ')}]`),
  );
}

// ---------------------------------------------------------------- summary --

const taken = results.filter((r) => r.accepted).length;
const lookedAt = results.reduce((n, r) => n + r.looked.length, 0);
const why = {};
for (const r of results) {
  for (const l of r.looked) {
    if (!l.refusal) continue;
    const key = /not the subject|^it is /.test(l.refusal)
      ? 'wrong subject'
      : /printed on it/.test(l.refusal)
        ? 'has labels'
        : /of the subject in it/.test(l.refusal)
          ? 'more than one'
          : 'other';
    why[key] = (why[key] ?? 0) + 1;
  }
}

const summary = {
  model: MODEL,
  briefs: results.length,
  taken,
  lookedAt,
  visionCalls: calls,
  refusals: why,
  perTakenCalls: taken ? +(calls / taken).toFixed(2) : null,
};

say('');
say(`model: ${MODEL}`);
say(`taken from the web: ${taken}/${results.length}`);
say(`candidates looked at: ${lookedAt}, vision calls: ${calls}`);
say(`why refused: ${JSON.stringify(why)}`);

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ summary, results }, null, 2));
console.log(`\nwrote ${OUT}/report.json`);
