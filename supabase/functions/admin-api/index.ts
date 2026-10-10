// @ts-nocheck — Deno, not the app's TypeScript project.
//
// THE STAFF CONSOLE'S SERVICE (tools/admin-api/src/handle.ts), as a Supabase
// Edge Function. Everything with a decision in it is in handleAdminApi and is
// covered by tools/admin-api/tests/handle.test.ts over the real migrations.
// This file reads the environment and hands each request over with the real
// services: the caller's own PostgREST calls (their token, the admin schema),
// the service role's REST calls (tools/lms-import supabaseRest/supabaseStore)
// and the auth admin API. It has not run against a deployed project.
//
// Routes: import, reset-pin, staff-invite, user-block (plan 2), and plan 5's
// class-remove and erase (tools/admin-api/src/privacy.ts), which delete files
// through the Storage API with the service role and then call
// admin.class_files_removed or admin.erasure_complete with it.
//
// Deploy after `supabase db push` has applied 0052 to 0055 (and 0065 to 0069
// for plan 5's two routes):
//   supabase functions deploy admin-api --no-verify-jwt
//   supabase secrets set ADMIN_ORIGIN=https://<the console's own address>
// --no-verify-jwt as for lms-admin: the database checks every call as the
// caller. Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY itself. The console reaches it at
// <SUPABASE_URL>/functions/v1/admin-api.

import { CallerError, CALLER_FUNCTIONS, handleAdminApi } from '../../../tools/admin-api/src/handle.ts';
import { Refused } from '../../../tools/lms-import/src/admin.ts';
import { supabaseRest, supabaseStore } from '../../../tools/lms-import/src/supabaseStore.ts';

const env = (name) => Deno.env.get(name) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ADMIN_ORIGIN = env('ADMIN_ORIGIN');

const CORS = {
  'access-control-allow-origin': ADMIN_ORIGIN,
  vary: 'origin',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

const rest = supabaseRest(SUPABASE_URL, SERVICE_ROLE_KEY);
const SERVICE_FUNCTIONS = ['class_files_removed', 'erasure_complete'];

const deps = {
  async asCaller(authorization, fn, args) {
    if (!CALLER_FUNCTIONS.includes(fn)) throw new Error(`not a caller function: ${fn}`);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, authorization, 'content-type': 'application/json', 'content-profile': 'admin' },
      body: JSON.stringify(args),
    });
    const body = await res.text();
    if (!res.ok) {
      let e = {};
      try { e = JSON.parse(body); } catch { /* not JSON */ }
      throw new CallerError(String(e.message ?? `the database answered ${res.status}`), String(e.code ?? `HTTP${res.status}`));
    }
    return body ? JSON.parse(body) : null;
  },
  lms: {
    rpc: (fn, args) => rest(`/rest/v1/rpc/${fn}`, { method: 'POST', profile: 'lms', body: args }),
    store: supabaseStore(SUPABASE_URL, SERVICE_ROLE_KEY),
    auth: {
      async setPassword(userId, password) {
        await rest(`/auth/v1/admin/users/${userId}`, { method: 'PUT', body: { password } });
      },
    },
  },
  authAdmin: {
    async createStaffUser(email, password) {
      let user;
      try {
        user = await rest('/auth/v1/admin/users', {
          method: 'POST',
          body: { email, password, email_confirm: true, app_metadata: { provisioned_by: 'staff' } },
        });
      } catch (e) {
        if (/ 422 /.test(String(e?.message))) throw new Refused(409, 'An account with that email already exists.');
        throw e;
      }
      if (typeof user?.id !== 'string') throw new Error('the auth service made the account but returned no id');
      return user.id;
    },
    async setBanned(userId, banned) {
      await rest(`/auth/v1/admin/users/${userId}`, { method: 'PUT', body: { ban_duration: banned ? '876000h' : 'none' } });
    },
  },
  files: {
    // The Storage API's bulk delete, as supabase-js's remove() sends it; it
    // answers the objects it deleted (UNVERIFIED against a deployed project).
    async remove(bucket, names) {
      if (names.length === 0) return 0;
      const out = await rest(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: { prefixes: names } });
      return Array.isArray(out) ? out.length : 0;
    },
  },
  serviceAdmin(fn, args) {
    if (!SERVICE_FUNCTIONS.includes(fn)) throw new Error(`not a service function: ${fn}`);
    return rest(`/rest/v1/rpc/${fn}`, { method: 'POST', profile: 'admin', body: args });
  },
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
    ['ADMIN_ORIGIN', ADMIN_ORIGIN],
  ].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length > 0) {
    return new Response(JSON.stringify({ error: `admin-api is missing: ${missing.join(', ')}`, code: 'other' }), {
      status: 503, headers: { 'content-type': 'application/json', ...CORS },
    });
  }
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const out = await handleAdminApi(
    { method: request.method, path: new URL(request.url).pathname, authorization: request.headers.get('authorization') ?? undefined, body },
    deps,
  );
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json', ...CORS } });
});
