// Is board-composer's "a picture is not text" relay fix (073f491) live? A 400 KB picture part is above
// the old 256 KB ceiling and far below the new 4 MB picture limit. Old relay: 413 from the relay itself.
// New relay: it gets past the size check and the (fake) picture is refused further in.
import { readFileSync } from 'node:fs';
const page = readFileSync(process.argv[2], 'utf8');
const cfg = (k) => new RegExp(`${k}:\\s*'([^']+)'`).exec(page)?.[1];
const supabase = cfg('supabase'), relay = cfg('relay'), anon = cfg('anon');

const signup = await fetch(`${supabase}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ data: {} }) });
const { access_token } = await signup.json();
console.log('anonymous sign-in:', signup.status);

const head = 'data:image/png;base64,';
const url = head + 'A'.repeat(400 * 1024 - head.length);
const body = {
  model: 'google/gemini-3.7-flash',
  max_tokens: 5,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'What is in this picture?' }, { type: 'image_url', image_url: { url } }] }],
};
const res = await fetch(`${relay}/api/llm`, { method: 'POST', headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const text = await res.text();
console.log('request bytes:', JSON.stringify(body).length);
console.log('HTTP', res.status, text.slice(0, 220));
