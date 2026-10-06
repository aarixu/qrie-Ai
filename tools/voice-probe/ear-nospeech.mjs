/**
 * DOES THE EAR INVENT WORDS OUT OF NOTHING? (found 2026-10-06)
 *
 * Sent through the production relay, five clips of NO speech at all (silence,
 * white noise, a tone, a hum) all came back as the same sentence: "sir
 * photosynthesis kya hota hai". It is in no file of this repo; the model
 * supplies it, and at temperature 0 supplies it every time. A noise burst that
 * clears the app's endpointer would reach the tutor as a student question nobody
 * asked.
 *
 * This replays no-speech clips and the eight spoken clips of the ear lab through
 * the ear's instruction as it is today and through variants that give the model
 * an explicit way to say "nobody spoke". The variant wins only if it silences
 * every non-speech clip AND leaves the spoken ones as accurate as before.
 *
 *   node tools/voice-probe/ear-nospeech.mjs --spend [clips-dir]
 * Key file: VERTEX_SA, else .secrets/vertex-service-account.json. Spends paise.
 */
import '../prewarm/lib/register.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

if (!process.argv.includes('--spend')) {
  console.log('Spends a few paise on Google. Re-run with --spend.');
  process.exit(0);
}
const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'tools/voice-probe/out/synth';

const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const { HEAR_INSTRUCTION, VERTEX_HEAR_MODEL } = await import('../../packages/relay/src/vertexHear.ts');
const tokens = createTokenSource(readServiceAccount(readFileSync(process.env.VERTEX_SA ?? '.secrets/vertex-service-account.json', 'utf8')));
const token = await tokens.token();
const PROJECT = tokens.projectId;

// ---------------------------------------------------------------- the clips
function wav(samples, rate = 16000) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(Math.max(-1, Math.min(1, s)) * 0x7fff, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
const make = (secs, f) => wav(Float32Array.from({ length: Math.floor(16000 * secs) }, (_, i) => f(i)));
let brown = 0;
const nonSpeech = [
  ['silence 2 s', make(2, () => 0)],
  ['white noise 2 s', make(2, () => 0.2 * rnd())],
  ['tone 220 Hz 2 s', make(2, (i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / 16000))],
  ['hum + noise 3 s', make(3, (i) => 0.1 * Math.sin((2 * Math.PI * 100 * i) / 16000) + 0.08 * rnd())],
  ['fan-like rumble 3 s', make(3, () => (brown = Math.max(-0.5, Math.min(0.5, brown + 0.04 * rnd()))))],
  ['clicks (keyboard) 3 s', make(3, (i) => (i % 8000 < 60 ? 0.6 * rnd() : 0.003 * rnd()))],
];
const refs = JSON.parse(readFileSync(join(DIR, 'refs.json'), 'utf8'));
const spoken = readdirSync(DIR)
  .filter((f) => /^s\d\d-app\.wav$/.test(f))
  .map((f) => ({ name: f, ref: refs[Number(f.slice(1, 3))], bytes: readFileSync(join(DIR, f)) }));

// ---------------------------------------------------------------- the instructions
const NO_SPEECH = 'Nobody is speaking in this audio. The only valid output is exactly: [NO_SPEECH]';
const variants = [
  ['today', HEAR_INSTRUCTION],
  [
    'sentinel',
    HEAR_INSTRUCTION.replace('If there is no speech, output nothing.', '') +
      '\nIf the audio has no clear human speech (silence, noise, a hum, music, a cough, a tap), output exactly [NO_SPEECH] and nothing else. Never invent, guess or complete words that were not clearly spoken: a wrong transcript is worse than [NO_SPEECH].',
  ],
  [
    'sentinel+examples',
    HEAR_INSTRUCTION.replace('If there is no speech, output nothing.', '') +
      '\nIf the audio has no clear human speech (silence, noise, a hum, music, a cough, a tap, a fan), output exactly [NO_SPEECH] and nothing else. Never invent, guess or complete words that were not clearly spoken: a wrong transcript is worse than [NO_SPEECH].\nExamples: silence -> [NO_SPEECH]; room noise -> [NO_SPEECH]; a faint unclear mumble -> [NO_SPEECH]; "pata nahi" clearly spoken -> pata nahi.',
  ],
];

// ---------------------------------------------------------------- the call
const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${VERTEX_HEAR_MODEL}:generateContent`;
async function hear(system, bytes) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: bytes.toString('base64') } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status !== 200) return `ERROR ${res.status} ${(j.error?.message ?? '').slice(0, 80)}`;
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const wer = (ref, hyp) => {
  const r = norm(ref).split(' ').filter(Boolean), h = norm(hyp).split(' ').filter(Boolean);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? d[r.length][h.length] / r.length : 0;
};
const isNone = (t) => t === '' || /^\[?\s*no[_ ]speech\s*\]?\.?$/i.test(t);

for (const [name, system] of variants) {
  const ns = await Promise.all(nonSpeech.map(([, b]) => hear(system, b)));
  const sp = await Promise.all(spoken.map((c) => hear(system, c.bytes)));
  const invented = ns.filter((t) => !isNone(t));
  const lost = sp.filter((t) => isNone(t));
  const meanWer = sp.reduce((s, t, i) => s + (isNone(t) ? 1 : wer(spoken[i].ref, t)), 0) / sp.length;
  console.log(`\n== ${name}`);
  console.log(`   no-speech clips answered with words: ${invented.length}/${nonSpeech.length}`);
  nonSpeech.forEach(([n], i) => console.log(`     ${n.padEnd(24)} -> ${ns[i] === '' ? '(empty)' : ns[i]}`));
  console.log(`   spoken clips: mean WER ${(meanWer * 100).toFixed(0)}%, treated as no speech: ${lost.length}/${sp.length}`);
}
