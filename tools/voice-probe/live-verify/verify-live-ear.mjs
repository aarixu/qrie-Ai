// After the relay deploy: the six no-speech clips and the eight spoken clips, through the LIVE /api/hear
// exactly as the app sends them (anonymous sign-in, WAV body). Nothing here prints a key.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const page = readFileSync(process.argv[2], 'utf8');
const cfg = (k) => new RegExp(`${k}:\\s*'([^']+)'`).exec(page)?.[1];
const supabase = cfg('supabase'), relay = cfg('relay'), anon = cfg('anon');
const DIR = process.argv[3];

const su = await fetch(`${supabase}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ data: {} }) });
const { access_token } = await su.json();

function wav(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(Math.max(-1, Math.min(1, s)) * 0x7fff, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
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
const spoken = readdirSync(DIR).filter((f) => /^s\d\d-app\.wav$/.test(f)).map((f) => [refs[Number(f.slice(1, 3))], readFileSync(join(DIR, f))]);

async function hear(bytes) {
  const t0 = performance.now();
  const res = await fetch(`${relay}/api/hear`, { method: 'POST', headers: { authorization: `Bearer ${access_token}`, 'content-type': 'audio/wav' }, body: bytes });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, text: j.text, ms: Math.round(performance.now() - t0), err: j.error?.message };
}

console.log('== no speech, through the live relay');
let invented = 0;
for (const [name, b] of nonSpeech) {
  const r = await hear(b);
  const empty = r.status === 200 && r.text === '';
  if (!empty) invented++;
  console.log(`  ${name.padEnd(24)} HTTP ${r.status}  text: ${JSON.stringify(r.text ?? r.err)}  ${r.ms} ms  ${empty ? 'OK (empty)' : 'NOT EMPTY'}`);
}
console.log(`  answered with words or failed: ${invented}/${nonSpeech.length}`);

console.log('\n== spoken clips, through the live relay');
let bad = 0;
for (const [ref, b] of spoken) {
  const r = await hear(b);
  if (r.status !== 200 || !r.text) bad++;
  console.log(`  HTTP ${r.status}  ${String(r.ms).padStart(5)} ms  said: ${ref}\n                       heard: ${JSON.stringify(r.text ?? r.err)}`);
}
console.log(`  empty or failed: ${bad}/${spoken.length}`);
