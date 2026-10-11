// @ts-nocheck — Deno, not the app's TypeScript project.
//
// THE HOSTED SIGN-IN'S GUARD: a school ID and PIN in; for the right PIN of an
// open account, its Supabase Auth password out (tools/lms-import/src/signIn.ts).
// supabaseBackend (packages/lms-client) calls it first, at its signInUrl, and
// only then signs in to Supabase Auth with what it sends back.
//
// Everything with a decision in it lives in signIn.ts — serveSignIn reads the
// body and the caller's key and answers with handleSignIn's verdict — and is
// covered by the repo's tests (tools/lms-import/tests/signIn.test.ts, over the
// real migrations). This file is the Deno adapter: it reads the environment,
// answers OPTIONS and a missing setup, and hands every other request to
// serveSignIn with the service role's calls to 0076's guard functions. It has
// not yet run against a deployed project.
//
// Deploy, after `supabase db push` has applied migration 0076:
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
// The per-address limit counts each try under callerKey: the address in
// cf-connecting-ip, which Cloudflare sets, or, without one, the whole
// x-forwarded-for chain, never its first entry alone, which the caller
// writes; IPv6 by its /64. So naming someone else's address in
// x-forwarded-for spends a budget of the caller's own, not theirs. Which of
// the two headers carries the caller's real address on the deployed project,
// and whether a caller can set cf-connecting-ip themselves, has not been
// checked; the security review's finding 1 says how to check it at the
// staging rehearsal. If a caller can set cf-connecting-ip, they can name any
// address there, someone else's included. A request with neither header
// holding an address is not held to the per-address limit; the per-ID
// lockout, which does not depend on the address, holds whatever the headers.
//
// serveSignIn reads a body only until it passes MAX_BODY bytes, inside a
// try, so a long or broken one gets 413 or 400 with this function's headers.

import { serveSignIn, SIGN_IN_HEADERS } from '../../../tools/lms-import/src/signIn.ts';
import { pepperProblem } from '../../../tools/lms-import/src/pinGuard.ts';
import { lmsRpc, supabaseRest } from '../../../tools/lms-import/src/supabaseStore.ts';

const env = (name: string): string => Deno.env.get(name) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const PEPPER = env('LMS_PIN_PEPPER');

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: SIGN_IN_HEADERS });

const rpc = lmsRpc(supabaseRest(SUPABASE_URL, SERVICE_ROLE_KEY));

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: SIGN_IN_HEADERS });
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

  return serveSignIn(request, { rpc, pepper: PEPPER });
});
