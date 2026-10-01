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
//   npm run relay:deploy
//
// MIGRATIONS FIRST, AND THAT SCRIPT IS WHY IT SAYS THAT RATHER THAN THE BARE
// `supabase functions deploy relay --no-verify-jwt`. This function now calls
// record_usage with p_prep_id, which does not exist before migration 0019,
// and the three route families below call keep_student_report, claim_otp_send
// and extend_prep_lock, which do not exist before it either. A function
// deployed ahead of its migrations answers PGRST202 to usage rows and the
// sink swallows it, so spend carries on with nothing written down at all.
// `npm run relay:deploy` runs `supabase db push` before the deploy, in that
// order, which is the whole reason it exists.
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
//   OPENROUTER_API_KEY   needed only where GOOGLE_SERVICE_ACCOUNT_JSON is
//                        absent. With a service account set — working or
//                        not — the relay never hands this key to the
//                        handler (packages/relay/src/vendors.ts), so it is
//                        not required and not used.
//   RELAY_TICKET_SECRET  any long random string; signs speech tickets
//   GOOGLE_SERVICE_ACCOUNT_JSON
//                        the whole service account key file, as one string.
//                        Present: thinking (/api/llm), her voice
//                        (/api/speech) and her hearing (/api/hear) all go to
//                        Vertex on Google Cloud credits, and if it is present
//                        but unusable those three answer 503 rather than
//                        fall back to OpenRouter. Absent: OpenRouter serves
//                        them, as on a laptop. Set it with
//                          supabase secrets set --env-file <(printf 'GOOGLE_SERVICE_ACCOUNT_JSON=%s' "$(cat key.json)")
//                        rather than on a command line, where the private key
//                        would land in shell history.
// Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY by itself.

import {
  cacheVerifier,
  createSupabaseVerifier,
} from '../../../packages/relay/src/auth.ts';
import { createSupabaseLedger } from '../../../packages/relay/src/gate.ts';
import { createSupabaseUsage } from '../../../packages/relay/src/usage.ts';
import { handleRelay, type HandlerDeps } from '../../../packages/relay/src/handler.ts';
import { keepClass } from '../../../packages/relay/src/classStore.ts';
import { createSupabaseReportStore } from '../../../packages/relay/src/report.ts';
import { createSupabasePrepLocks } from '../../../packages/relay/src/prep.ts';
import {
  createSupabaseConsentStore,
  createSupabaseOtpGate,
} from '../../../packages/relay/src/enroll.ts';
import { modelVendors } from '../../../packages/relay/src/vendors.ts';
import { toRelayRequest, toResponse, transcribeViaFormData } from '../../../packages/relay/src/web.ts';

const env = (name: string): string => Deno.env.get(name) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const OPENROUTER_API_KEY = env('OPENROUTER_API_KEY');
const TICKET_SECRET = env('RELAY_TICKET_SECRET');
const SERVICE_ACCOUNT_JSON = env('GOOGLE_SERVICE_ACCOUNT_JSON');

/**
 * GOOGLE CLOUD, WHEN THERE IS A KEY FOR IT — AND NO QUIET WAY BACK.
 *
 * Built ONCE, at module scope, because the token it mints is cached inside it:
 * rebuilding per request would sign a fresh RSA assertion and make a round
 * trip to Google on every single model call.
 *
 * A bad key still does not take the whole function down: reports, class
 * keeping and enrolment have nothing to do with Google. But it no longer
 * falls back to OpenRouter either. It used to, which sent thinking, her voice
 * and a child's spoken answers to the vendors /privacy says are no longer
 * used, on nothing more than a typo in a secret. With a service account set,
 * `vendors.openRouterKey` is '', so those three routes answer 503 until the
 * key is fixed. CURIE_SPEECH_URL (our own voice box) is used only when no
 * service account is set at all: with Vertex configured every line is Gemini
 * on Vertex, because the box speaks English only. See
 * packages/relay/src/handler.ts `speechUrl` and vendors.ts.
 */
