/**
 * HOW MANY PROMPT TOKENS DOES THE EAR'S INSTRUCTION COST?
 *
 * The relay charges a spoken answer 12 s at the door and then settles it from
 * Vertex's promptTokenCount: (tokens - HEAR_INSTRUCTION_TOKENS) / 25 a second
 * (packages/relay/src/hearFormat.ts). Change the instruction and that constant
 * is wrong. This sends clips of three lengths with the CURRENT instruction and
 * solves tokens = fixed + perSecond x seconds, so the constant can be set from a
 * measurement and the 25 a second can be confirmed.
 *
 *   node tools/voice-probe/ear-instruction-tokens.mjs --spend
 */
import '../prewarm/lib/register.mjs';
import { readFileSync } from 'node:fs';

if (!process.argv.includes('--spend')) {
  console.log('Spends a few paise on Google. Re-run with --spend.');
  process.exit(0);
}
const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const { HEAR_INSTRUCTION, VERTEX_HEAR_MODEL } = await import('../../packages/relay/src/vertexHear.ts');
const tokens = createTokenSource(readServiceAccount(readFileSync(process.env.VERTEX_SA ?? '.secrets/vertex-service-account.json', 'utf8')));
const token = await tokens.token();

const silence = (secs) => {
  const pcm = Buffer.alloc(Math.floor(16000 * secs) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};
const url = `https://aiplatform.googleapis.com/v1/projects/${tokens.projectId}/locations/global/publishers/google/models/${VERTEX_HEAR_MODEL}:generateContent`;

const points = [];
for (const secs of [2, 4, 8]) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: HEAR_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: silence(secs).toString('base64') } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 20, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  const j = await res.json();
  const n = j.usageMetadata?.promptTokenCount;
  console.log(`${secs} s of audio -> ${n} prompt tokens (HTTP ${res.status})`);
  points.push([secs, n]);
}
const [[s1, n1], , [s3, n3]] = points;
const perSecond = (n3 - n1) / (s3 - s1);
console.log(`\nper second: ${perSecond.toFixed(1)}   fixed (the instruction): ${(n1 - perSecond * s1).toFixed(0)}`);
