/**
 * WHICH GEMINI VOICE, STREAMED, ON VERTEX (Aarav, 2026-09-30: "Gemini TTS 2.5
 * Pro ya Gemini 3.1 TTS Live — model name recheck karke streaming mein check
 * karo").
 *
 * 1. Every Gemini TTS model name that might exist on Vertex is tried with a
 *    one-word call; the ones that answer are timed STREAMED
 *    (streamGenerateContent?alt=sse): time to the first audio chunk, total
 *    time, seconds of audio, three runs per line.
 * 2. The Live native-audio models on Vertex (a websocket, bearer token) are
 *    tried as a voice: told to read the text word for word, timed to the
 *    first audio chunk, and their own transcript kept to show whether they
 *    really read it verbatim.
 * The first run of each model and line is saved as a WAV in
 * tools/voice-probe/out/ so the voices can be compared by ear.
 *   node tools/voice-probe/tts-models.mjs --spend
 */
import '../prewarm/lib/register.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from 'ws';

if (!process.argv.includes('--spend')) {
  console.log('Spends a few rupees on Google. Re-run with --spend.');
  process.exit(0);
}
const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const tokens = createTokenSource(readServiceAccount(readFileSync('.secrets/vertex-service-account.json', 'utf8')));
const token = await tokens.token();
const PROJECT = tokens.projectId;
const OUT = 'tools/voice-probe/out';
mkdirSync(OUT, { recursive: true });

const LINES = [
  { lang: 'en', text: 'Good thinking. So where in the cell does the glucose start breaking down?' },
  { lang: 'hi-en', text: 'Achha socha! Toh batao, cell ke andar glucose sabse pehle kahan tootta hai?' },
];
const ms = (t0) => Math.round(performance.now() - t0);
const slug = (s) => s.replace(/[^a-z0-9.-]+/gi, '_');

function wav(pcm, rate) {
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0); out.writeUInt32LE(36 + pcm.length, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36);
  out.writeUInt32LE(pcm.length, 40); pcm.copy(out, 44);
  return out;
}

const host = (loc) => (loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`);
const modelUrl = (loc, model, verb) =>
  `https://${host(loc)}/v1/projects/${PROJECT}/locations/${loc}/publishers/google/models/${model}:${verb}`;
const ttsBody = (line) => ({
  contents: [{ role: 'user', parts: [{ text: line.text }] }],
  generationConfig: {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } }, languageCode: line.lang === 'hi-en' ? 'hi-IN' : 'en-IN' },
  },
});

// ------------------------------------------------------------- which names exist
const TTS_CANDIDATES = [
  'gemini-3.1-flash-tts-preview', // today's /api/speech
  'gemini-3.1-flash-tts',
  'gemini-3.1-pro-tts',
  'gemini-3.1-pro-tts-preview',
  'gemini-2.5-pro-tts',
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-flash-tts',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-flash-lite-preview-tts',
];
const exists = [];
for (const model of TTS_CANDIDATES) {
  let found = null;
  for (const loc of ['global', 'us-central1']) {
    const res = await fetch(modelUrl(loc, model, 'generateContent'), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(ttsBody({ lang: 'en', text: 'Hello.' })),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 200) { found = loc; break; }
    console.log(`  ${model} @ ${loc}: ${res.status} ${(j.error?.message ?? '').slice(0, 110)}`);
  }
  if (found) { exists.push({ model, loc: found }); console.log(`FOUND ${model} @ ${found}`); }
}

// ------------------------------------------------------------- streamed timing
async function streamed(model, loc, line) {
  const t0 = performance.now();
  const res = await fetch(modelUrl(loc, model, 'streamGenerateContent') + '?alt=sse', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(ttsBody(line)),
  });
  if (res.status !== 200) return { error: `${res.status} ${(await res.text()).slice(0, 150)}` };
  const reader = res.body.getReader();
  let buf = '', first, chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += Buffer.from(value).toString('utf8');
    if (first === undefined && /"inlineData"/.test(buf)) first = ms(t0);
  }
  const pcm = Buffer.concat([...buf.matchAll(/"data":\s*"([A-Za-z0-9+/=]+)"/g)].map((m) => { chunks++; return Buffer.from(m[1], 'base64'); }));
  return { first, total: ms(t0), seconds: +(pcm.length / 48000).toFixed(1), chunks, pcm };
}

