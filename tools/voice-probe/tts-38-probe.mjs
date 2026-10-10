/**
 * WHICH GEMINI 3.8 TTS MODELS ANSWER ON VERTEX, AND IN WHICH REQUEST SHAPE?
 *
 * Google's Gemini API docs show the 3.8 TTS models taking the delivery style as a
 * `speech_metadata` annotation on the text part (not as a line of the transcript,
 * as the 3.1 prompt in packages/relay/src/vertexSpeech.ts does) and the voice as
 * `voiceConfig.voice` (not `prebuiltVoiceConfig.voiceName`). This tries both 3.8
 * models in three request shapes against this project's Vertex endpoint and
 * prints what each answers, so the sample generator uses a shape that works.
 *
 *   node tools/voice-probe/tts-38-probe.mjs --spend
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

const TEXT = 'अच्छा सोचा! तो बताओ, cell के अंदर glucose सबसे पहले कहाँ टूटता है?';
const STYLE = 'clear, confident, natural teacher, normal pace';
const url = (model) => `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
const shapes = {
  'snake speech_metadata + voice': { contents: [{ role: 'user', parts: [{ text: TEXT, speech_metadata: { style: STYLE } }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Sulafat' } } } },
  'camel speechMetadata + voice': { contents: [{ role: 'user', parts: [{ text: TEXT, speechMetadata: { style: STYLE } }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Sulafat' } } } },
  'no metadata + prebuiltVoiceConfig (the 3.1 shape)': { contents: [{ role: 'user', parts: [{ text: TEXT }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } } } } },
};
for (const model of ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']) {
  for (const [name, body] of Object.entries(shapes)) {
    const t0 = performance.now();
    const res = await fetch(url(model), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    const u = j.usageMetadata ?? {};
    console.log(`${model} | ${name}\n   HTTP ${res.status} ${ms} ms ${part ? `audio ${part.inlineData.mimeType} ${Math.round((part.inlineData.data.length * 0.75) / 1024)} KB` : ''} tokens in/out ${u.promptTokenCount}/${u.candidatesTokenCount} ${res.status !== 200 ? (j.error?.message ?? '').slice(0, 260) : ''}`);
  }
}
