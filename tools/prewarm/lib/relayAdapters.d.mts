/**
 * THE CONTRACT `relayAdapters.mjs` HAS. See topics.d.mts for why.
 *
 * The runner drives the SAME packages/class-prep pipeline the browser does, so
 * it must hand class-prep the adapter shapes that package already expects —
 * only pointed at the relay over HTTP with a bearer token instead of at a
 * browser fetch. Every call carries `x-prep-id`, which is how a warm run's
 * spend is told apart from a student's in usage_event.
 */

/**
 * One relay call, as the client recorded it for pricing afterwards.
 *
 * Only `model` is required, because only `model` is what priceCalls joins on.
 * The quantities (promptTokens, outputTokens, thoughtTokens, images,
 * characters, audioBytes) are read when present and their absence is exactly
 * what `unmeasured` counts — so the type must let them be absent, or the
 * floor-not-invoice property could not be expressed.
 */
export interface RecordedCall {
  model: string;
  relay?: string;
  [key: string]: unknown;
}

export interface LlmOptions {
  json?: boolean;
  effort?: string;
}

/**
 * A refusal from the meter arrives as an Error carrying the reason the relay
 * gave — 'rate', 'budget', 'capped', 'halted', 'unavailable' — so a runner can
 * stop on a spent budget rather than hammering a closed door.
 */
export interface RelayError extends Error {
  reason?: string;
  status?: number;
}

export interface RelayClient {
  /** Every call made, in order, for priceCalls. */
  calls: RecordedCall[];
  llm(model: string, opts?: LlmOptions): { complete(system: string, user: string): Promise<string> };
  /** null when the model answered but drew nothing. */
  imageArtist(model: string): { draw(prompt: string): Promise<string | null> };
  vision(model: string): { look(imageUrl: string, system: string, user: string): Promise<unknown> };
  keep(savedClass: unknown): Promise<{ ok: boolean; status: number; body: unknown }>;
}

export declare function createRelayClient(options: {
  relayUrl: string;
  token: string;
  prepId: string;
  /**
   * Narrower than `typeof fetch` on purpose: this client only ever calls it
   * with a string URL it built itself, and tests substitute a stub with that
   * exact signature. Demanding the full overloaded DOM type here would force
   * every stub to accept `URL | Request` inputs it will never be handed.
   */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}): RelayClient;

/** Rates parsed from tools/sql/model_price.sql. */
export interface ParsedPrices {
  rows: { provider: string; model: string; unit: string; inrPerUnit: number }[];
}

/**
 * A FLOOR, and it says so: `unmeasured` counts calls whose reply carried no
 * usage, calls whose usage was only partly readable, and calls whose model has
 * no parsed price. A missing price costs nothing and would otherwise look like
 * a saving.
 */
export declare function priceCalls(
  calls: readonly RecordedCall[],
  prices: ParsedPrices,
): { inr: number; unmeasured: number };