const vendors = modelVendors({ serviceAccountJson: SERVICE_ACCOUNT_JSON, openRouterKey: OPENROUTER_API_KEY });
if (vendors.unusable) {
  console.error(
    'GOOGLE_SERVICE_ACCOUNT_JSON is set but unusable; /api/llm, /api/speech and /api/hear answer 503 until it is fixed:',
    vendors.unusable,
  );
}
const vertex = vendors.vertex;

/**
 * The browser calls this from its own origin in production and from
 * localhost:5173 while somebody is working on it. Credentials are never sent
 * — the student's token rides in an Authorization header this list allows —
 * so a wildcard origin is honest here rather than lax.
 */
const CORS = {
  'access-control-allow-origin': '*',
  // x-session-id: which learning session a call belongs to, for the usage
  // record (0008). A header the browser is not told about here is a header the
  // preflight refuses - and then EVERY relay call from the web app fails, not
  // just the accounting. Adding a header to the app means adding it here.
  // x-prep-id: which preparation run a call served (0018's prep_id column),
  // added for exactly that rule.
  'access-control-allow-headers': 'authorization, content-type, x-session-id, x-prep-id',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400',
  // Where a call's time went (handler.ts `serverTiming`): readable by the app
  // for its latency numbers, which a cross-origin response hides unless told.
  'access-control-expose-headers': 'server-timing',
  'timing-allow-origin': '*',
};

/**
 * Verified answers are remembered for half a minute. /relay/speech is called
 * once per SPOKEN LINE, and a round trip to the identity service before each
 * one would be most of a second of silence between sentences.
 */
/**
 * WHO IS ASKING: Supabase is asked over the network (auth.ts
 * createSupabaseVerifier), which also refuses a session that has signed out.
 * createJwksVerifier (the signature checked here) was tried on 2026-10-01 and
 * measured: the check itself fell to 1-4 ms, but nearly every call lands on a
 * fresh isolate and the meter's claim then paid the connection to Supabase
 * that the identity call used to pay. Identity plus meter: median about 91 ms
 * against about 125 ms. 10-35 ms saved, for tokens that would outlive sign-out
 * by up to an hour — so it is not used here.
 */
const verify = cacheVerifier(createSupabaseVerifier(SUPABASE_URL, ANON_KEY));
const ledger = createSupabaseLedger(SUPABASE_URL, SERVICE_ROLE_KEY);
// What each call cost, in the units the provider bills. Same door as the
// meter: the service role, through a definer function, so a student holding
// the anon key cannot write their own usage.
const usage = createSupabaseUsage(SUPABASE_URL, SERVICE_ROLE_KEY);

/**
 * Typed against HandlerDeps deliberately.
 *
 * This file is outside tsconfig's include — it is Deno, not the app's project
 * — so nothing here is checked on `npm run typecheck`. The annotation is what
 * makes the Supabase CLI's own type check catch a drift between this adapter
 * and the router it feeds, instead of a 500 in production.
 */
