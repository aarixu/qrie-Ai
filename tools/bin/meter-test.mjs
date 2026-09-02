/**
 * DOES THE METER ACTUALLY METER?
 *
 * The budget is the thing standing between one leaked URL and an empty
 * OpenRouter balance, so "the SQL looks right" is not enough.
 *
 * The requests go out AT ONCE, deliberately. Sequentially, 130 round trips to
 * an Edge Function take longer than the minute window they are meant to fill,
 * the window rolls over, nothing is ever refused — and a working meter looks
 * exactly like a broken one. That is what the first version of this did, and
 * it cost an hour of looking for a bug that was not there.
 *
 * Run: node tools/bin/meter-test.mjs
 */
import fs from 'node:fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trimStart().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]));
const { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: ANON, VITE_RELAY_URL: RELAY } = env;
const show = (l, ok, d) => console.log(`${ok?'  OK   ':'  FAIL '} ${l}${d?` — ${d}`:''}`);

const s = await (await fetch(`${URL_}/auth/v1/signup`,{method:'POST',headers:{apikey:ANON,'content-type':'application/json'},body:'{}'})).json();
const auth = { apikey: ANON, authorization:`Bearer ${s.access_token}`, 'content-type':'application/json' };
const t = await (await fetch(`${RELAY}/api/ticket`,{method:'POST',headers:auth})).json();

// AT ONCE. Sequentially, 130 round trips take longer than the minute window
// they are meant to fill, so the window rolls over and nothing is ever
// refused — which looks exactly like a meter that does not work.
const results = await Promise.all(
  Array.from({ length: 150 }, () =>
    fetch(`${RELAY}/api/speech?text=hi&ticket=${encodeURIComponent(t.ticket)}`)
      .then(async (r) => ({ status: r.status, retry: r.headers.get('retry-after'),
                            reason: r.ok ? null : (await r.json().catch(() => ({})))?.error?.reason }))
      .catch(() => ({ status: 0, retry: null, reason: 'network' })),
  ),
);
const allowed = results.filter((r) => r.status === 200).length;
const limited = results.filter((r) => r.status === 429);

show('an ordinary class is never throttled', allowed >= 100, `${allowed} allowed`);
show('a runaway is stopped', limited.length > 0, `${limited.length} refused, reason "${limited[0]?.reason}"`);
show('with a wait a client can honour', Boolean(limited[0]?.retry), `Retry-After: ${limited[0]?.retry}s`);

const s2 = await (await fetch(`${URL_}/auth/v1/signup`,{method:'POST',headers:{apikey:ANON,'content-type':'application/json'},body:'{}'})).json();
const t2 = await (await fetch(`${RELAY}/api/ticket`,{method:'POST',headers:{apikey:ANON,authorization:`Bearer ${s2.access_token}`,'content-type':'application/json'}})).json();
const other = await fetch(`${RELAY}/api/speech?text=hi&ticket=${encodeURIComponent(t2.ticket)}`);
show('another student is metered separately', other.ok, `HTTP ${other.status}`);
