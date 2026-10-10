import { readFileSync } from 'node:fs';
const page = readFileSync(process.argv[2], 'utf8');
const cfg = (k) => new RegExp(`${k}:\\s*'([^']+)'`).exec(page)?.[1];
const supabase = cfg('supabase'), relay = cfg('relay'), anon = cfg('anon');
const su = await fetch(`${supabase}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ data: {} }) });
const { access_token } = await su.json();
const wav = (secs) => { const pcm = Buffer.alloc(Math.floor(16000*secs)*2); const h = Buffer.alloc(44); h.write('RIFF',0); h.writeUInt32LE(36+pcm.length,4); h.write('WAVE',8); h.write('fmt ',12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(1,22); h.writeUInt32LE(16000,24); h.writeUInt32LE(32000,28); h.writeUInt16LE(2,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(pcm.length,40); return Buffer.concat([h,pcm]); };
let words = 0;
for (let i = 0; i < 8; i++) {
  const secs = [2, 3, 1.5, 2.5][i % 4];
  const res = await fetch(`${relay}/api/hear`, { method: 'POST', headers: { authorization: `Bearer ${access_token}`, 'content-type': 'audio/wav' }, body: wav(secs) });
  const j = await res.json();
  if (j.text) words++;
  console.log(`silence ${secs} s -> HTTP ${res.status} ${JSON.stringify(j.text)}`);
}
console.log(`silence answered with words: ${words}/8`);
