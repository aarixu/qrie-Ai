/**
 * What a person reads when a call fails. The lms functions raise sentences
 * written for people, and those are shown as they are. The database's own
 * messages — and the demo server's "see its console" — are not for a child,
 * and become one plain sentence; the original still reaches the console.
 */

export const SOMETHING_WENT_WRONG = 'Something went wrong. Try again in a moment; if it keeps happening, tell your school office.';
export const CANNOT_REACH = 'Could not reach your school. Check your internet and try again.';

const DATABASE_WORDS = [
  /permission denied/i,
  /violates (row-level security|unique|foreign key|not-null|check) /i,
  /invalid input syntax/i,
  /does not exist/i,
  /syntax error/i,
  /duplicate key/i,
  /\bconstraint\b/i,
  /see its console/i,
  /^internal server error$/i,
];

export function friendlyError(error: unknown): string {
  if (error instanceof TypeError) return CANNOT_REACH;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!message.trim() || DATABASE_WORDS.some((re) => re.test(message))) {
    if (typeof console !== 'undefined') console.error(error);
    return SOMETHING_WENT_WRONG;
  }
  return message;
}

/**
 * A session the school's server no longer takes. The demo server and
 * lms-admin say "Please sign in again.", as supabaseBackend does when it holds
 * no session; an lms function run with no user says "not signed in";
 * PostgREST, refusing a token, names it ("JWT expired"; any message with "JWT"
 * or "JWSError" in it is taken the same way). On the hosted project a session
 * that is gone says none of these: supabase-js calls with the anon key
 * instead, and anon may run no lms function but school_brand
 * (supabase/tests/lms-invariants.test.ts), so the call fails with "permission
 * denied for function …".
 */
const SIGNED_OUT = /sign in again|not signed in|\bjwt\b|jwserror|^permission denied for function /i;

export function isSignedOutError(error: unknown): boolean {
  return SIGNED_OUT.test(error instanceof Error ? error.message : String(error ?? ''));
}
