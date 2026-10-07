// @ts-nocheck — Deno, not the app's TypeScript project.
//
// BILLING-API: THE ONLY CALLER OF CASHFREE (tools/billing/src/api.ts).
//
// Everything with a decision in it lives in handleBillingApi and is covered
// by the repo's tests (tools/billing/tests/api.test.ts, over the real
// migrations, with Cashfree faked). This file is the Deno adapter: it reads
// the environment, builds the Cashfree client (tools/billing/src/cashfree.ts)
// and the two database callers (tools/billing/src/rest.ts), and answers the
// console's preflight. It has not yet run against a deployed project: deploy
// it, then make one sandbox link from the console.
//
// Deploy, after `supabase db push` has applied migrations 0056 to 0060:
//   supabase functions deploy billing-api --no-verify-jwt
// --no-verify-jwt because every route checks its caller itself: the staff
// routes in the database, through the caller's own token (admin.require_staff
// and the fresh-code check), and /reconcile with its own token.
//
// Reads SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// (Supabase supplies them), and the secrets Aarav sets (docs/ops/
// admin-console.md section 6): CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET,
// CASHFREE_ENV (sandbox or production), CASHFREE_API_VERSION, ADMIN_ORIGIN
// (the console's address, for CORS; the same secret admin-api reads) and,
// optionally, BILLING_RECONCILE_TOKEN (without it /reconcile answers 404).
// The console reaches it at <SUPABASE_URL>/functions/v1/billing-api/<route>;
// the outside checker at .../billing-api/reconcile, from a server, where CORS
// does not apply.

import { handleBillingApi } from '../../../tools/billing/src/api.ts';
import { cashfreeHttp } from '../../../tools/billing/src/cashfree.ts';
import { adminRpc } from '../../../tools/billing/src/rest.ts';

const env = (name: string): string => Deno.env.get(name) ?? '';
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ADMIN_ORIGIN = env('ADMIN_ORIGIN');
const CLIENT_ID = env('CASHFREE_CLIENT_ID');
const CLIENT_SECRET = env('CASHFREE_CLIENT_SECRET');
const CASHFREE_ENV = env('CASHFREE_ENV');
const API_VERSION = env('CASHFREE_API_VERSION');
const RECONCILE_TOKEN = env('BILLING_RECONCILE_TOKEN');

const CORS = {
  'access-control-allow-origin': ADMIN_ORIGIN,
  vary: 'origin',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
    ['ADMIN_ORIGIN', ADMIN_ORIGIN],
    ['CASHFREE_CLIENT_ID', CLIENT_ID],
    ['CASHFREE_CLIENT_SECRET', CLIENT_SECRET],
    ['CASHFREE_ENV', CASHFREE_ENV],
    ['CASHFREE_API_VERSION', API_VERSION],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) return json(503, { error: `billing-api is missing: ${missing.join(', ')}` });
  if (CASHFREE_ENV !== 'sandbox' && CASHFREE_ENV !== 'production') {
    return json(503, { error: 'billing-api: CASHFREE_ENV is sandbox or production' });
  }

  const cashfree = cashfreeHttp({ env: CASHFREE_ENV, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, apiVersion: API_VERSION });
  const asUser = adminRpc(SUPABASE_URL, ANON_KEY);
  const asService = adminRpc(SUPABASE_URL, SERVICE_ROLE_KEY);
  const body = await request.json().catch(() => null);
  const out = await handleBillingApi(
    {
      method: request.method,
      path: new URL(request.url).pathname,
      authorization: request.headers.get('authorization') ?? undefined,
      body,
    },
    {
      userRpc: (authorization, fn, args) => asUser(authorization, fn, args),
      serviceRpc: (fn, args) => asService(`Bearer ${SERVICE_ROLE_KEY}`, fn, args),
      cashfree,
      cashfreeEnv: CASHFREE_ENV,
      webhookUrl: `${SUPABASE_URL}/functions/v1/cashfree-webhook`,
      reconcileToken: RECONCILE_TOKEN,
    },
  );
  return json(out.status, out.body);
});
