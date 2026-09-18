import { describe, expect, it } from 'vitest';
import { createRelayClient, priceCalls } from '../lib/relayAdapters.mjs';

/**
 * The runner's spend line comes from the usage the relay reports — the
 * usageMetadata Vertex forwards on every /api/llm reply (promptTokenCount,
 * candidatesTokenCount, thoughtsTokenCount; see packages/relay/src/usage.ts,
 * usageFromVertex). These tests pin that capture and the pricing arithmetic
 * without a single real call.
 */

const PRICES = {
  rate: 95.6,
  checked: '2026-09-13',
  rows: [
    { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'prompt_token', inrPerUnit: 0.0000717, note: null },
    { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'output_token', inrPerUnit: 0.0003585, note: null },
    { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'thought_token', inrPerUnit: 0.0003585, note: null },
    { provider: 'vertex', model: 'gemini-3.1-flash-image', unit: 'prompt_token', inrPerUnit: 0.0000478, note: null },
    { provider: 'vertex', model: 'gemini-3.1-flash-image', unit: 'output_token', inrPerUnit: 0.0001912, note: null },
    { provider: 'vertex', model: 'gemini-3.1-flash-image', unit: 'image', inrPerUnit: 0, note: 'ZERO on purpose' },
  ],
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the node relay adapters', () => {
  it('sends bearer, x-prep-id and the chat body the browser sends, and records usage', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = createRelayClient({
      relayUrl: 'https://relay.example/functions/v1/relay',
      token: 'tok-123',
      prepId: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e',
      fetchImpl: async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return reply({
          choices: [{ message: { content: 'hello' } }],
          usage: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10 },
        });
      },
    });

    const text = await client.llm('google/gemini-3.7-flash', { json: true }).complete('sys', 'usr');
    expect(text).toBe('hello');
    expect(seen[0].url).toBe('https://relay.example/functions/v1/relay/api/llm');
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-123');
    expect(headers['x-prep-id']).toBe('4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e');
    const body = JSON.parse(String(seen[0].init.body));
    expect(body.model).toBe('google/gemini-3.7-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      model: 'google/gemini-3.7-flash',
      promptTokens: 100,
      outputTokens: 40,
      thoughtTokens: 10,
      measured: true,
    });
  });

  it('a reply with no usage is recorded as UNMEASURED, never as free', async () => {
    const client = createRelayClient({
      relayUrl: 'https://relay.example',
      token: 't',
      prepId: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e',
      fetchImpl: async () => reply({ choices: [{ message: { content: 'x' } }] }),
    });
    await client.llm('google/gemini-3.7-flash').complete('s', 'u');
    expect(client.calls[0].measured).toBe(false);
  });

  it('the image artist counts its pictures', async () => {
    const client = createRelayClient({
      relayUrl: 'https://relay.example',
      token: 't',
      prepId: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e',
      fetchImpl: async () =>
        reply({
          choices: [
            { message: { content: '', images: [{ image_url: { url: 'data:image/png;base64,AA==' } }] } },
          ],
          usage: { promptTokenCount: 50, candidatesTokenCount: 1300 },
        }),
    });
    const src = await client.imageArtist('google/gemini-3.1-flash-image').draw('a kidney');
    expect(src).toBe('data:image/png;base64,AA==');
    expect(client.calls[0].images).toBe(1);
  });

  it('a relay refusal throws the relay sentence rather than swallowing it', async () => {
    const client = createRelayClient({
      relayUrl: 'https://relay.example',
      token: 't',
      prepId: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e',
      fetchImpl: async () =>
        reply({ error: { message: 'Nothing left in today’s budget.', reason: 'budget' } }, 429),
    });
    await expect(client.llm('google/gemini-3.7-flash').complete('s', 'u')).rejects.toThrow(
      /budget/i,
    );
  });
});

describe('pricing what the relay reported', () => {
  it('prices tokens at the model_price rates, stripping the google/ prefix', () => {
    const { inr, unmeasured } = priceCalls(
      [
        {
          model: 'google/gemini-3.7-flash',
          promptTokens: 1000,
          outputTokens: 100,
          thoughtTokens: 10,
          images: 0,
          measured: true,
        },
      ],
      PRICES,
    );
    expect(unmeasured).toBe(0);
    expect(inr).toBeCloseTo(1000 * 0.0000717 + 110 * 0.0003585, 9);
  });

  it('an unmeasured call and an unpriced model both make the total a floor', () => {
    const calls = [
      { model: 'google/gemini-3.7-flash', promptTokens: 0, outputTokens: 0, thoughtTokens: 0, images: 0, measured: false },
      { model: 'google/gemini-9-new', promptTokens: 500, outputTokens: 50, thoughtTokens: 0, images: 0, measured: true },
    ];
    const { inr, unmeasured } = priceCalls(calls, PRICES);
    expect(unmeasured).toBe(2);
    expect(inr).toBe(0);
    expect(Number.isNaN(inr)).toBe(false);
  });
});

/**
 * THE FLOOR HAS TO STAY A FLOOR.
 *
 * `measured` decides whether a call is priced or counted as unknown, and the
 * only counts this runner can read are Vertex's (promptTokenCount &c). The
 * relay's OpenRouter dev fallback pipes its upstream reply through untouched
 * (packages/relay/src/relays.ts:91-108, `kind: 'stream'`), and OpenRouter
 * names its counts prompt_tokens/completion_tokens. A usage block in THOSE
 * names is a usage block this tool cannot read — and reading it as "measured,
 * zero tokens" would print Rs 0.00 for a call that cost real money. Unknown
 * must look unknown.
 */
