/**
 * ONE WHOLE CLASS'S WORTH OF BACKEND, AS A REAL STUDENT.
 *
 * Signs in the way a phone with no account does, mints a speech ticket, asks a
 * model a question and fetches a line of her voice — every step a student
 * takes before they hear a word. It also checks that a forged ticket is
 * refused, because a gate nobody tries is a gate nobody has tried.
 *
 * It found the speech relay returning 400 on its own default: OpenRouter now
 * demands an explicit voice for aura-2, and the relay named none.
 *
 * Run: node tools/bin/live-test.mjs
 */
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: ANON, VITE_RELAY_URL: RELAY } = env;
const show = (label, ok, detail) => console.log(`${ok ? '  OK   ' : '  FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);

// Become a student exactly as the app does: an anonymous account, no email.
const signup = await fetch(`${URL_}/auth/v1/signup`, {
  method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: '{}',
});
const session = await signup.json();
const token = session.access_token;
show('a phone with no account gets an identity', Boolean(token));
if (!token) process.exit(1);

const auth = { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' };

// The meter must accept this student and refuse a stranger.
const ticket = await fetch(`${RELAY}/api/ticket`, { method: 'POST', headers: auth });
const ticketBody = await ticket.json();
show('speech ticket minted for a verified student', ticket.ok && typeof ticketBody.ticket === 'string',
     `HTTP ${ticket.status}`);

// The one that costs money: a real model call through the relay.
const llm = await fetch(`${RELAY}/api/llm`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    model: 'google/gemini-3-flash-preview',
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 10,
  }),
});
const llmBody = await llm.json().catch(() => ({}));
const said = llmBody?.choices?.[0]?.message?.content ?? JSON.stringify(llmBody).slice(0, 120);
show('a model answers through the relay, with no key in the browser', llm.ok && !llmBody.error, said);

// And the speech ticket really opens the voice, the way an <audio> element does.
if (typeof ticketBody.ticket === 'string') {
  const speech = await fetch(`${RELAY}/api/speech?text=Hello&ticket=${encodeURIComponent(ticketBody.ticket)}`);
  show('her voice streams from a ticketed URL', speech.ok,
       `HTTP ${speech.status} ${speech.headers.get('content-type')}`);

  const forged = await fetch(`${RELAY}/api/speech?text=Hello&ticket=made.up.value`);
  show('a forged ticket is refused', forged.status === 401, `HTTP ${forged.status}`);
}
