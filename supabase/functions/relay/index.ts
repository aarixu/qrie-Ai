// @ts-nocheck — Deno, not the app's TypeScript project. See the note below.
//
// THE DEPLOYED RELAYS.
//
// Everything with a decision in it lives in packages/relay and is covered by
// the repo's own tests. This file is the Deno adapter: it reads the
// environment, builds the gate, and hands each request to the same
// `handleRelay` the vite dev server calls. That is the point — the dev relays
// and the deployed relays are one implementation, so what gets exercised every
// day is what faces the internet.
//
// Deploy:
//   supabase functions deploy relay --no-verify-jwt
//
// --no-verify-jwt is REQUIRED and is not a hole. The platform's own JWT check
// rejects a request before it reaches this code, and `/relay/speech` cannot
// carry an Authorization header at all — it is an <audio src>, which is why a
// class does not pause between lines. Auth is done here instead, for every
// route, by `admit`: a verified Supabase user or a signed ticket, then the
// per-minute and per-day meters. There is no unauthenticated path through
// handleRelay.
//
// Secrets it needs (supabase secrets set ...):
//   OPENROUTER_API_KEY   the one key the browser must never see
//   RELAY_TICKET_SECRET  any long random string; signs speech tickets
// Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY by itself.

import {
  cacheVerifier,
  createSupabaseVerifier,
} from '../../../packages/relay/src/auth.ts';
import { createSupabaseLedger } from '../../../packages/relay/src/gate.ts';
import { handleRelay } from '../../../packages/relay/src/handler.ts';
import { keepClass } from '../../../packages/relay/src/classStore.ts';
import { toRelayRequest, toResponse, transcribeViaFormData } from '../../../packages/relay/src/web.ts';

const env = (name: string): string => Deno.env.get(name) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const OPENROUTER_API_KEY = env('OPENROUTER_API_KEY');
const TICKET_SECRET = env('RELAY_TICKET_SECRET');

/**
 * The browser calls this from its own origin in production and from
 * localhost:5173 while somebody is working on it. Credentials are never sent
 * — the student's token rides in an Authorization header this list allows —
 * so a wildcard origin is honest here rather than lax.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400',
};

/**
 * Verified answers are remembered for half a minute. /relay/speech is called
 * once per SPOKEN LINE, and a round trip to the identity service before each
 * one would be most of a second of silence between sentences.
 */
const verify = cacheVerifier(createSupabaseVerifier(SUPABASE_URL, ANON_KEY));
const ledger = createSupabaseLedger(SUPABASE_URL, SERVICE_ROLE_KEY);

const deps = {
  key: OPENROUTER_API_KEY,
  gate: {
    verify,
    ledger,
    // Absent means speech accepts a header and nothing else, which closes it
    // to <audio src> rather than opening it to everyone. A missing secret must
    // never degrade to no check.
    ...(TICKET_SECRET ? { ticketSecret: TICKET_SECRET } : {}),
  },
  transcribe: (model: string, contentType: string, audio: Uint8Array) =>
    transcribeViaFormData(OPENROUTER_API_KEY, model, contentType, audio),
  /**
   * The files go to a public Storage bucket and the catalogue row to Postgres,
   * both with the service role key. That key never leaves this function — a
   * student's browser must not be able to add a row pointing every later
   * student at a lesson file of its choosing.
   */
  keep: (saved) => keepClass(saved, { supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY }),
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // A misconfigured function must say so plainly rather than fail as a 401
  // somewhere further in, which reads as "the student is not signed in".
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
    ['OPENROUTER_API_KEY', OPENROUTER_API_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    return new Response(
      JSON.stringify({ error: { message: `relay is missing: ${missing.join(', ')}` } }),
      { status: 503, headers: { 'content-type': 'application/json', ...CORS } },
    );
  }

  const out = await handleRelay(await toRelayRequest(request), deps);
  return toResponse(out, CORS);
});