const results = {};
for (const { model, loc } of exists) {
  for (const line of LINES) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = await streamed(model, loc, line);
      if (i === 0 && r.pcm?.length) writeFileSync(`${OUT}/tts-${slug(model)}-${line.lang}.wav`, wav(r.pcm, 24000));
      runs.push(r.error ? { error: r.error } : { first: r.first, total: r.total, seconds: r.seconds, chunks: r.chunks });
      if (r.error) break;
    }
    results[`${model} [${line.lang}]`] = runs;
    console.log(`STREAM ${model} [${line.lang}]:`, runs.map((r) => (r.error ? `ERROR ${r.error}` : `first ${r.first} ms, total ${r.total} ms, ${r.seconds}s audio, ${r.chunks} chunks`)).join('  |  '));
  }
}

// ------------------------------------------------------------- Live native audio as a voice
const LIVE_CANDIDATES = [
  'gemini-live-2.5-flash-native-audio',
  'gemini-live-2.5-flash-preview-native-audio-09-2025',
  'gemini-3.1-flash-live-preview',
  'gemini-3.1-flash-live',
  'gemini-3.8-live',
];
function liveOnce(model, loc, line) {
  return new Promise((resolve) => {
    const url = `wss://${host(loc)}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    let t0, first, said = '', pcm = [], done = false;
    const finish = (out) => { if (done) return; done = true; try { ws.close(); } catch {} resolve(out); };
    const timer = setTimeout(() => finish({ error: 'timeout 20s', said }), 20_000);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        setup: {
          model: `projects/${PROJECT}/locations/${loc}/publishers/google/models/${model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } } },
          },
          systemInstruction: { parts: [{ text: 'You are a voice. Read the user text aloud exactly, word for word, in the same language mix, with natural warm expression. Say nothing else.' }] },
          outputAudioTranscription: {},
        },
      }));
    });
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.setupComplete) {
        t0 = performance.now();
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: line.text }] }], turnComplete: true } }));
        return;
      }
      const parts = m.serverContent?.modelTurn?.parts ?? [];
      for (const p of parts) if (p.inlineData?.data) { if (first === undefined) first = ms(t0); pcm.push(Buffer.from(p.inlineData.data, 'base64')); }
      if (m.serverContent?.outputTranscription?.text) said += m.serverContent.outputTranscription.text;
      if (m.serverContent?.turnComplete) {
        clearTimeout(timer);
        finish({ first, total: ms(t0), seconds: +(Buffer.concat(pcm).length / 48000).toFixed(1), said: said.trim(), pcm: Buffer.concat(pcm) });
      }
      if (m.error) { clearTimeout(timer); finish({ error: JSON.stringify(m.error).slice(0, 160) }); }
    });
    ws.on('error', (e) => { clearTimeout(timer); finish({ error: String(e.message).slice(0, 160) }); });
    ws.on('close', (code, reason) => { clearTimeout(timer); finish({ error: `closed ${code} ${reason.toString().slice(0, 160)}`, said }); });
  });
}
for (const model of LIVE_CANDIDATES) {
  for (const loc of ['us-central1', 'global']) {
    const probe = await liveOnce(model, loc, LINES[0]);
    if (probe.error) { console.log(`  LIVE ${model} @ ${loc}: ${probe.error}`); continue; }
    console.log(`FOUND LIVE ${model} @ ${loc}`);
    for (const line of LINES) {
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const r = i === 0 && line === LINES[0] ? probe : await liveOnce(model, loc, line);
        if (i === 0 && r.pcm?.length) writeFileSync(`${OUT}/live-${slug(model)}-${line.lang}.wav`, wav(r.pcm, 24000));
        runs.push(r.error ? { error: r.error } : { first: r.first, total: r.total, seconds: r.seconds, said: r.said });
      }
      results[`LIVE ${model} [${line.lang}]`] = runs;
      console.log(`LIVE ${model} [${line.lang}]:`, runs.map((r) => (r.error ? `ERROR ${r.error}` : `first ${r.first} ms, total ${r.total} ms, ${r.seconds}s`)).join('  |  '));
      console.log(`     said: "${runs.find((r) => r.said)?.said ?? ''}"`);
    }
    break;
  }
}
writeFileSync(`${OUT}/tts-models.json`, JSON.stringify({ at: new Date().toISOString(), exists, results }, null, 2));
console.log(`\nWritten ${OUT}/tts-models.json`);
