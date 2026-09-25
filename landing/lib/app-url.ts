/**
 * WHERE THE WEBAPP IS, SAID ONCE.
 *
 * The default is a path on THIS origin, and that is the whole point rather
 * than a convenience. `contest_signup.user_id` references `auth.users`, and a
 * Supabase session lives in localStorage, which is per-origin — so a student
 * sent from here to a different hostname arrives as a second anonymous user
 * and the contest entry can never be joined to the learning it was meant to
 * track. Same origin, and the session the form just created is already there
 * when the app boots.
 *
 * NEXT_PUBLIC_APP_URL exists for the one honest exception: a deploy where the
 * app genuinely is elsewhere and somebody has decided to accept the broken
 * join. Setting it is a decision, not a default.
 */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '/app'

/** True when the app is on this origin, which is when the join actually works. */
export const APP_IS_SAME_ORIGIN = APP_URL.startsWith('/')
