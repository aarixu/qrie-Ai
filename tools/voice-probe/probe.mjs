/**
 * VOICE PROBE (Aarav, 2026-09-30: "TTS & STT fix karo — kya ye Vertex ke
 * through ho sakta hai?").
 *
 * Measures, straight against Google with the relay's own service account
 * (.secrets/vertex-service-account.json), the ear and the voice the relay uses
 * today against the Google Cloud alternatives on the same account:
 *   ear:   Gemini 3.1 flash-lite (today's /api/hear)  vs  Cloud Speech-to-Text v2 Chirp 3
 *   voice: Gemini 3.1 flash TTS, streamed (today's /api/speech)  vs  Cloud Text-to-Speech Chirp 3 HD
 * The student clips are synthesised (a different voice from hers), so the
 * accuracy numbers are an optimistic bound, never a verdict on real phones.
 *
 * Spends real money (a few rupees): run with --spend.
 *   node tools/voice-probe/probe.mjs --spend
 */
import '../prewarm/lib/register.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

if (!process.argv.includes('--spend')) {
  console.log('Spends a few rupees on Google. Re-run with --spend.');
  process.exit(0);
}

const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const account = readServiceAccount(readFileSync('.secrets/vertex-service-account.json', 'utf8'));
const tokens = createTokenSource(account);
const PROJECT = tokens.projectId;
const token = await tokens.token();
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-goog-user-project': PROJECT };

const OUT = 'tools/voice-probe/out';
mkdirSync(OUT, { recursive: true });

/** What a Class 10 student says in a class, in both registers. */
const CLIPS = [
  { lang: 'en', text: 'I think breathing gives us energy directly.' },
  { lang: 'en', text: 'Respiration happens in the mitochondria.' },
  { lang: 'en', text: 'Glucose breaks down into pyruvate first.' },
  { lang: 'hi-en', text: 'mujhe lagta hai saans lene se energy milti hai' },
  { lang: 'hi-en', text: 'yeast mein oxygen nahi hoti toh alcohol banta hai' },
  { lang: 'hi-en', text: 'muscles mein lactic acid banta hai isliye cramp aata hai' },
  { lang: 'hi-en', text: 'pata nahi, ek hint do na' },
  { lang: 'hi-en', text: 'haan samajh aa gaya, aage chalo' },
];

/** Lines she says, for the voice test. */
const LINES = [
  { lang: 'en', text: 'Good thinking. So where in the cell does the glucose start breaking down?' },
  { lang: 'hi-en', text: 'Achha socha! Toh batao, cell ke andar glucose sabse pehle kahan tootta hai?' },
];

const ms = (t0) => Math.round(performance.now() - t0);
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

function wav(pcm, rate) {
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0); out.writeUInt32LE(36 + pcm.length, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36);
  out.writeUInt32LE(pcm.length, 40); Buffer.from(pcm).copy(out, 44);
  return out;
}

/** 24 kHz → 16 kHz, linear. Good enough for a transcription test. */
function to16k(pcm24) {
  const src = new Int16Array(pcm24.buffer, pcm24.byteOffset, pcm24.byteLength / 2);
  const n = Math.floor((src.length * 2) / 3);
  const dst = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 3) / 2, j = Math.floor(x), f = x - j;
    dst[i] = Math.round(src[j] * (1 - f) + (src[Math.min(j + 1, src.length - 1)] ?? 0) * f);
  }
  return new Uint8Array(dst.buffer);
}

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
const devanagari = (s) => /[ऀ-ॿ]/.test(s);

async function json(url, body) {
  const t0 = performance.now();
  const res = await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
  return { status: res.status, ms: ms(t0), body: parsed };
}

// ---------------------------------------------------------------- the student clips
// Synthesised with Gemini TTS in a DIFFERENT voice (Puck), so the ear is not
// hearing her own voice back.
const GEMINI = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models`;
const clips = [];
for (const c of CLIPS) {
  const r = await json(`${GEMINI}/gemini-3.1-flash-tts-preview:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: `Say this like a 15-year-old Indian student answering a teacher, naturally: ${c.text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }, languageCode: c.lang === 'hi-en' ? 'hi-IN' : 'en-IN' },
    },
  });
  const data = r.body?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (r.status !== 200 || !data) { console.log('clip synthesis failed', r.status, JSON.stringify(r.body).slice(0, 300)); continue; }
  const pcm16k = to16k(new Uint8Array(Buffer.from(data, 'base64')));
  const file = wav(pcm16k, 16000);
  writeFileSync(`${OUT}/clip-${clips.length}.wav`, file);
  clips.push({ ...c, wav: file, seconds: pcm16k.length / 32000 });
}
console.log(`\n${clips.length} student clips made.`);

// ---------------------------------------------------------------- ears
const INSTRUCTION =
  "Transcribe the student's speech in this audio exactly as spoken. The student is an Indian school student and may speak English, Hindi, or a mix (Hinglish). " +
  'Write Hindi words in Roman script as Hinglish, never in Devanagari. ' +
  'Do not translate, correct, summarise or answer. If there is no speech, output nothing. Output only the transcript.';

const ears = {
  'gemini-3.1-flash-lite (today)': async (clip) => {
    const r = await json(`${GEMINI}/gemini-3.1-flash-lite:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: INSTRUCTION }, { inlineData: { mimeType: 'audio/wav', data: b64(clip.wav) } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 300, thinkingConfig: { thinkingLevel: 'LOW' } },
    });
    return { ...r, text: (r.body?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim() };
  },
};
for (const [label, location, model, languageCodes] of [
  ['chirp_3 us auto', 'us', 'chirp_3', ['auto']],
  ['chirp_3 us hi-IN+en-IN', 'us', 'chirp_3', ['hi-IN', 'en-IN']],
  ['chirp_3 asia-south1 auto', 'asia-south1', 'chirp_3', ['auto']],
  ['chirp_2 us-central1 en-IN', 'us-central1', 'chirp_2', ['en-IN']],
]) {
  ears[label] = async (clip) => {
    const host = location === 'global' ? 'speech.googleapis.com' : `${location}-speech.googleapis.com`;
    const r = await json(`https://${host}/v2/projects/${PROJECT}/locations/${location}/recognizers/_:recognize`, {
      config: { autoDecodingConfig: {}, model, languageCodes, features: { enableAutomaticPunctuation: true } },
      content: b64(clip.wav),
    });
    return { ...r, text: (r.body?.results ?? []).map((x) => x.alternatives?.[0]?.transcript ?? '').join(' ').trim() };
  };
}

