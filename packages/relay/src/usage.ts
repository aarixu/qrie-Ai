import type { RelayName } from './gate.ts';
import type { OpenAiReply } from './vertex.ts';

/**
 * WHAT A CALL ACTUALLY COST, IN THE UNITS THE PROVIDER BILLS.
 *
 * The meter in gate.ts answers "may this student make another call", and
 * nothing more. Its units are now pegged to money — one unit is one paisa of
 * vendor spend — but they are still a CEILING: llm is charged flat because
 * nothing in a request predicts the tokens it will come back with, which
 * overcharges a judge call sixfold and undercharges a prep call 2.7x. So the
 * meter cannot answer "what did that class cost in rupees". This file can.
 *
 * (It once counted llm 10, hear 4, speech 1 — the exact inverse of a bill that
 * is 86% speech — and that table is gone. The correction is in the docblock on
 * UNITS in gate.ts; it is named here only so this paragraph is not read as
 * describing the meter as it stands.)
 *
 * Vertex already tells us: every reply carries usageMetadata with the token
 * counts, and vertex.ts has been forwarding it to the browser and forgetting it
 * on the server. Speech is billed per character of input and the relay holds
 * the text before it dispatches; transcription is billed per second of audio
 * and the relay holds the bytes. Every quantity was in hand. None was written
 * down. This is the same defect the ledger closed for answers, one layer down.
 *
 * QUANTITIES, NEVER PRICES. A token is a fact about a call; a rupee per token
 * is a fact about a contract that changes without telling us. Prices live in
 * the model_price table where an operator can update them, and cost is a join
 * done at read time. A price hard-coded here would be wrong within the quarter
 * and nobody would notice until the bill did.
 */
export interface UsageEvent {
  userId: string;
  /**
   * The learning session this call belongs to, when the app said so. The llm
   * and hear relays carry it in an `x-session-id` header; speech, which is an
   * <audio src> and cannot send a header, carries it as a `session` query
   * parameter beside the ticket. Absent for calls made outside a class.
   */
  sessionId: string | null;
  relay: RelayName;
  provider: 'vertex' | 'openrouter' | 'storage';
  model: string | null;
  /** The upstream status, so a failed call is visible rather than invisible. */
  status: number;
  promptTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  /** Generated pictures. Priced per image, not per token, so counted apart. */
  images?: number;
  /** Text handed to the voice. */
  characters?: number;
  /** Audio handed to the transcriber. Seconds are derived at read time. */
  audioBytes?: number;
  /** Files kept. */
  bytes?: number;
}

/**
 * Where a usage event goes. A host provides one; the dev server prints, the
 * Edge Function writes to Postgres.
 *
 * Recording must NEVER fail the call it describes. A student whose class is
 * refused because the accounting table was slow has been charged, in time, for
 * our bookkeeping. Implementations swallow their own errors.
 */
export interface Usage {
  record(event: UsageEvent): Promise<void>;
}

// --------------------------------------------------------------- derive ----

/** Pull what Vertex measured out of the reply it sent back. */
export function usageFromVertex(
  base: Pick<UsageEvent, 'userId' | 'sessionId'>,
  model: string,
  status: number,
  reply: OpenAiReply | undefined,
): UsageEvent {
  const u = reply?.usage ?? {};
  const images = reply?.choices?.[0]?.message?.images?.length ?? 0;
  return {
    ...base,
    relay: 'llm',
    provider: 'vertex',
    model,
    status,
    promptTokens: numberOr(u.promptTokenCount),
    outputTokens: numberOr(u.candidatesTokenCount),
    thoughtTokens: numberOr(u.thoughtsTokenCount),
    ...(images > 0 ? { images } : {}),
  };
}

/**
 * The OpenRouter llm path is a stream the relay hands off without reading, so
 * tokens are not visible here. Model and the fact of the call are; the rest is
 * blank rather than guessed. This path is the dev fallback — Vertex is what
 * students reach — so the blank is tolerable and it is written down.
 */
export function usageFromOpenRouterLlm(
  base: Pick<UsageEvent, 'userId' | 'sessionId'>,
  body: Uint8Array,
): UsageEvent {
  let model: string | null = null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { model?: unknown };
    if (typeof parsed.model === 'string') model = parsed.model;
  } catch {
    // Not JSON; llmRelay will refuse it and the record says so via status.
  }
  return { ...base, relay: 'llm', provider: 'openrouter', model, status: 0 };
}

export function usageFromSpeech(
  base: Pick<UsageEvent, 'userId' | 'sessionId'>,
  model: string,
  text: string,
): UsageEvent {
  // Dispatched, not confirmed: the stream is carried by the host and the relay
  // never sees whether it completed. Billing is per character of INPUT either
  // way, so this overcounts only the calls the provider itself failed.
  return {
    ...base,
    relay: 'speech',
    provider: 'openrouter',
    model,
    status: 0,
    characters: [...text].length,
  };
}

export function usageFromHear(
  base: Pick<UsageEvent, 'userId' | 'sessionId'>,
  model: string,
  status: number,
  audio: Uint8Array,
): UsageEvent {
  return { ...base, relay: 'hear', provider: 'openrouter', model, status, audioBytes: audio.byteLength };
}

export function usageFromClass(
  base: Pick<UsageEvent, 'userId' | 'sessionId'>,
  status: number,
  bytes: number,
): UsageEvent {
  return { ...base, relay: 'class', provider: 'storage', model: null, status, bytes };
}

const numberOr = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// ----------------------------------------------------------------- sinks ----

/** Keeps them in an array. For the dev server and the tests. */
export function createMemoryUsage(): Usage & { events: UsageEvent[] } {
  const events: UsageEvent[] = [];
  return {
    events,
    async record(event) {
      events.push(event);
    },
  };
}

/**
 * One row per call, written with the service role through a definer function,
 * exactly as the meter is. A student holding the anon key cannot write their
 * own usage, which matters the moment usage is what a credit is charged
 * against.
 */
export function createSupabaseUsage(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): Usage {
  return {
    async record(e) {
      try {
        await fetchImpl(`${supabaseUrl}/rest/v1/rpc/record_usage`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_user: e.userId,
            p_session: e.sessionId,
            p_relay: e.relay,
            p_provider: e.provider,
            p_model: e.model,
            p_status: e.status,
            p_prompt_tokens: e.promptTokens ?? null,
            p_output_tokens: e.outputTokens ?? null,
            p_thought_tokens: e.thoughtTokens ?? null,
            p_images: e.images ?? null,
            p_characters: e.characters ?? null,
            p_audio_bytes: e.audioBytes ?? null,
            p_bytes: e.bytes ?? null,
          }),
        });
      } catch {
        // Never the call's problem. A lost usage row is a gap in the books;
        // a refused class is a student's afternoon.
      }
    },
  };
}
