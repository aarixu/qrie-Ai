// @ts-nocheck — Deno, not the app's TypeScript project.
//
// CASHFREE'S WEBHOOK: payment-link and refund events, POSTed by Cashfree
// (tools/billing/src/webhook.ts).
//
// Everything with a decision in it lives in handleWebhook and is covered by
// the repo's tests (tools/billing/tests/webhook.test.ts, over the real
// migrations). This file is the Deno adapter: it reads the environment, hands
// the raw body and the headers to handleWebhook, and calls the database with
// the service role through PostgREST (tools/billing/src/rest.ts). It has not
// yet run against a deployed project: deploy it, then send one sandbox event.
//
// Deploy, after `supabase db push` has applied migrations 0057 to 0060:
//   supabase functions deploy cashfree-webhook --no-verify-jwt
// --no-verify-jwt because Cashfree sends no Supabase JWT; the first thing
// handleWebhook does with a body is check Cashfree's signature on its raw
// bytes.
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase supplies both)
// and CASHFREE_CLIENT_SECRET (a secret Aarav sets; docs/ops/admin-console.md
// section 6). Cashfree reaches it at <SUPABASE_URL>/functions/v1/cashfree-webhook.

import { adminRpc } from '../../../tools/billing/src/rest.ts';
import { handleWebhook, MAX_BODY_BYTES } from '../../../tools/billing/src/webhook.ts';

const env = (name: string): string => Deno.env.get(name) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const CLIENT_SECRET = env('CASHFREE_CLIENT_SECRET');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (request: Request) => {
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
    ['CASHFREE_CLIENT_SECRET', CLIENT_SECRET],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) return json(503, { error: `cashfree-webhook is missing: ${missing.join(', ')}` });

  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  // A body that says it is too large is refused before it is read.
  if (Number(headers['content-length'] ?? 0) > MAX_BODY_BYTES) return json(413, { error: 'too large' });
  const body = new Uint8Array(await request.arrayBuffer());
  const call = adminRpc(SUPABASE_URL, SERVICE_ROLE_KEY);
  const out = await handleWebhook(
    { method: request.method, headers, body },
    { secret: CLIENT_SECRET, rpc: (fn, args) => call(`Bearer ${SERVICE_ROLE_KEY}`, fn, args) },
  );
  return json(out.status, out.body);
});