const earResults = {};
for (const [label, hear] of Object.entries(ears)) {
  const rows = [];
  for (const clip of clips) {
    const r = await hear(clip);
    if (r.status !== 200) {
      rows.push({ status: r.status, error: JSON.stringify(r.body?.error?.message ?? r.body).slice(0, 220) });
      if (rows.length === 1) break; // one failure explains the rest (API off, model not in region)
      continue;
    }
    rows.push({ ms: r.ms, said: clip.text, heard: r.text, wer: +wer(clip.text, r.text).toFixed(2), devanagari: devanagari(r.text) });
  }
  earResults[label] = rows;
  const ok = rows.filter((x) => x.ms !== undefined);
  const sorted = ok.map((x) => x.ms).sort((a, b) => a - b);
  console.log(`\nEAR ${label}: ${ok.length}/${clips.length} ok` +
    (ok.length ? ` · median ${sorted[Math.floor(sorted.length / 2)]} ms · mean WER ${(ok.reduce((s, x) => s + x.wer, 0) / ok.length).toFixed(2)} · Devanagari ${ok.filter((x) => x.devanagari).length}` : ''));
  for (const x of rows) console.log('   ', x.error ? `ERROR ${x.status}: ${x.error}` : `${x.ms} ms  wer ${x.wer}  "${x.heard}"`);
}

// ---------------------------------------------------------------- voices
const voiceResults = {};
// Today's: Gemini TTS streamed through SSE; first audio = first chunk with inlineData.
async function geminiStreamed(line) {
  const t0 = performance.now();
  const res = await fetch(`${GEMINI}/gemini-3.1-flash-tts-preview:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: line.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } }, languageCode: line.lang === 'hi-en' ? 'hi-IN' : 'en-IN' },
      },
    }),
  });
  if (res.status !== 200) return { status: res.status, error: (await res.text()).slice(0, 200) };
  const reader = res.body.getReader();
  let first, buf = '', bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += Buffer.from(value).toString('utf8');
    const m = [...buf.matchAll(/"data":\s*"([A-Za-z0-9+/=]+)"/g)];
    if (m.length && first === undefined) first = ms(t0);
  }
  for (const m of buf.matchAll(/"data":\s*"([A-Za-z0-9+/=]+)"/g)) bytes += Buffer.from(m[1], 'base64').length;
  return { status: 200, firstAudioMs: first, totalMs: ms(t0), audioSeconds: +(bytes / 48000).toFixed(1) };
}
async function cloudTts(line, voice) {
  const langCode = line.lang === 'hi-en' ? 'hi-IN' : 'en-IN';
  const r = await json('https://texttospeech.googleapis.com/v1/text:synthesize', {
    input: { text: line.text },
    voice: { languageCode: langCode, name: `${langCode}-${voice}` },
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 },
  });
  if (r.status !== 200) return { status: r.status, error: JSON.stringify(r.body?.error?.message ?? r.body).slice(0, 220) };
  const audio = Buffer.from(r.body.audioContent, 'base64');
  writeFileSync(`${OUT}/voice-${voice}-${line.lang}.wav`, audio);
  return { status: 200, firstAudioMs: r.ms, totalMs: r.ms, audioSeconds: +((audio.length - 44) / 48000).toFixed(1) };
}
for (const line of LINES) {
  for (let i = 0; i < 3; i++) {
    for (const [label, run] of [
      ['gemini-3.1-flash-tts streamed (today)', () => geminiStreamed(line)],
      ['cloud-tts Chirp3-HD-Sulafat (whole line)', () => cloudTts(line, 'Chirp3-HD-Sulafat')],
    ]) {
      const r = await run();
      (voiceResults[`${label} [${line.lang}]`] ??= []).push(r);
    }
  }
}
console.log('\nVOICES (3 runs each):');
for (const [label, runs] of Object.entries(voiceResults)) {
  console.log('  ', label, runs.map((r) => (r.error ? `ERROR ${r.status}: ${r.error}` : `first ${r.firstAudioMs} ms / total ${r.totalMs} ms / ${r.audioSeconds}s audio`)).join('  |  '));
}

writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), earResults, voiceResults }, null, 2));
console.log(`\nWritten ${OUT}/results.json`);
