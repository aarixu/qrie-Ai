/**
 * EAR BENCH - every ear, scored on a real voice.
 *
 * Reads the ear lab's clips (tools/voice-probe/out/real) and the sentence each
 * one was meant to say (refs.json, which the speaker may have corrected), sends
 * every clip to every cloud ear in each of its three shapes, merges in the
 * local ears' answers (ear-local.py writes local-*.json), and prints how many
 * words each got wrong.
 *
 * The three shapes say WHERE a bad transcript comes from:
 *   app-wav   16 kHz WAV of the stream the app's mic sends
 *             (echo cancellation + noise suppression + auto gain ON)
 *   raw-wav   the same moment with those three OFF
 *   app-webm  the app-style stream as Opus 32 kbps, what listenOnce uploads
 * app-wav vs raw-wav is the microphone's processing; app-wav vs app-webm is the
 * compression; across variants it is the model.
 *
 *   node tools/voice-probe/ear-bench.mjs --spend [clips-dir] [--artifacts=app-wav,raw-wav,app-webm]
 *                                         [--detail=<variant substring>]
 * The key file is read from VERTEX_SA, else .secrets/vertex-service-account.json.
 * Spends a few rupees on Google (24 short clips, a handful of ears).
 */
import '../prewarm/lib/register.mjs';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIR = args.find((a) => !a.startsWith('--')) ?? 'tools/voice-probe/out/real';
const ARTIFACTS = (flag('artifacts') ?? 'app-wav,raw-wav,app-webm').split(',');
const DETAIL = flag('detail') ?? (args.includes('--local-only') ? 'local' : 'today');

// --local-only scores the local ears' answers (ear-local.py) and calls nothing.
const LOCAL_ONLY = args.includes('--local-only');
if (!LOCAL_ONLY && !args.includes('--spend')) {
  console.log('Spends a few rupees on Google. Re-run with --spend (or --local-only to score the local ears only).');
  process.exit(0);
}

const { HEAR_INSTRUCTION } = await import('../../packages/relay/src/vertexHear.ts');
const { romaniseDevanagari } = await import('../../packages/relay/src/romanise.ts');
let token = '';
let PROJECT = '';
if (!LOCAL_ONLY) {
  const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
  const tokens = createTokenSource(
    readServiceAccount(readFileSync(process.env.VERTEX_SA ?? '.secrets/vertex-service-account.json', 'utf8')),
  );
  token = await tokens.token();
  PROJECT = tokens.projectId;
}

// ---------------------------------------------------------------- the clips
const refs = JSON.parse(readFileSync(join(DIR, 'refs.json'), 'utf8'));
const CLIP = /^s(\d\d)-(app|raw)\.(wav|webm)$/;
const clips = [];
for (const file of readdirSync(DIR).sort()) {
  const m = CLIP.exec(file);
  if (!m) continue;
  const id = Number(m[1]);
  const ref = (refs[id] ?? '').trim();
  const artifact = `${m[2]}-${m[3]}`;
  if (!ref || !ARTIFACTS.includes(artifact)) continue;
  clips.push({ id, ref, artifact, file, bytes: readFileSync(join(DIR, file)), mime: m[3] === 'wav' ? 'audio/wav' : 'audio/webm' });
}
if (!clips.length) {
  console.log(`No usable clips in ${DIR} (need a clip and a non-empty reference).`);
  process.exit(1);
}
console.log(`${clips.length} clips (${new Set(clips.map((c) => c.id)).size} sentences) from ${DIR}\n`);

// ---------------------------------------------------------------- scoring
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
function edit(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Word error rate, and character error rate (kinder to Hinglish spelling: samajh / samjh). */
function score(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  const rw = r.split(' ').filter(Boolean), hw = h.split(' ').filter(Boolean);
  return { wer: rw.length ? edit(rw, hw) / rw.length : 0, cer: r.length ? edit([...r], [...h]) / r.length : 0 };
}
const devanagari = (s) => /[ऀ-ॿ]/.test(s);

// ---------------------------------------------------------------- the cloud ears
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(url, headers, body) {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
    return { status: res.status, ms: Math.round(performance.now() - t0), json };
  }
}

