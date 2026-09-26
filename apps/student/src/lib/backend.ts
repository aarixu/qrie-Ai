import { browserSession, demoBackend } from '@ai-tutor/lms-client'

/** The demo school today (`npm run demo`); the hosted project once `lms` is live there. */
export const DEMO_URL =
  import.meta.env.VITE_QRIE_DEMO_URL ?? 'http://127.0.0.1:54400'

export const backend = demoBackend(DEMO_URL, browserSession('qrie-student'))
export const api = backend.api

export function isSignedOutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /sign in again|jwt expired|invalid jwt/i.test(error.message)
  )
}

/** What to tell a child when a call fails. */
export function say(error: unknown): string {
  return error instanceof TypeError
    ? 'Could not reach your school. Check your internet and try again.'
    : (error as Error).message
}
