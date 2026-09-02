/**
 * WHO IS ASKING — the token server's copy of the question.
 *
 * The implementation moved to @ai-tutor/relay when the relays needed exactly
 * the same thing: verify a Supabase session, from a Node server or a Deno Edge
 * Function, with no dependencies and no JWT secret in the process. Two copies
 * of a security check is how one of them quietly stops matching the other, so
 * there is one, and this file is the door into it.
 *
 * Re-exported rather than re-imported at every call site so that tokenServer.ts
 * and its tests keep reading the way they did.
 */
export {
  bearerFrom,
  createSupabaseVerifier,
  type Verified,
  type Verifier,
  type VerifyResult,
} from '../../../packages/relay/src/auth';
