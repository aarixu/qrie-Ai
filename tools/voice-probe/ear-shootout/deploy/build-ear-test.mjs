// Builds the deployable ear-test page: phone.html with the three PUBLIC client settings filled in.
// They are read from the live site's own JavaScript (every visitor's browser already has them), so
// no secrets file is touched; the key itself is never printed.
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://qrie-ai.vercel.app';
const html = await (await fetch(`${SITE}/app/`)).text();
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => new URL(m[1], `${SITE}/app/`).href);
console.log('entry scripts:', scripts.length);

let found = null;
const queue = [...scripts];
const seen = new Set();
while (queue.length && !found) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  const js = await (await fetch(url)).text();
  const supa = js.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
  const relay = js.match(/https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/relay/);
  const jwts = [...js.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)].map((m) => m[0]);
  const anon = jwts.find((j) => {
    try {
      const p = JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString('utf8'));
      return p.role === 'anon';
    } catch {
      return false;
    }
  });
  if (supa && anon) found = { supabase: supa[0], relay: relay ? relay[0] : `${supa[0]}/functions/v1/relay`, anon, from: url };
  // follow the entry script's static imports one level, in case the config sits in a chunk
  if (!found) for (const m of js.matchAll(/["'](\.\/[A-Za-z0-9_.-]+\.js)["']/g)) queue.push(new URL(m[1], url).href);
  if (seen.size > 40) break;
}
if (!found) {
  console.log('NOT FOUND in the live bundle');
  process.exit(1);
}
const role = JSON.parse(Buffer.from(found.anon.split('.')[1], 'base64url').toString('utf8'));
console.log('found in:', found.from.split('/').pop());
console.log('supabase host:', new URL(found.supabase).host, '| relay path ok:', found.relay.endsWith('/functions/v1/relay'));
console.log('anon key role:', role.role, '| ref matches host:', role.ref === new URL(found.supabase).host.split('.')[0]);

const src = readFileSync(process.argv[2], 'utf8');
if (!src.includes('__RELAY__') || !src.includes('__SUPABASE__') || !src.includes('__ANON__')) throw new Error('placeholders missing');
writeFileSync(process.argv[3], src.replace('__RELAY__', found.relay).replace('__SUPABASE__', found.supabase).replace('__ANON__', found.anon));
console.log('wrote', process.argv[3]);
