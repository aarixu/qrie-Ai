import { createTokenSource, readServiceAccount, type TokenSource } from './googleAuth.ts';

/**
 * WHICH VENDOR THINKS, SPEAKS AND HEARS — DECIDED ONCE, AND FAILING CLOSED.
 *
 * Two configurations exist. Production has a Google service account, and
 * handler.ts sends /api/llm, /api/speech and /api/hear to Vertex. A laptop
 * has none, and the same three routes go to OpenRouter (which reaches
 * Deepgram for voice and hearing).
 *
 * THE THIRD CASE IS THE ONE THIS FILE EXISTS FOR: a service account that is
 * set but will not parse — a truncated paste, a P12 file, a typo while
 * rotating the secret. The Edge Function used to catch that, log it, and
 * carry on with no `vertex` and a live OpenRouter key, so every child's voice
 * went back to the vendors /privacy says are no longer used, with one log
 * line as the only trace. Now a configured service account means OpenRouter
 * is not used, whether or not the key works: the key handed on is '', and
 * llmRelay, speechRelay and hearRelay each answer 503 "no OpenRouter key"
 * on an empty key (relays.ts). A class without her voice is a visible
 * failure somebody fixes the same day; a class quietly heard by a vendor
 * the parent was told is gone is not.
 *
 * What still works with a broken key: everything that is not a model —
 * reports, class keeping, enrolment, tickets. And `speechUrl` (our own voice
 * box, relays.ts) is not a vendor, so it is left alone.
 *
 * Deciding this at startup rather than per request is for the same reason
 * the token source is built once: it caches the token it mints.
 */
export interface ModelVendors {
  /** Set when a Google service account is configured and parses. */
  vertex?: { tokens: TokenSource };
  /**
   * The OpenRouter key the handler may use. '' whenever a service account is
   * configured at all, working or not; the configured key only when none is.
   */
  openRouterKey: string;
  /** Why a configured service account could not be used, for the log. */
  unusable?: string;
}

export function modelVendors(env: { serviceAccountJson: string; openRouterKey: string }): ModelVendors {
  if (!env.serviceAccountJson) return { openRouterKey: env.openRouterKey };
  try {
    return {
      vertex: { tokens: createTokenSource(readServiceAccount(env.serviceAccountJson)) },
      openRouterKey: '',
    };
  } catch (e) {
    return { openRouterKey: '', unusable: (e as Error).message };
  }
}
