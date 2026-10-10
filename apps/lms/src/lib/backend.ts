import { createClient } from '@supabase/supabase-js'
import {
  browserSession,
  demoBackend,
  forgetStoredSession,
  isSignedOutError,
  supabaseBackend,
  type Backend,
} from '@ai-tutor/lms-client'
import { savedServer } from './server'

/**
 * The one door to the school's data, chosen when the app is built.
 *
 *   - The hosted project, when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 *     are both set. Signing in goes through its lms-signin function; the
 *     admin's import, New PIN and Add parent through lms-admin; Draft with AI
 *     through the relay at VITE_QRIE_RELAY_URL, and is off when that is not
 *     set. supabase-js keeps the session in this browser's localStorage
 *     under its own key, apart from the student app's.
 *   - Otherwise the demo school (`npm run demo`, tools/lms-demo).
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// The demo school's address. In the phone app, one set on the sign-in screen
// comes first (lib/server.ts).
export const DEMO_URL =
  savedServer() ?? import.meta.env.VITE_QRIE_DEMO_URL ?? 'http://127.0.0.1:54400'

const SESSION_KEY = 'qrie-teacher-auth'

function hosted(url: string, anonKey: string): Backend {
  const project = url.replace(/\/+$/, '')
  const client = createClient(project, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: SESSION_KEY,
    },
  })
  return supabaseBackend(client, {
    signInUrl: `${project}/functions/v1/lms-signin`,
    adminUrl: `${project}/functions/v1/lms-admin`,
    relayUrl: import.meta.env.VITE_QRIE_RELAY_URL,
    // Signing out leaves nothing of the session on a shared computer, even
    // when supabase-js could not finish signing out.
    forgetSession: () => forgetStoredSession(SESSION_KEY),
  })
}

export const backend: Backend =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? hosted(SUPABASE_URL, SUPABASE_ANON_KEY)
    : demoBackend(DEMO_URL, browserSession('qrie-lms-teacher'))
export const api = backend.api

/** The server's words for a session it no longer accepts (packages/lms-client/src/errors.ts). */
export { isSignedOutError }
