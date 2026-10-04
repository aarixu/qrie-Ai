/**
 * IS GOOGLE'S OWN SPEECH-TO-TEXT (Chirp) CALLABLE ON THIS PROJECT?
 *
 * The ear today is a chat model told to transcribe (relay vertexHear.ts), not a
 * speech-recognition model. probe.mjs found Cloud Speech-to-Text v2 answering 403
 * SERVICE_DISABLED on 2026-09-30, and the service account cannot enable an API.
 * This asks the same question again with one clip, and prints Google's own
 * words, so the answer is a status and not a memory.
 *
 *   node tools/voice-probe/speech-api-check.mjs [clip.wav]
 * The key file is read from VERTEX_SA, else .secrets/vertex-service-account.json.
 * It sends one short clip (a fraction of a rupee at most).
 */
import '../prewarm/lib/register.mjs';
import { readFileSync } from 'node:fs';

const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const tokens = createTokenSource(
  readServiceAccount(readFileSync(process.env.VERTEX_SA ?? '.secrets/vertex-service-account.json', 'utf8')),
);
const token = await tokens.token();
const project = tokens.projectId;
const clip = readFileSync(process.argv[2] ?? 'tools/voice-probe/out/clip-3.wav');

for (const [model, location, languageCodes] of [
  ['chirp_3', 'us', ['auto']],
  ['chirp_3', 'asia-south1', ['auto']],
]) {
  const host = location === 'global' ? 'speech.googleapis.com' : `${location}-speech.googleapis.com`;
  const t0 = performance.now();
  const res = await fetch(`https://${host}/v2/projects/${project}/locations/${location}/recognizers/_:recognize`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-goog-user-project': project },
    body: JSON.stringify({
      config: { autoDecodingConfig: {}, model, languageCodes, features: { enableAutomaticPunctuation: true } },
      content: clip.toString('base64'),
    }),
  });
  const body = await res.json().catch(() => ({}));
  const ms = Math.round(performance.now() - t0);
  const heard = (body.results ?? []).map((r) => r.alternatives?.[0]?.transcript ?? '').join(' ').trim();
  console.log(`${model} @ ${location}: HTTP ${res.status} in ${ms} ms`);
  if (res.status === 200) console.log(`  heard: "${heard}"`);
  else console.log(`  ${body.error?.status ?? ''} ${(body.error?.message ?? JSON.stringify(body)).slice(0, 400)}`);
}
