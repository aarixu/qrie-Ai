/**
 * THE RELAY'S OWN VOICE CODE, AGAINST THE REAL VERTEX, BEFORE IT IS DEPLOYED.
 *
 * The unit tests answer from a mock, and a mock cannot catch a request field the
 * model refuses (it took her voice down for five minutes once: maxOutputTokens,
 * 2026-09-29). This runs the code the relay would run, not a copy of it:
 *   - `speakOnVertex` (the collected path: old clients, and the retry),
 *   - `vertexSpeechCall` + `sseToPcm` (the streamed path the app uses), timing the
 *     first chunk,
 *   - a forced bad model, to see the fallback speak the line on 3.1.
 *
 *   node tools/voice-probe/tts-default-check.mjs --spend
 * Key file: VERTEX_SA, else .secrets/vertex-service-account.json. Spends paise.
 */
import '../prewarm/lib/register.mjs';
import { readFileSync } from 'node:fs';

if (!process.argv.includes('--spend')) {
  console.log('Spends a few paise on Google. Re-run with --spend.');
  process.exit(0);
}
const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const V = await import('../../packages/relay/src/vertexSpeech.ts');
const tokens = createTokenSource(readServiceAccount(readFileSync(process.env.VERTEX_SA ?? '.secrets/vertex-service-account.json', 'utf8')));
const vertex = { tokens };
const LINES = [
  ['en', 'Good thinking. So where in the cell does the glucose start breaking down?'],
  ['hi-en', 'अच्छा सोचा! अब बताओ, cell के अंदर glucose सबसे पहले कहाँ टूटता है?'],
  ['hi-en', 'Achha socha! Toh batao, cell ke andar glucose sabse pehle kahan tootta hai?'],
];
console.log('default model:', V.VERTEX_SPEECH_MODEL, '| fallback:', V.VERTEX_SPEECH_FALLBACK_MODEL);

console.log('\n== collected (speakOnVertex)');
for (const [lang, text] of LINES) {
  const t0 = performance.now();
  const r = await V.speakOnVertex(text, vertex, { lang, format: 'wav' });
  const bytes = r.response.body.kind === 'bytes' ? r.response.body.value.byteLength : 0;
  console.log(`  ${lang.padEnd(5)} HTTP ${r.status} model ${r.model} ${((bytes - 44) / 48000).toFixed(1)} s of audio, ${Math.round(performance.now() - t0)} ms, tokens in/out ${r.promptTokens}/${r.outputTokens}`);
}

console.log('\n== streamed (vertexSpeechCall -> sseToPcm), what the app plays');
for (const [lang, text] of LINES) {
  const call = await V.vertexSpeechCall(text, lang, vertex);
  const t0 = performance.now();
  const res = await fetch(call.url, { method: 'POST', headers: call.headers, body: call.body });
  let usage;
  const pcm = res.body.pipeThrough(V.sseToPcm((u) => (usage = u), { maxAudioBytes: V.maxSpeechBytes(text) }));
  const reader = pcm.getReader();
  let first = null, total = 0, chunks = 0, odd = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (first === null) first = Math.round(performance.now() - t0);
    total += value.byteLength; chunks += 1; if (value.byteLength % 2) odd += 1;
  }
  console.log(`  ${lang.padEnd(5)} HTTP ${res.status} first audio ${first} ms, ${chunks} chunks, ${(total / 48000).toFixed(1)} s of audio, odd-length chunks ${odd}, whole line ${Math.round(performance.now() - t0)} ms, billed in/out ${usage?.promptTokens}/${usage?.outputTokens}`);
}

console.log('\n== fallback: the default model name made unspeakable, 3.1 must speak the line');
const broken = { ...vertex, fetch: (url, init) => fetch(String(url).replace(V.VERTEX_SPEECH_MODEL, 'gemini-9.9-no-such-tts'), init) };
const r = await V.speakOnVertex(LINES[0][1], broken, { lang: 'en', format: 'wav' });
console.log(`  HTTP ${r.status} spoken by ${r.model}, ${((r.response.body.value.byteLength - 44) / 48000).toFixed(1)} s of audio`);
