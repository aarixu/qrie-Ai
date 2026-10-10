// The final live check after the relay deploy: 17 no-speech clips (six lengths of exact zeros and of a faint
// microphone floor, plus noise, tone, hum, rumble, clicks) and the eight spoken clips, all through the LIVE
// /api/hear as the app sends them. Run twice, apart, to rule out a stale instance. Prints no key.
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
const nonSpeech = [];
for (const s of [1, 1.5, 2, 2.5, 3, 4]) nonSpeech.push([`zeros ${s} s`, make(s, () => 0)]);
for (const s of [1, 1.5, 2, 2.5, 3, 4]) nonSpeech.push([`faint mic floor ${s} s`, make(s, () => 0.0006 * rnd())]);
nonSpeech.push(
  ['white noise 2 s', make(2, () => 0.2 * rnd())],
  ['tone 220 Hz 2 s', make(2, (i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / 16000))],
  ['hum + noise 3 s', make(3, (i) => 0.1 * Math.sin((2 * Math.PI * 100 * i) / 16000) + 0.08 * rnd())],
  ['fan-like rumble 3 s', make(3, () => (brown = Math.max(-0.5, Math.min(0.5, brown + 0.04 * rnd()))))],
  ['clicks (keyboard) 3 s', make(3, (i) => (i % 8000 < 60 ? 0.6 * rnd() : 0.003 * rnd()))],
);
const refs = JSON.parse(readFileSync(join(DIR, 'refs.json'), 'utf8'));
const spoken = readdirSync(DIR).filter((f) => /^s\d\d-app\.wav$/.test(f)).map((f) => [refs[Number(f.slice(1, 3))], readFileSync(join(DIR, f))]);

const hear = async (bytes) => {
  const res = await fetch(`${relay}/api/hear`, { method: 'POST', headers: { authorization: `Bearer ${access_token}`, 'content-type': 'audio/wav' }, body: bytes });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, text: j.text, err: j.error?.message };
};
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const wer = (ref, hyp) => {
  const r = norm(ref).split(' ').filter(Boolean), h = norm(hyp).split(' ').filter(Boolean);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? d[r.length][h.length] / r.length : 0;
};

for (const pass of [1, 2]) {
  const ns = await Promise.all(nonSpeech.map(([, b]) => hear(b)));
  const bad = nonSpeech.map(([n], i) => [n, ns[i]]).filter(([, r]) => !(r.status === 200 && r.text === ''));
  console.log(`pass ${pass}: no-speech clips that did NOT come back empty: ${bad.length}/${nonSpeech.length}`);
  for (const [n, r] of bad) console.log(`   ${n} -> HTTP ${r.status} ${JSON.stringify(r.text ?? r.err)}`);
  const sp = await Promise.all(spoken.map(([, b]) => hear(b)));
  const lost = sp.filter((r) => r.status !== 200 || !r.text).length;
  const mean = sp.reduce((s, r, i) => s + (r.text ? wer(spoken[i][0], r.text) : 1), 0) / sp.length;
  console.log(`pass ${pass}: spoken clips empty or failed: ${lost}/${spoken.length}, mean WER ${(mean * 100).toFixed(0)}%`);
  if (pass === 1) await new Promise((r) => setTimeout(r, 15000));
}
