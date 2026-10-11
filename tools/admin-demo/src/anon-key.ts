/**
 * The local demo's "anon key": a dummy SHAPED like Supabase's anon key (a JWT
 * whose payload says role = anon), so the console's start-up checks treat it
 * as the public key it stands for. It is no secret and opens nothing: it was
 * signed with the published phrase "not a secret: the QRIE local demo anon
 * key", and the demo server accepts this exact string as a signed-out browser
 * (anon), never as a signed-in person. apps/admin/.env.demo carries the same
 * string; tests/e2e.test.ts checks the two match.
 *
 * Payload: {"iss":"qrie-local-demo","ref":"local-demo","role":"anon","iat":1791676800,"exp":2107036800}
 */
export const DEMO_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJxcmllLWxvY2FsLWRlbW8iLCJyZWYiOiJsb2NhbC1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NzY4MDAsImV4cCI6MjEwNzAzNjgwMH0.Xr8i_wBPzq2iQxEOcxZyqpie82JSvP4thGE8hjPm470';

/** Where `npm run admin:demo` listens, and what apps/admin/.env.demo points the console at. */
export const DEMO_PORT = 54329;
