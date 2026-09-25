import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * THE LANDING PAGE'S HALF OF ONE IDENTITY.
 *
 * The contest form is the first door in the funnel and the webapp is the
 * second, and `contest_signup.user_id` references `auth.users` — so the entry
 * a parent fills in here and the learning the student does there are the same
 * person only if both sides sign in as the same anonymous user.
 *
 * That is why this file exists rather than a plain POST to a table: it mints
 * the identity, and the webapp served from /app on this same origin finds the
 * session already in storage and adopts it instead of minting a second one.
 * DIFFERENT ORIGINS DO NOT SHARE IT. A session lives in localStorage, which is
 * per-origin, so the moment the two halves sit on different hostnames the join
 * is silently broken and nobody finds out until somebody tries to ring a
 * winner.
 *
 * Both values are PUBLIC. The anon key is a published identifier; what may be
 * read or written is decided by row-level security, and `contest_signup` has
 * RLS on with zero policies — a browser holding this key cannot touch it. The
 * insert happens in app/api/contest-signup/route.ts under the service role,
 * which never comes near here.
 */
const URL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_ENV = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let client: SupabaseClient | null = null

/** Null when the project is not configured, so a page can say so honestly. */
export function supabase(): SupabaseClient | null {
  if (!URL_ENV || !ANON_ENV) return null
  client ??= createClient(URL_ENV, ANON_ENV, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  return client
}

export const cloudConfigured = (): boolean => supabase() !== null

/**
 * ONE anonymous user per browser, however many callers ask at once.
 *
 * The webapp learned this the expensive way (apps/classroom/src/lib/relay.ts):
 * several calls on a fresh device each found no session, each asked for an
 * account of its own, and one student became several users — of which only one
 * was kept and the rest became orphaned rows. A form has fewer callers than a
 * class, but a double-clicked submit is two callers, and that is enough.
 */
let signingIn: Promise<string | null> | null = null

async function startAnonymousSession(): Promise<string | null> {
  const db = supabase()
  if (!db) return null
  const { data, error } = await db.auth.signInAnonymously()
  if (error) {
    console.error('[curie] could not start an anonymous session:', error.message)
    return null
  }
  return data.session?.access_token ?? null
}

/**
 * The access token to call our own API with, signing in first if needed.
 *
 * Returns null rather than throwing when there is no project configured or the
 * sign-in fails — the caller shows a real failure to the person at the form,
 * which is the whole point of not pretending anything was saved.
 */
export async function accessToken(): Promise<string | null> {
  const db = supabase()
  if (!db) return null

  const { data } = await db.auth.getSession()
  if (data.session?.access_token) return data.session.access_token

  // Failing once must not pin this browser to "no identity" for good: the
  // next submit gets a fresh attempt.
  signingIn ??= startAnonymousSession().finally(() => {
    signingIn = null
  })
  return signingIn
}
