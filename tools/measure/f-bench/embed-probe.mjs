/**
 * CAN AN ON-DEVICE EMBEDDING MODEL READ HINGLISH? — the question that decides
 * whether the semantic rung is worth building at all.
 *
 * The lexical matcher scores `hit / own.length`, so a student who answers in
 * three words against a nine-word authored option escalates to the paid judge.
 * f came out at 23%. An embedding rung would compare MEANING instead, on the
 * student's own phone, at zero marginal cost — `@huggingface/transformers` is
 * already a dependency and `lib/onDeviceSpeech.ts` already runs models through
 * it, so this is a step rather than a new capability.
 *
 * ALL OF THAT IS WORTH NOTHING IF THE MODEL CANNOT READ ROMANISED HINDI.
 * Students write "khoon", "dekho", "nahi" — Hindi in Roman script. Most small
 * multilingual models were trained on Devanagari Hindi, which is a different
 * thing, and transliterated text is thinly represented almost everywhere. This
 * measures it rather than assuming either way.
 *
 * TWO NUMBERS PER MODEL, and the second matters more than the first:
 *
 *   rank@1   — how often the CORRECT option is the nearest. This is the
 *              ceiling on what a semantic rung could buy.
 *   margin   — how far ahead of the runner-up it is. A rung that fires on a
 *              thin margin is a rung that will confidently tell a child who
 *              was right that they were wrong, and the lexical matcher's best
 *              property today is that it refuses instead (0 of 96).
 *
 * Remote downloads are ON here and OFF in the app, deliberately: this runs on a
 * laptop, and onDeviceSpeech.ts explains why a student's data bill must never
 * discover a missing file.
 *
 * Run: node tools/measure/f-bench/embed-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.models');
process.env.HF_HOME = CACHE;
process.env.TRANSFORMERS_CACHE = CACHE;

const { pipeline, env } = await import('@huggingface/transformers');
env.allowRemoteModels = true;
env.cacheDir = CACHE;

/**
 * Small enough to ship to a phone. LaBSE and MuRIL read transliterated Indian
 * text far better and are ~470 MB, which is not a download to put in front of a
 * student on mobile data — they are named here so the next reader knows the
 * ceiling was considered and priced, not missed.
 */
const MODELS = [
  ['Xenova/all-MiniLM-L6-v2', 'English-only baseline, ~23 MB'],
  ['Xenova/paraphrase-multilingual-MiniLM-L12-v2', 'multilingual, ~118 MB'],
  ['Xenova/multilingual-e5-small', 'multilingual, ~118 MB'],
];

const answers = JSON.parse(fs.readFileSync(path.join(HERE, 'answers.json'), 'utf8'));

const cosine = (a, b) => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // normalised vectors, so the dot product IS the cosine
};

const results = [];

for (const [model, note] of MODELS) {
  process.stdout.write(`\n${model}  (${note})\n`);
  let embed;
  try {
    embed = await pipeline('feature-extraction', model, { dtype: 'q8' });
  } catch (e) {
    process.stdout.write(`  COULD NOT LOAD — ${e.message.slice(0, 120)}\n`);
    continue;
  }

  const vec = async (text) => {
    const out = await embed(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  };

  /** shape -> { n, top1, margins[] } */
  const tally = {};
  for (const a of answers) {
    const optVecs = [];
    for (const o of a.probe.options) optVecs.push(await vec(o.text));
    const correctIdx = a.probe.options.findIndex((o) => o.correct);

    for (const group of ['blind', 'primed']) {
      for (const s of a[group]) {
        // Only the shapes where a RIGHT answer should win are scored for rank.
        if (!s.shape.startsWith('right-')) continue;
        const v = await vec(s.said);
        const sims = optVecs.map((o) => cosine(v, o));
        const best = Math.max(...sims);
        const bestIdx = sims.indexOf(best);
        const second = Math.max(...sims.filter((_, i) => i !== bestIdx));
        const t = (tally[s.shape] ??= { n: 0, top1: 0, margins: [] });
        t.n += 1;
        if (bestIdx === correctIdx) t.top1 += 1;
        t.margins.push(best - second);
      }
    }
  }

  const rows = Object.entries(tally).sort(([a], [b]) => a.localeCompare(b));
  process.stdout.write('  shape              n   rank@1   median margin\n');
  for (const [shape, t] of rows) {
    const sorted = [...t.margins].sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
    process.stdout.write(
      `  ${shape.padEnd(16)} ${String(t.n).padStart(3)}   ${String(Math.round((t.top1 / t.n) * 100)).padStart(4)}%   ${med.toFixed(3)}\n`,
    );
  }
  results.push({ model, note, tally });
}

fs.writeFileSync(path.join(HERE, 'embed-probe.json'), JSON.stringify(results, null, 2));
process.stdout.write(`\nWritten to ${path.relative(process.cwd(), path.join(HERE, 'embed-probe.json'))}\n`);
