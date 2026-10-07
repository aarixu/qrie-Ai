/**
 * THE SAME TUTOR LINES, SPOKEN BY THREE GEMINI VOICES, AND WHAT EACH COST.
 *
 * Aarav (2026-10-07) wants to hear Gemini 3.8 Flash TTS beside what the app
 * speaks today and beside Piper, on his own phone. The live relay only knows the
 * 3.1 model (packages/relay/src/vertexSpeech.ts), so rather than change a
 * production relay for a listening test, each line is rendered once here and the
 * clips are served as static files by the test page (tools/voice-probe/
 * ear-shootout/piper.html).
 *
 *   gemini-3.1-flash-tts-preview  rendered by the relay's OWN `speakOnVertex`, so it is
 *                                 byte-for-byte what production asks for (same style
 *                                 prompt, voice Sulafat, lang en or hi-en)
 *   gemini-3.8-flash-tts          the 3.8 request shape: the style rides in
 *   gemini-3.8-flash-lite-tts     `speech_metadata`, the voice is `voiceConfig.voice`
 *
 * Every clip records how long the call took, the prompt and audio tokens Vertex
 * billed, and the rupees at the list prices below, so the cost per minute is
 * MEASURED here, not assumed from a price page.
 *
 *   node tools/voice-probe/tts-compare-samples.mjs --spend [out-dir]
 * Needs ffmpeg on PATH (clips are stored as 96 kbps mono MP3: a few tens of KB).
 * Key file: VERTEX_SA, else .secrets/vertex-service-account.json. Spends rupees.
 */
import '../prewarm/lib/register.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

if (!process.argv.includes('--spend')) {
  console.log('Spends about Rs 10-40 on Google. Re-run with --spend.');
  process.exit(0);
}
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'tools/voice-probe/out/tts-compare';

const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const { speakOnVertex, VERTEX_SPEECH_FALLBACK_MODEL } = await import('../../packages/relay/src/vertexSpeech.ts');
const tokens = createTokenSource(readServiceAccount(readFileSync(process.env.VERTEX_SA ?? '.secrets/vertex-service-account.json', 'utf8')));
const token = await tokens.token();
const project = tokens.projectId;

// ---------------------------------------------------------------- the lines (same ids the test page uses)
export const LINES = [
  ['A1', 'hi-en', 'बिल्कुल सही!'],
  ['A2', 'hi-en', 'कोई बात नहीं, फिर से कोशिश करो।'],
  ['A3', 'hi-en', 'ठीक है, चलो आगे बढ़ते हैं।'],
  ['A4', 'hi-en', 'अच्छा सवाल पूछा तुमने।'],
  ['B1', 'hi-en', 'अच्छा सोचा! अब बताओ, cell के अंदर glucose सबसे पहले कहाँ टूटता है?'],
  ['B2', 'hi-en', 'चलो इसे step by step देखते हैं। पहले ये बताओ, हमें त्रिभुज के बारे में क्या पता है?'],
  ['B3', 'hi-en', 'तुम्हारा answer लगभग सही है। बस एक चीज़ पर दोबारा सोचो: oxygen कहाँ से आती है?'],
  ['C1', 'hi-en', 'x का square जमा y का square बराबर z का square होता है। तो x की value कैसे निकालेंगे?'],
  ['C2', 'hi-en', 'कार्बन का atomic number 6 है और mass number 12। तो neutrons कितने हुए?'],
  ['C3', 'hi-en', '250 को 5 से भाग दो, तो 50 आता है। अब 50 में 2 और जोड़ो।'],
  ['C4', 'hi-en', 'त्रिभुज ABC में angle B नब्बे डिग्री है, तो hypotenuse कौन सी side है?'],
  ['D1', 'hi-en', 'Mitochondria को cell का powerhouse कहते हैं, क्योंकि यहीं ATP बनता है।'],
  ['D2', 'hi-en', 'Photosynthesis में पौधे carbon dioxide और पानी से glucose बनाते हैं।'],
  ['D3', 'hi-en', 'Reflex action में brain नहीं, spinal cord फ़ैसला लेता है।'],
  ['E1', 'hi-en', 'आज हम respiration पढ़ेंगे। जब हम साँस लेते हैं, तो oxygen हमारे blood के ज़रिए हर cell तक पहुँचती है, और वहाँ glucose से energy निकलती है। इसी energy से हम चलते, सोचते और खेलते हैं।'],
  ['F1', 'hi-en', 'Achha socha! Toh batao, cell ke andar glucose sabse pehle kahan tootta hai?'],
  ['F2', 'hi-en', 'Mujhe lagta hai tum sahi raaste par ho. Ek kaam karo, pehle x ki value nikalo.'],
  ['F3', 'hi-en', 'Pata nahi? Koi baat nahi, ek hint lete hain.'],
  ['G1', 'en', 'Good thinking. So where in the cell does the glucose start breaking down?'],
  ['G2', 'en', "Let's do this step by step. First, what do we already know about the triangle?"],
  ['G3', 'en', 'Your answer is almost right. Think again about where the oxygen comes from.'],
];

