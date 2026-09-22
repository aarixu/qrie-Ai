/**
 * THE TRADE-OFF CURVE — what a semantic rung buys, and what it costs.
 *
 * `embed-probe.mjs` answered "can a small model read this at all" (yes: the
 * 23 MB English-only MiniLM ranks the correct option first for 96% of Hinglish
 * answers, because the tutor's Hinglish keeps technical nouns in English by
 * design). rank@1 is NOT f, though. A matcher has to DECIDE, and deciding means
 * a threshold, and a threshold has two failure directions that are not
 * symmetric:
 *
 *   escalate something it could have settled  — costs a model call
 *   settle a RIGHT answer onto a WRONG option — tells a child who was right
 *                                               that they were wrong, with no
 *                                               model behind it to catch it
 *
 * The lexical matcher's best property today is that it takes the first failure
 * to avoid the second: 0 of 96 right answers were settled locally as wrong.
 * A semantic rung that gives that up is not worth any amount of f.
 *
 * So this sweeps the margin threshold and reports BOTH numbers at each step,
 * for the rung as it would actually ship: lexical first, embeddings only on
 * what lexical refused, the paid judge only on what neither settled.
 *
 * Run: node tools/measure/f-bench/embed-sweep.mjs
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

const MODEL = 'Xenova/all-MiniLM-L6-v2';

const answers = JSON.parse(fs.readFileSync(path.join(HERE, 'answers.json'), 'utf8'));
/** What the lexical rung already settled, from the committed bench result. */
const lexical = JSON.parse(fs.readFileSync(path.join(HERE, 'result.json'), 'utf8'));
const lexicalPath = new Map(
  lexical.rows.map((r) => [`${r.topicRef}|${r.beatId}|${r.group}|${r.shape}`, r.path]),
);

const embed = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
const vec = async (text) => {
  const out = await embed(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
};
const cosine = (a, b) => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
};

/**
 * Every answer the LEXICAL rung refused, scored by the embedding rung. Only
 * those: an answer lexical already settled never reaches this rung in
 * production, so scoring it here would inflate the result with work the new
 * rung does not do.
 */
const scored = [];
for (const a of answers) {
  const optVecs = [];
  for (const o of a.probe.options) optVecs.push(await vec(o.text));
  const correctIdx = a.probe.options.findIndex((o) => o.correct);

  for (const group of ['blind', 'primed']) {
    for (const s of a[group]) {
      const key = `${a.topicRef}|${a.beatId}|${group}|${s.shape}`;
      if (lexicalPath.get(key) !== 'model') continue; // lexical already settled it

      const v = await vec(s.said);
      const sims = optVecs.map((o) => cosine(v, o));
      const best = Math.max(...sims);
      const bestIdx = sims.indexOf(best);
      const second = Math.max(...sims.filter((_, i) => i !== bestIdx));
      scored.push({
        group,
        shape: s.shape,
        said: s.said,
        margin: best - second,
        pickedCorrect: bestIdx === correctIdx,
        isRight: s.shape.startsWith('right-'),
      });
    }
  }
}

const blindTotal = lexical.rows.filter((r) => r.group === 'blind').length;
const blindLexicalLocal = lexical.rows.filter((r) => r.group === 'blind' && r.path === 'local').length;
const rightTotal = lexical.rows.filter((r) => r.group === 'blind' && r.shape.startsWith('right-')).length;

process.stdout.write(`\n  ${MODEL}\n`);
process.stdout.write(`  lexical alone: f = ${((blindLexicalLocal / blindTotal) * 100).toFixed(1)}%, right-called-wrong = ${lexical.rightAnswersCalledWrongLocally} of ${rightTotal}\n\n`);
process.stdout.write('  margin   f (blind)   extra settled   RIGHT CALLED WRONG\n');

const rows = [];
for (const t of [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40]) {
  const fires = scored.filter((s) => s.margin >= t);
  const blindFires = fires.filter((s) => s.group === 'blind');
  // The one that decides it: a right answer, settled by this rung, onto a
  // wrong option — and no model behind it.
  const harmed = fires.filter((s) => s.isRight && !s.pickedCorrect);
  const f = (blindLexicalLocal + blindFires.length) / blindTotal;
  rows.push({ threshold: t, f: Math.round(f * 1000) / 10, extra: blindFires.length, harmed: harmed.length });
  process.stdout.write(
    `  ${t.toFixed(2)}     ${(f * 100).toFixed(1)}%       ${String(blindFires.length).padStart(3)}            ${String(harmed.length).padStart(3)}\n`,
  );
}

const worst = scored.filter((s) => s.isRight && !s.pickedCorrect).sort((a, b) => b.margin - a.margin);
process.stdout.write(`\n  right answers this rung would get WRONG, by margin (highest first):\n`);
for (const w of worst.slice(0, 6)) {
  process.stdout.write(`    ${w.margin.toFixed(3)}  ${JSON.stringify(w.said).slice(0, 88)}\n`);
}
if (worst.length === 0) process.stdout.write('    none\n');

fs.writeFileSync(path.join(HERE, 'embed-sweep.json'), JSON.stringify({ model: MODEL, rows, scored }, null, 2));
process.stdout.write(`\n  Written to ${path.relative(process.cwd(), path.join(HERE, 'embed-sweep.json'))}\n`);