const deps: HandlerDeps = {
  key: vendors.openRouterKey,
  /**
   * The switch. `supabase secrets set RELAY_DISABLED=1` and every relay answers
   * 503 within a restart — no deploy, no migration, no table edited by hand.
   * Anything but the empty string is on, because the mistake to avoid at two in
   * the morning is typing `true` and having it read as false.
   */
  ...(Deno.env.get('RELAY_DISABLED') ? { disabled: true } : {}),
  /**
   * Her voice, from our own box — used ONLY when no Vertex service account
   * is set (packages/relay/src/handler.ts `speechUrl`). With Vertex, every
   * line is Gemini on Vertex and this is ignored: the box's Piper voices are
   * Hindi ones with no Indian English voice, and cannot speak the Hinglish or
   * Indian English the tutor speaks. It stays the cost lever for the day it
   * can; it must be reachable from the edge, so a laptop will not do.
   */
  ...(Deno.env.get('CURIE_SPEECH_URL') ? { speechUrl: Deno.env.get('CURIE_SPEECH_URL') } : {}),
  ...(vertex ? { vertex } : {}),
  gate: {
    verify,
    ledger,
    // Absent means speech accepts a header and nothing else, which closes it
    // to <audio src> rather than opening it to everyone. A missing secret must
    // never degrade to no check.
    ...(TICKET_SECRET ? { ticketSecret: TICKET_SECRET } : {}),
  },
  transcribe: (call) => transcribeViaFormData(vendors.openRouterKey, call),
  usage,
  /**
   * The files go to a public Storage bucket and the catalogue row to Postgres,
   * both with the service role key. That key never leaves this function — a
   * student's browser must not be able to add a row pointing every later
   * student at a lesson file of its choosing.
   */
  keep: (saved) =>
    keepClass(saved, { supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY }),
  /**
   * A child's report, kept exactly once through keep_student_report (0019)
   * and alerted onward. OPS_ALERT_WEBHOOK optional: set, a kept report POSTs
   * {kind, lessonId, at, reportId} there — metadata only, never the child's
   * words; unset, one log line in this function's own stream says the same.
   */
  reports: createSupabaseReportStore(SUPABASE_URL, SERVICE_ROLE_KEY),
  ...(Deno.env.get('OPS_ALERT_WEBHOOK')
    ? { opsAlertWebhook: Deno.env.get('OPS_ALERT_WEBHOOK') }
    : {}),
  /**
   * The prep lock (0017), finally called. The org the definer function
   * wants is resolved from the caller's membership inside the store, with
   * the same earliest-created_at tie-break fill_org_id uses.
   */
  prepLocks: createSupabasePrepLocks(SUPABASE_URL, SERVICE_ROLE_KEY),
  /**
   * NO `otp` HERE, AND THAT IS THE POINT. Both enrolment routes answer 501
   * on the deployed host until a real SMS vendor exists.
   *
   * The dev provider was wired here and it could not work: its codes live
   * in a per-isolate Map, Edge Functions run many short-lived isolates —
   * the exact argument createSupabaseOtpGate makes three lines below for
   * why the SEND counter had to go to Postgres — so a verify routinely
   * lands on an instance that never saw the send. The parent is then told
   * their correct code is wrong, while claim_otp_send has already counted
   * the send, so retrying burns the 3-per-10-minutes and then the daily
   * cap. And even on one isolate the code only ever reaches THIS FUNCTION'S
   * LOG STREAM; no parent can read it. A route that cannot succeed should
   * say 501, not lie to a parent about the digits they just typed.
   *
   * ONE LINE TURNS IT ON: `otp: createMsg91Otp(env('MSG91_KEY'))` — or
   * whichever vendor — behind the OtpProvider seam, with the key set as a
   * function secret, never anywhere a browser can reach. The gate and the
   * consent store below are already wired and waiting for it.
   *
   * The dev server keeps createDevOtpProvider: one process, one Map, and a
   * developer who can read their own terminal.
   */
  // SMS is money and identities are free: the count lives in Postgres
  // (claim_otp_send, 0019), per phone AND per user, because instances of
  // this function are many and short-lived and a Map in one is no meter.
  otpGate: createSupabaseOtpGate(SUPABASE_URL, SERVICE_ROLE_KEY),
  // The DPDP verifiable-parental-consent row (0019), service role only.
  consent: createSupabaseConsentStore(SUPABASE_URL, SERVICE_ROLE_KEY),
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // A misconfigured function must say so plainly rather than fail as a 401
  // somewhere further in, which reads as "the student is not signed in".
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
    // Required only where it can be used: with a service account set the
    // handler is never given it (see `vendors` above).
    ...(SERVICE_ACCOUNT_JSON ? [] : [['OPENROUTER_API_KEY', OPENROUTER_API_KEY]]),
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