const gemini = (name, model, thinking, location = 'global') => ({
  name,
  async hear(clip) {
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    const r = await post(
      `https://${host}/v1/projects/${PROJECT}/locations/${location}/publishers/google/models/${model}:generateContent`,
      {},
      {
        systemInstruction: { parts: [{ text: HEAR_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: clip.mime, data: clip.bytes.toString('base64') } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 300, thinkingConfig: thinking },
      },
    );
    if (r.status !== 200) return { ms: r.ms, error: `${r.status} ${(r.json.error?.message ?? '').slice(0, 120)}` };
    const text = (r.json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
    return { ms: r.ms, text: romaniseDevanagari(text) };
  },
});

const chirp = (name, model, location, languageCodes) => ({
  name,
  async hear(clip) {
    const host = location === 'global' ? 'speech.googleapis.com' : `${location}-speech.googleapis.com`;
    const r = await post(
      `https://${host}/v2/projects/${PROJECT}/locations/${location}/recognizers/_:recognize`,
      { 'x-goog-user-project': PROJECT },
      { config: { autoDecodingConfig: {}, model, languageCodes, features: { enableAutomaticPunctuation: true } }, content: clip.bytes.toString('base64') },
    );
    if (r.status !== 200) return { ms: r.ms, error: `${r.status} ${(r.json.error?.status ?? '')}` };
    const text = (r.json.results ?? []).map((x) => x.alternatives?.[0]?.transcript ?? '').join(' ').trim();
    // Chirp writes Hindi in Devanagari; the relay would spell it out in Roman letters.
    return { ms: r.ms, text: romaniseDevanagari(text), raw: text };
  },
});

const EARS = LOCAL_ONLY
  ? []
  : [
      gemini('today: gemini-3.1-flash-lite', 'gemini-3.1-flash-lite', { thinkingBudget: 0 }),
      gemini('gemini-3.7-flash', 'gemini-3.7-flash', { thinkingLevel: 'MINIMAL' }),
      gemini('gemini-3.8-flash', 'gemini-3.8-flash', { thinkingLevel: 'LOW' }),
      chirp('chirp_3 (Google STT)', 'chirp_3', 'us', ['auto']),
    ];

// ---------------------------------------------------------------- run
/** results[ear][clip.file] = { text | error, ms } */
const results = {};
for (const ear of EARS) results[ear.name] = {};
for (const clip of clips) {
  await Promise.all(
    EARS.map(async (ear) => {
      try {
        results[ear.name][clip.file] = await ear.hear(clip);
      } catch (e) {
        results[ear.name][clip.file] = { error: String(e?.message ?? e), ms: 0 };
      }
    }),
  );
  process.stdout.write('.');
}
console.log('\n');

// The local ears (ear-local.py), if they have been run.
for (const f of readdirSync(DIR)) {
  if (!/^local-.*\.json$/.test(f)) continue;
  const name = `local: ${f.slice(6, -5)}`;
  const answers = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  results[name] = {};
  for (const clip of clips) {
    const a = answers[clip.file];
    // Devanagari is spelled out in Roman letters before scoring, as the relay does; `raw` keeps what the ear wrote.
    if (a) results[name][clip.file] = { ...a, raw: a.text, text: romaniseDevanagari(a.text ?? '') };
  }
}

// ---------------------------------------------------------------- report
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const pct = (x) => `${(x * 100).toFixed(0)}%`.padStart(4);
const rows = [];
const detail = {};
for (const [ear, answers] of Object.entries(results)) {
  for (const artifact of ARTIFACTS) {
    const mine = clips.filter((c) => c.artifact === artifact && answers[c.file]);
    if (!mine.length) continue;
    const failed = mine.filter((c) => answers[c.file].error);
    const ok = mine.filter((c) => !answers[c.file].error);
    const scored = ok.map((c) => ({ c, ...score(c.ref, answers[c.file].text ?? ''), text: answers[c.file].text ?? '', raw: answers[c.file].raw ?? answers[c.file].text ?? '', ms: answers[c.file].ms }));
    detail[`${ear} | ${artifact}`] = scored;
    rows.push({
      ear,
      artifact,
      n: mine.length,
      errors: failed.length,
      firstError: failed[0] ? answers[failed[0].file].error : '',
      wer: scored.length ? scored.reduce((s, x) => s + x.wer, 0) / scored.length : NaN,
      cer: scored.length ? scored.reduce((s, x) => s + x.cer, 0) / scored.length : NaN,
      empty: scored.filter((x) => x.text.trim() === '').length,
      dev: scored.filter((x) => devanagari(x.raw)).length,
      ms: median(scored.map((x) => x.ms)),
    });
  }
}

console.log('ear'.padEnd(46), 'shape'.padEnd(9), 'n'.padStart(3), ' WER  CER empty  dev  median');
for (const r of rows) {
  const tail = r.errors === r.n ? `ALL FAILED: ${r.firstError}` : `${pct(r.wer)} ${pct(r.cer)} ${String(r.empty).padStart(5)} ${String(r.dev).padStart(4)}  ${String(r.ms).padStart(6)} ms${r.errors ? `  (${r.errors} errors: ${r.firstError})` : ''}`;
  console.log(r.ear.slice(0, 45).padEnd(46), r.artifact.padEnd(9), String(r.n).padStart(3), tail);
}

for (const [key, scored] of Object.entries(detail)) {
  if (!key.toLowerCase().includes(DETAIL.toLowerCase())) continue;
  console.log(`\n--- ${key}`);
  for (const x of scored) {
    const wrote = x.raw !== x.text ? `   (wrote: ${x.raw})` : '';
    console.log(`  [${String(x.c.id).padStart(2)}] wer ${pct(x.wer)}  said: ${x.c.ref}\n       heard: ${x.text || '(nothing)'}${wrote}`);
  }
}

const out = join(DIR, 'bench-results.json');
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), summary: rows, results }, null, 2));
console.log(`\nfull results: ${out}`);
