import { browserSession, demoBackend } from '@ai-tutor/lms-client'

/**
 * The one door to the school's data. Today it is the demo school
 * (`npm run demo`, tools/lms-demo); the hosted project's supabaseBackend
 * joins once `lms` is live there (final plan, LMS "Waiting on Aarav").
 */
export const DEMO_URL =
  import.meta.env.VITE_QRIE_DEMO_URL ?? 'http://127.0.0.1:54400'

export const backend = demoBackend(DEMO_URL, browserSession('qrie-lms-teacher'))
export const api = backend.api

/** The server's words for a session it no longer accepts. */
export function isSignedOutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /sign in again|jwt expired|invalid jwt/i.test(error.message)
  )
}