describe('a usage block this tool cannot read', () => {
  it('counts an OpenRouter-shaped usage block as UNMEASURED, not as free', async () => {
    const client = createRelayClient({
      relayUrl: 'https://relay.example',
      token: 't',
      prepId: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e',
      fetchImpl: async () =>
        reply({
          choices: [{ message: { content: 'x' } }],
          // OpenRouter's names, not Vertex's — nothing here is readable.
          usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 },
        }),
    });
    await client.llm('google/gemini-3.7-flash').complete('s', 'u');
    expect(client.calls[0].measured).toBe(false);

    const { inr, unmeasured } = priceCalls(client.calls, PRICES);
    expect(unmeasured).toBe(1);
    expect(inr).toBe(0);
  });

  it('a genuine zero from Vertex is still MEASURED — the key is there', async () => {
    const client = createRelayClient({
      relayUrl: 'https://relay.example',
      token: 't',
      prepId: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e',
      fetchImpl: async () =>
        reply({
          choices: [{ message: { content: 'x' } }],
          usage: { promptTokenCount: 12, candidatesTokenCount: 0 },
        }),
    });
    await client.llm('google/gemini-3.7-flash').complete('s', 'u');
    expect(client.calls[0].measured).toBe(true);
    expect(client.calls[0].outputTokens).toBe(0);
  });
});

/**
 * A DAILY CEILING IS NOT A BROKEN PROMPT. The gate refuses with a `reason`
 * in the body (gate.ts:245) and a retry-after header; if the runner cannot
 * see it, three budget refusals in a row read as three content failures, the
 * three-strike stop fires, and the operator is told to fix a prompt that is
 * perfectly fine.
 */
describe('a refusal from the gate', () => {
  it('carries the relay reason and retry-after out to the caller', async () => {
    const client = createRelayClient({
      relayUrl: 'https://relay.example/functions/v1/relay',
      token: 'tok',
      prepId: 'p',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { message: 'That is enough for today.', reason: 'budget' } }),
          { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3600' } },
        ),
    });
    const err = await client
      .llm('google/gemini-3.7-flash')
      .complete('s', 'u')
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe('budget');
    expect(err.retryAfterSeconds).toBe(3600);
    // The relay's own sentence still surfaces as-is, as the browser shows it.
    expect(err.message).toBe('That is enough for today.');
  });
});

/**
 * model_price holds two OpenRouter rows whose MODEL NAMES contain a slash
 * ('deepgram/aura-2'). Stripping every leading vendor segment mangles those
 * into names that match nothing, and a call that matched nothing is priced at
 * zero — a hole presented as a saving, in the one tool whose job is the
 * opposite.
 */
describe('a model name that is itself slashed', () => {
  it('matches the price row before the vendor prefix is stripped', () => {
    const prices = {
      rate: 95.6,
      checked: '2026-09-13',
      rows: [
        { provider: 'openrouter', model: 'deepgram/aura-2', unit: 'output_token', inrPerUnit: 2, note: null },
      ],
    };
    const priced = priceCalls(
      [{ model: 'deepgram/aura-2', promptTokens: 0, outputTokens: 3, thoughtTokens: 0, images: 0, measured: true }],
      prices,
    );
    expect(priced.inr).toBe(6);
    expect(priced.unmeasured).toBe(0);
  });

  it('still strips the vendor prefix for the Vertex names model_price stores bare', () => {
    const prices = {
      rate: 95.6,
      checked: '2026-09-13',
      rows: [
        { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'output_token', inrPerUnit: 0.5, note: null },
      ],
    };
    const priced = priceCalls(
      [{ model: 'google/gemini-3.7-flash', promptTokens: 0, outputTokens: 4, thoughtTokens: 0, images: 0, measured: true }],
      prices,
    );
    expect(priced.inr).toBe(2);
  });
});

/**
 * HALF A USAGE BLOCK IS NOT A WHOLE ONE. `measured` is an OR across the three
 * Vertex keys, so a reply carrying promptTokenCount and nothing else priced
 * its output at zero and called the total exact — the partial form of the
 * bug this file already pins. thoughtsTokenCount is the exception: Vertex
 * omits it when the model did not think, which is an absence that means zero
 * rather than an absence that means unknown.
 */
describe('a usage block with a hole in it', () => {
  const clientReturning = (usage: Record<string, number>) =>
    createRelayClient({
      relayUrl: 'https://relay.example',
      token: 't',
      prepId: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e',
      fetchImpl: async () => reply({ choices: [{ message: { content: 'x' } }], usage }),
    });

  it('prompt-only usage is a FLOOR, not a total', async () => {
    const client = clientReturning({ promptTokenCount: 1000 });
    await client.llm('google/gemini-3.7-flash').complete('s', 'u');
    const { inr, unmeasured } = priceCalls(client.calls, PRICES);
    // The prompt tokens are real and are charged; the missing output count is
    // a hole, and a hole makes the figure a floor.
    expect(inr).toBeCloseTo(1000 * 0.0000717, 9);
    expect(unmeasured).toBe(1);
  });

  it('a missing thoughtsTokenCount is not a hole — Vertex omits it when nothing thought', async () => {
    const client = clientReturning({ promptTokenCount: 1000, candidatesTokenCount: 200 });
    await client.llm('google/gemini-3.7-flash').complete('s', 'u');
    const { unmeasured } = priceCalls(client.calls, PRICES);
    expect(unmeasured).toBe(0);
  });
});
