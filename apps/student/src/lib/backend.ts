import { browserSession, demoBackend, friendlyError } from '@ai-tutor/lms-client'
import { savedServer } from './server'

/**
 * The demo school today (`npm run demo`); the hosted project once `lms` is
 * live there. In the phone app, an address set on the sign-in screen comes
 * first (lib/server.ts), then the one the app was built with.
 */
export const DEMO_URL =
  savedServer() ?? import.meta.env.VITE_QRIE_DEMO_URL ?? 'http://127.0.0.1:54400'

export const backend = demoBackend(DEMO_URL, browserSession('qrie-student'))
export const api = backend.api

export function isSignedOutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /sign in again|jwt expired|invalid jwt/i.test(error.message)
  )
}

/** What to tell a child when a call fails (the school's own words, or one plain sentence). */
export function say(error: unknown): string {
  return friendlyError(error)
}
