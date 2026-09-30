/**
 * EAR VARIANTS on Gemini (Vertex), the only ear this project can call until
 * the Cloud Speech-to-Text API is enabled (probe.mjs, 2026-09-30: 403
 * SERVICE_DISABLED, and the service account may not enable it).
 *
 * Replays the student clips probe.mjs wrote (tools/voice-probe/out/clip-*.wav)
 * through model × region × instruction × thinking variants, and prints speed,
 * word error and whether any Devanagari came back.
 *   node tools/voice-probe/ear-variants.mjs --spend
 */
import '../prewarm/lib/register.mjs';
import { readFileSync, existsSync } from 'node:fs';

if (!process.argv.includes('--spend')) {
  console.log('Spends a few rupees on Google. Re-run with --spend.');
  process.exit(0);
}
const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const tokens = createTokenSource(readServiceAccount(readFileSync('.secrets/vertex-service-account.json', 'utf8')));
const token = await tokens.token();
const PROJECT = tokens.projectId;

const SAID = [
  'I think breathing gives us energy directly.',
  'Respiration happens in the mitochondria.',
  'Glucose breaks down into pyruvate first.',
  'mujhe lagta hai saans lene se energy milti hai',
  'yeast mein oxygen nahi hoti toh alcohol banta hai',
  'muscles mein lactic acid banta hai isliye cramp aata hai',
  'pata nahi, ek hint do na',
  'haan samajh aa gaya, aage chalo',
];
const clips = SAID.map((said, i) => ({ said, file: `tools/voice-probe/out/clip-${i}.wav` }))
  .filter((c) => existsSync(c.file))
  .map((c) => ({ ...c, wav: readFileSync(c.file) }));

const TODAY =
  "Transcribe the student's speech in this audio exactly as spoken. The student is an Indian school student and may speak English, Hindi, or a mix (Hinglish). " +
  'Write Hindi words in Roman script as Hinglish, never in Devanagari. ' +
  'Do not translate, correct, summarise or answer. If there is no speech, output nothing. Output only the transcript.';

const ROMAN_SYSTEM = [
  'You are a speech-to-text engine for an Indian school tutoring app. You output ONLY the words spoken, nothing else.',
  'The speaker is a student aged 11-18 who speaks English, Hindi, or Hinglish (a mix).',
  'ALWAYS write in the Latin alphabet (a-z). Write every Hindi word the way Indians type it in chats, in Roman letters: "मुझे लगता है" -> "mujhe lagta hai", "पता नहीं" -> "pata nahi", "हां समझ आ गया" -> "haan samajh aa gaya". NEVER output Devanagari characters.',
  'Keep English words in English spelling (hint, energy, oxygen, cramp). Do not translate, correct grammar, summarise or answer the question.',
  'If there is no speech, output nothing.',
].join('\n');

const words = (s) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = words(ref), h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? d[r.length][h.length] / r.length : 0;
}

async function hear(clip, v) {
  const host = v.location === 'global' ? 'aiplatform.googleapis.com' : `${v.location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${PROJECT}/locations/${v.location}/publishers/google/models/${v.model}:generateContent`;
  const body = {
    ...(v.system ? { systemInstruction: { parts: [{ text: v.system }] } } : {}),
    contents: [{ role: 'user', parts: [...(v.system ? [] : [{ text: TODAY }]), { inlineData: { mimeType: 'audio/wav', data: clip.wav.toString('base64') } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 300, ...(v.thinking ? { thinkingConfig: v.thinking } : {}) },
  };
  const t0 = performance.now();
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Math.round(performance.now() - t0);
  const j = await res.json().catch(() => ({}));
  if (res.status !== 200) return { error: `${res.status} ${(j.error?.message ?? '').slice(0, 140)}` };
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  return { ms, text, wer: wer(clip.said, text), dev: /[ऀ-ॿ]/.test(text), thoughts: j.usageMetadata?.thoughtsTokenCount ?? 0 };
}

const VARIANTS = [
  { name: 'today: 3.1-flash-lite global, LOW, instruction in user', model: 'gemini-3.1-flash-lite', location: 'global', thinking: { thinkingLevel: 'LOW' } },
  { name: '3.1-flash-lite global, LOW, Roman system prompt', model: 'gemini-3.1-flash-lite', location: 'global', thinking: { thinkingLevel: 'LOW' }, system: ROMAN_SYSTEM },
  { name: '3.1-flash-lite global, MINIMAL, Roman system', model: 'gemini-3.1-flash-lite', location: 'global', thinking: { thinkingLevel: 'MINIMAL' }, system: ROMAN_SYSTEM },
  { name: '3.1-flash-lite global, budget 0, Roman system', model: 'gemini-3.1-flash-lite', location: 'global', thinking: { thinkingBudget: 0 }, system: ROMAN_SYSTEM },
  { name: '3.1-flash-lite asia-south1, LOW, Roman system', model: 'gemini-3.1-flash-lite', location: 'asia-south1', thinking: { thinkingLevel: 'LOW' }, system: ROMAN_SYSTEM },
  { name: '2.5-flash-lite global, budget 0, Roman system', model: 'gemini-2.5-flash-lite', location: 'global', thinking: { thinkingBudget: 0 }, system: ROMAN_SYSTEM },
  { name: '2.5-flash-lite asia-south1, budget 0, Roman system', model: 'gemini-2.5-flash-lite', location: 'asia-south1', thinking: { thinkingBudget: 0 }, system: ROMAN_SYSTEM },
  { name: '2.5-flash global, budget 0, Roman system', model: 'gemini-2.5-flash', location: 'global', thinking: { thinkingBudget: 0 }, system: ROMAN_SYSTEM },
  { name: '3.8-flash global, LOW, Roman system', model: 'gemini-3.8-flash', location: 'global', thinking: { thinkingLevel: 'LOW' }, system: ROMAN_SYSTEM },
];

for (const v of VARIANTS) {
  const rows = [];
  for (const clip of clips) {
    const r = await hear(clip, v);
    rows.push(r);
    if (r.error) break;
  }
  const ok = rows.filter((r) => !r.error);
  if (!ok.length) { console.log(`\n${v.name}: ${rows[0].error}`); continue; }
  const sorted = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  console.log(`\n${v.name}: median ${p(0.5)} ms · p90 ${p(0.9)} ms · mean WER ${(ok.reduce((s, r) => s + r.wer, 0) / ok.length).toFixed(2)} · Devanagari ${ok.filter((r) => r.dev).length}/${ok.length} · thought tokens ${ok.reduce((s, r) => s + r.thoughts, 0)}`);
  for (const r of rows) console.log('    ', r.error ? `ERROR ${r.error}` : `${r.ms} ms  wer ${r.wer.toFixed(2)}  "${r.text}"`);
}
