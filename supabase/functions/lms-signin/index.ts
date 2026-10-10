// @ts-nocheck — Deno, not the app's TypeScript project.
//
// THE HOSTED SIGN-IN'S GUARD: a school ID and PIN in; for the right PIN of an
// open account, its Supabase Auth password out (tools/lms-import/src/signIn.ts).
// supabaseBackend (packages/lms-client) calls it first, at its signInUrl, and
// only then signs in to Supabase Auth with what it sends back.
//
// Everything with a decision in it lives in handleSignIn and is covered by the
// repo's tests (tools/lms-import/tests/signIn.test.ts, over the real
// migrations). This file is the Deno adapter: it reads the environment, the
// body and the caller's address, and hands them to handleSignIn with the
// service role's calls to 0046's guard functions. It has not yet run against
// a deployed project.
//
// Deploy, after `supabase db push` has applied migration 0046:
//   npx supabase secrets set LMS_PIN_PEPPER=<at least 32 random characters>
//   npx supabase functions deploy lms-signin --no-verify-jwt
// --no-verify-jwt because whoever is signing in has no token yet.
// A project's secrets reach all of its functions, so lms-admin gets the same
// LMS_PIN_PEPPER; whoever runs the import CLI's --apply needs it too. Keep it
// out of the repo. Changing it later makes every PIN stop working until each
// person is given a new one.
//
// Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY by itself. The
// apps reach this at <SUPABASE_URL>/functions/v1/lms-signin.
//
// The caller's address is the first in x-forwarded-for (clientIp). Whether
// Supabase's gateway lets a caller choose that first address has not been
// checked; if it does, the per-address limit can be dodged by naming a new
// address each time, while the per-ID lockout, which does not depend on the
// address, still holds. A request without a usable address is not held to
// the per-address limit at all.

import { handleSignIn, clientIp, MAX_BODY } from '../../../tools/lms-import/src/signIn.ts';
import { pepperProblem } from '../../../tools/lms-import/src/pinGuard.ts';
import { lmsRpc, supabaseRest } from '../../../tools/lms-import/src/supabaseStore.ts';

const env = (name: string): string => Deno.env.get(name) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const PEPPER = env('LMS_PIN_PEPPER');

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });

const rpc = lmsRpc(supabaseRest(SUPABASE_URL, SERVICE_ROLE_KEY));

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
    ['LMS_PIN_PEPPER', PEPPER],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) return answer(503, { error: `lms-signin is missing: ${missing.join(', ')}` });
  const weak = pepperProblem(PEPPER);
  if (weak) return answer(503, { error: `lms-signin: ${weak}` });

  // A body whose declared length is over the limit is refused unread; one
  // without a declared length is read, and handleSignIn refuses it if long.
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY) {
    return answer(413, { error: 'That request is too large.' });
  }
  const body = request.method === 'POST' ? await request.text() : '';
  const out = await handleSignIn(
    { method: request.method, body, ip: clientIp(request.headers.get('x-forwarded-for')) },
    { rpc, pepper: PEPPER },
  );
  return answer(out.status, out.body);
});
