/**
 * DOES GEMINI 3.8 FLASH-LITE TTS STREAM, AND IN WHAT SHAPE?
 *
 * The app plays her voice as raw 24 kHz 16-bit PCM the moment the first chunk
 * arrives (packages/relay/src/vertexSpeech.ts `sseToPcm`, first audio about
 * 1.3 s). That works because the 3.1 model streams PCM chunks over SSE. Before
 * the live voice moves to 3.8 this asks the 3.8 models the same thing: does
 * `:streamGenerateContent?alt=sse` answer, how many events, when does the first
 * one land, and is each chunk bare PCM or a WAV file with its own header (which
 * the PCM player would play as a click).
 *
 *   node tools/voice-probe/tts-38-stream-probe.mjs --spend
 * Key file: VERTEX_SA, else .secrets/vertex-service-account.json. Spends paise.
 */
import '../prewarm/lib/register.mjs';
import { readFileSync } from 'node:fs';

if (!process.argv.includes('--spend')) {
  console.log('Spends a few paise on Google. Re-run with --spend.');
  process.exit(0);
}
const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const tokens = createTokenSource(readServiceAccount(readFileSync(process.env.VERTEX_SA ?? '.secrets/vertex-service-account.json', 'utf8')));
const token = await tokens.token();
const project = tokens.projectId;

const LINES = [
  ['hi-en', 'अच्छा सोचा! अब बताओ, cell के अंदर glucose सबसे पहले कहाँ टूटता है?'],
  ['en', 'Good thinking. So where in the cell does the glucose start breaking down?'],
];
const STYLE = 'Meera, a school teacher taking a live class. Clear, confident and natural, friendly but matter-of-fact, no sing-song. Normal conversational pace.';

for (const model of ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts']) {
  for (const [lang, text] of LINES) {
    const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:streamGenerateContent?alt=sse`;
    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text, speech_metadata: { style: STYLE } }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Sulafat' } } },
      }),
    });
    console.log(`\n${model} [${lang}] HTTP ${res.status} headers in ${Math.round(performance.now() - t0)} ms`);
    if (res.status !== 200) { console.log('  ', (await res.text()).slice(0, 300)); continue; }
    const events = [];
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let usage;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      buf = buf.replace(/\r/g, '');
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, cut); buf = buf.slice(cut + 2);
        const line = block.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.usageMetadata) usage = ev.usageMetadata;
        for (const p of ev.candidates?.[0]?.content?.parts ?? []) {
          if (!p.inlineData) continue;
          const bytes = Buffer.from(p.inlineData.data, 'base64');
          events.push({ at: Math.round(performance.now() - t0), mime: p.inlineData.mimeType, bytes: bytes.length, riff: bytes.subarray(0, 4).toString('latin1') === 'RIFF' });
        }
      }
      if (done) break;
    }
    const total = events.reduce((s, e) => s + e.bytes, 0);
    console.log(`  audio events: ${events.length}, first audio at ${events[0]?.at} ms, last at ${events.at(-1)?.at} ms, total ${total} bytes`);
    console.log(`  mime types: ${[...new Set(events.map((e) => e.mime))].join(', ')} | chunks that start with a RIFF header: ${events.filter((e) => e.riff).length}`);
    console.log(`  first events: ${events.slice(0, 4).map((e) => `${e.bytes}B@${e.at}ms`).join('  ')}`);
    console.log(`  tokens in/out: ${usage?.promptTokenCount}/${usage?.candidatesTokenCount} (${(total / 48000).toFixed(1)} s of audio if bare PCM)`);
  }
}
