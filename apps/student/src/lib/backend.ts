import { createClient } from '@supabase/supabase-js'
import {
  browserSession,
  demoBackend,
  friendlyError,
  isSignedOutError,
  supabaseBackend,
  type Backend,
} from '@ai-tutor/lms-client'
import { savedServer } from './server'

/**
 * Where the school's data comes from, chosen when the app is built.
 *
 *   - The hosted project, when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 *     are both set. Signing in goes through its lms-signin function.
 *     supabase-js keeps the session in this browser's localStorage under its
 *     own key, apart from the teacher app's. It is given neither lms-admin
 *     nor the relay: nothing in this app adds people, gives PINs or asks the
 *     AI, and here those calls refuse without reaching the network.
 *   - Otherwise the demo school (`npm run demo`, tools/lms-demo).
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// The demo school's address. In the phone app, one set on the sign-in screen
// comes first (lib/server.ts), then the one the app was built with.
export const DEMO_URL =
  savedServer() ?? import.meta.env.VITE_QRIE_DEMO_URL ?? 'http://127.0.0.1:54400'

function hosted(url: string, anonKey: string): Backend {
  const project = url.replace(/\/+$/, '')
  const client = createClient(project, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'qrie-school-auth',
    },
  })
  return supabaseBackend(client, { signInUrl: `${project}/functions/v1/lms-signin` })
}

export const backend: Backend =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? hosted(SUPABASE_URL, SUPABASE_ANON_KEY)
    : demoBackend(DEMO_URL, browserSession('qrie-student'))
export const api = backend.api

/** The server's words for a session it no longer accepts (packages/lms-client/src/errors.ts). */
export { isSignedOutError }

/** What to tell a child when a call fails (the school's own words, or one plain sentence). */
export function say(error: unknown): string {
  return friendlyError(error)
}