// ---------------------------------------------------------------- the models and their list prices (USD per 1M tokens)
const USD_INR = 88;
const MODELS = [
  { key: 'g31', label: 'Gemini 3.1 Flash TTS (abhi app mein)', model: 'gemini-3.1-flash-tts-preview', inUsd: 1.0, outUsd: 20.0 },
  { key: 'g38', label: 'Gemini 3.8 Flash TTS', model: 'gemini-3.8-flash-tts', inUsd: 0.5, outUsd: 9.0 },
  { key: 'g38l', label: 'Gemini 3.8 Flash-Lite TTS', model: 'gemini-3.8-flash-lite-tts', inUsd: 0.5, outUsd: 6.0 },
];
const STYLE_38 =
  'Meera, a school teacher taking a live class and talking to one student. Clear, confident and natural, friendly but matter-of-fact, no sing-song, no breathiness. A normal conversational pace, with no long pauses. Indian accent: Delhi schoolteacher English, and Hinglish with Hindi words said as a native Hindi speaker says them.';

const vertex = { tokens };
const wavSeconds = (wav) => (wav.byteLength - 44) / 48_000; // 24 kHz, 16-bit, mono

async function render38(model, text) {
  const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text, speech_metadata: { style: STYLE_38 } }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Sulafat' } } },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`${model} HTTP ${res.status} ${(j.error?.message ?? '').slice(0, 160)}`);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(`${model} answered without audio`);
  return { wav: Buffer.from(part.inlineData.data, 'base64'), promptTokens: j.usageMetadata?.promptTokenCount, outputTokens: j.usageMetadata?.candidatesTokenCount };
}

async function render31(text, lang) {
  // Forced to 3.1: the relay's default is 3.8 Flash-Lite since 2026-10-07, and a forced model gets no fallback.
  const r = await speakOnVertex(text, vertex, { lang, format: 'wav', model: VERTEX_SPEECH_FALLBACK_MODEL });
  if (r.status !== 200 || r.response.body.kind !== 'bytes') throw new Error(`3.1 HTTP ${r.status}`);
  return { wav: Buffer.from(r.response.body.value), promptTokens: r.promptTokens, outputTokens: r.outputTokens };
}

function mp3(wav) {
  const p = spawnSync('ffmpeg', ['-v', 'error', '-f', 'wav', '-i', 'pipe:0', '-ac', '1', '-b:a', '96k', '-f', 'mp3', 'pipe:1'], { input: wav, maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error('ffmpeg failed: ' + String(p.stderr).slice(0, 200));
  return p.stdout;
}

const results = {};
mkdirSync(OUT, { recursive: true });
const jobs = [];
for (const m of MODELS) for (const [id, lang, text] of LINES) jobs.push({ m, id, lang, text });

let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { m, id, lang, text } = jobs[next++];
    const t0 = performance.now();
    try {
      const r = m.key === 'g31' ? await render31(text, lang) : await render38(m.model, text);
      const ms = Math.round(performance.now() - t0);
      const seconds = wavSeconds(r.wav);
      const outTokens = r.outputTokens ?? Math.round(seconds * 32);
      const inTokens = r.promptTokens ?? 0;
      const rupees = ((inTokens * m.inUsd + outTokens * m.outUsd) / 1e6) * USD_INR;
      mkdirSync(join(OUT, m.key), { recursive: true });
      writeFileSync(join(OUT, m.key, `${id}.mp3`), mp3(r.wav));
      (results[id] ??= {})[m.key] = { seconds: +seconds.toFixed(2), ms, inTokens, outTokens, tokensPerSecond: +(outTokens / seconds).toFixed(1), rupees: +rupees.toFixed(4), billedByVertex: r.outputTokens !== undefined };
      process.stdout.write('.');
    } catch (e) {
      (results[id] ??= {})[m.key] = { error: String(e.message ?? e) };
      process.stdout.write('x');
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log('\n');

writeFileSync(join(OUT, 'index.json'), JSON.stringify({ models: MODELS.map(({ key, label, model, inUsd, outUsd }) => ({ key, label, model, inUsd, outUsd })), usdInr: USD_INR, lines: LINES.map(([id, lang, text]) => ({ id, lang, text })), results }, null, 2));

// ---------------------------------------------------------------- what it cost, measured
console.log('model'.padEnd(40), 'clips', ' audio s', ' tok/s', '  Rs total', ' Rs/min of speech', ' median call');
for (const m of MODELS) {
  const rows = Object.values(results).map((r) => r[m.key]).filter((x) => x && !x.error);
  const secs = rows.reduce((s, x) => s + x.seconds, 0), rs = rows.reduce((s, x) => s + x.rupees, 0), tok = rows.reduce((s, x) => s + x.outTokens, 0);
  const med = [...rows.map((x) => x.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  const failed = Object.values(results).filter((r) => r[m.key]?.error).length;
  console.log(m.model.padEnd(40), String(rows.length).padStart(5), secs.toFixed(0).padStart(8), (tok / secs).toFixed(1).padStart(6), rs.toFixed(2).padStart(10), ((rs / secs) * 60).toFixed(2).padStart(17), String(med).padStart(8) + ' ms', failed ? `  (${failed} FAILED)` : '');
}
console.log(`\nclips and index.json are in ${OUT}`);
