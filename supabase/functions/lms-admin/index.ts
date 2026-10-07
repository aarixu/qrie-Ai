// @ts-nocheck — Deno, not the app's TypeScript project.
//
// THE HOSTED SCHOOL PORTAL'S ADMIN CALLS: adding people from the sheets, a
// new PIN, a parent's sign-in (tools/lms-import/src/admin.ts).
//
// Everything with a decision in it lives in handleAdmin and is covered by the
// repo's tests (tools/lms-import/tests/admin.test.ts, over the real
// migrations). This file is the Deno adapter: it reads the environment and
// hands each request to handleAdmin with the project's real services — the
// identity check (packages/relay createSupabaseVerifier), the service role's
// REST calls (tools/lms-import supabaseRest / supabaseStore), and the auth
// admin API for a new password. It has not yet run against a deployed
// project: deploy it, then try each call once from the portal.
//
// Deploy, after `supabase db push` has applied migration 0046:
//   supabase functions deploy lms-admin --no-verify-jwt
// --no-verify-jwt as for the relay: handleAdmin checks the caller's token on
// every call and refuses anyone but their school's admin.
//
// Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY by itself. The apps reach it at
// <SUPABASE_URL>/functions/v1/lms-admin (supabaseBackend's adminUrl).

import { createSupabaseVerifier } from '../../../packages/relay/src/auth.ts';
import { handleAdmin } from '../../../tools/lms-import/src/admin.ts';
import { supabaseRest, supabaseStore } from '../../../tools/lms-import/src/supabaseStore.ts';

const env = (name: string): string => Deno.env.get(name) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

const rest = supabaseRest(SUPABASE_URL, SERVICE_ROLE_KEY);
const deps = {
  verify: createSupabaseVerifier(SUPABASE_URL, ANON_KEY),
  // 0046's functions answer one JSON value each.
  rpc: (fn: string, args: Record<string, unknown>) => rest(`/rest/v1/rpc/${fn}`, { method: 'POST', profile: 'lms', body: args }),
  store: supabaseStore(SUPABASE_URL, SERVICE_ROLE_KEY),
  auth: {
    async setPassword(userId: string, password: string) {
      await rest(`/auth/v1/admin/users/${userId}`, { method: 'PUT', body: { password } });
    },
  },
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    return new Response(JSON.stringify({ error: `lms-admin is missing: ${missing.join(', ')}` }), {
      status: 503,
      headers: { 'content-type': 'application/json', ...CORS },
    });
  }
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const out = await handleAdmin(
    {
      method: request.method,
      path: new URL(request.url).pathname,
      authorization: request.headers.get('authorization') ?? undefined,
      body,
    },
    deps,
  );
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json', ...CORS } });
});
