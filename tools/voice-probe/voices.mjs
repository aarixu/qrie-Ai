/**
 * HER VOICE AT A NORMAL PACE (Aarav, 2026-10-02: "voice bahut zyada hi slow
 * aur pleasing hai, ise normal voice hona chahiye").
 *
 * The same two class lines, English and Hinglish, said by Gemini 3.1 Flash TTS
 * on Vertex: once with today's prompt and voice (the baseline), then with a
 * plain classroom-pace prompt on several voices. For each: seconds of audio,
 * characters a second, and the share of it that is pause (20 ms frames below a
 * quiet floor). Every take is saved as a WAV under tools/voice-probe/out/voices/
 * so the voices can be compared by ear.
 *   node tools/voice-probe/voices.mjs --spend
 */
import '../prewarm/lib/register.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

if (!process.argv.includes('--spend')) {
  console.log('Spends a few rupees on Google. Re-run with --spend.');
  process.exit(0);
}
const { readServiceAccount, createTokenSource } = await import('../../packages/relay/src/googleAuth.ts');
const { speechPrompt, VERTEX_SPEECH_MODEL } = await import('../../packages/relay/src/vertexSpeech.ts');
const tokens = createTokenSource(readServiceAccount(readFileSync('.secrets/vertex-service-account.json', 'utf8')));
const OUT = 'tools/voice-probe/out/voices';
mkdirSync(OUT, { recursive: true });

const LINES = [
  {
    lang: 'en',
    text: 'Inside the mitochondrion, glucose reacts completely with oxygen to produce carbon dioxide, water, and energy in the form of ATP.',
  },
  {
    lang: 'hi-en',
    text: 'Jab oxygen kam pad jaati hai, toh muscle cells thodi der ke liye anaerobic respiration karti hain, aur lactic acid banta hai.',
  },
];

/** The candidate: a teacher taking a class, at the pace people actually talk. */
const NORMAL = (text, lang) =>
  [
    'Synthesize speech for the transcript below. Do not read these instructions aloud.',
    '# AUDIO PROFILE: Meera',
    '## a school teacher taking a live class',
    '## THE SCENE',
    'A classroom. She is teaching one student and talking to them directly.',
    "### DIRECTOR'S NOTES",
    'Style: Clear, confident and natural, the way a good teacher talks in class. Friendly but matter-of-fact: no sing-song, no breathiness, no soothing or dramatic tone.',
    'Pacing: A normal conversational pace, like everyday speech. Keep it moving, with no long pauses between phrases.',
    `Accent: ${
      lang === 'hi-en'
        ? 'Hinglish, the way a Delhi schoolteacher really talks to a student: Hindi words said as a native Hindi speaker says them, English and science terms in clear Indian English, switching between the two naturally mid-sentence.'
        : 'Indian English as spoken by an educated schoolteacher in Delhi - clear, natural Indian English, not anglicised and not a caricature.'
    }`,
    '### TRANSCRIPT',
    text,
  ].join('\n');

const TAKES = [
  { name: 'today-Sulafat', voice: 'Sulafat', prompt: speechPrompt },
  ...['Sulafat', 'Kore', 'Erinome', 'Autonoe', 'Aoede', 'Leda', 'Despina', 'Laomedeia'].map((voice) => ({
    name: `normal-${voice}`,
    voice,
    prompt: NORMAL,
  })),
];

function wav(pcm, rate) {
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0); out.writeUInt32LE(36 + pcm.length, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36);
  out.writeUInt32LE(pcm.length, 40); pcm.copy(out, 44);
  return out;
}

/** Seconds of audio, and the share of 20 ms frames quieter than -40 dBFS, edges trimmed. */
function measure(pcm, rate) {
  const samples = pcm.length / 2;
  const frame = Math.round(rate * 0.02);
  const quiet = [];
  for (let f = 0; f + frame <= samples; f += frame) {
    let sum = 0;
    for (let i = f; i < f + frame; i += 1) {
      const s = pcm.readInt16LE(i * 2) / 32768;
      sum += s * s;
    }
    quiet.push(Math.sqrt(sum / frame) < 0.01);
  }
  let a = 0;
  let b = quiet.length;
  while (a < b && quiet[a]) a += 1;
  while (b > a && quiet[b - 1]) b -= 1;
  const inner = quiet.slice(a, b);
  return { seconds: inner.length * 0.02, pause: inner.filter(Boolean).length / Math.max(1, inner.length) };
}

const token = await tokens.token();
const url = `https://aiplatform.googleapis.com/v1/projects/${tokens.projectId}/locations/global/publishers/google/models/${VERTEX_SPEECH_MODEL}:generateContent`;
const rows = [];
for (const take of TAKES) {
  for (const line of LINES) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: take.prompt(line.text, line.lang) }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: take.voice } },
            languageCode: line.lang === 'hi-en' ? 'hi-IN' : 'en-IN',
          },
        },
      }),
    });
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!res.ok || !part) {
      console.log(`${take.name} ${line.lang}: ${res.status} ${JSON.stringify(data).slice(0, 160)}`);
      continue;
    }
    const pcm = Buffer.from(part.inlineData.data, 'base64');
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
    writeFileSync(`${OUT}/${take.name}-${line.lang}.wav`, wav(pcm, rate));
    const m = measure(pcm, rate);
    rows.push({ take: take.name, lang: line.lang, seconds: m.seconds, cps: line.text.length / m.seconds, pause: m.pause });
    console.log(
      `${take.name.padEnd(20)} ${line.lang.padEnd(5)} ${m.seconds.toFixed(2)} s  ${(line.text.length / m.seconds).toFixed(1)} chars/s  pause ${(m.pause * 100).toFixed(0)}%`,
    );
  }
}
writeFileSync(`${OUT}/results.json`, `${JSON.stringify(rows, null, 2)}\n`);
