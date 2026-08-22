import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  AnthropicAdapter,
  GeminiAdapter,
  createAdapterFromEnv,
  stripJsonFences,
} from '../src/llm.ts';

describe('stripJsonFences', () => {
  it('strips a ```json fence', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a bare ``` fence', () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips surrounding whitespace around a fence', () => {
    expect(stripJsonFences('  ```json\n{"a": 1}\n```  \n')).toBe('{"a": 1}');
  });

  it('leaves unfenced replies alone (minus outer whitespace)', () => {
    expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}');
  });

  it('does not eat fences inside the JSON body', () => {
    const body = '{"text":"use ``` for code"}';
    expect(stripJsonFences(body)).toBe(body);
  });
});

describe('createAdapterFromEnv', () => {
  const env = (extra: Record<string, string>): NodeJS.ProcessEnv => extra as NodeJS.ProcessEnv;

  it('defaults to Gemini', () => {
    expect(createAdapterFromEnv(env({ GOOGLE_API_KEY: 'k' }))).toBeInstanceOf(GeminiAdapter);
  });

  it('accepts GEMINI_API_KEY as the Gemini key', () => {
    expect(createAdapterFromEnv(env({ GEMINI_API_KEY: 'k' }))).toBeInstanceOf(GeminiAdapter);
  });

  it('selects Anthropic via LLM_PROVIDER', () => {
    expect(
      createAdapterFromEnv(env({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })),
    ).toBeInstanceOf(AnthropicAdapter);
  });

  it('throws a specific message when the key is missing', () => {
    expect(() => createAdapterFromEnv(env({}))).toThrow(/GOOGLE_API_KEY or GEMINI_API_KEY/);
    expect(() => createAdapterFromEnv(env({ LLM_PROVIDER: 'anthropic' }))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('throws on an unknown provider', () => {
    expect(() => createAdapterFromEnv(env({ LLM_PROVIDER: 'openai' }))).toThrow(/LLM_PROVIDER/);
  });
});

// Network adapters, tested against a stubbed global fetch — no real requests.
type FetchCall = { url: string; init: { headers: Record<string, string>; body: string } };

function stubFetch(payload: unknown): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init: FetchCall['init']) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => payload, text: async () => '' };
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('GeminiAdapter', () => {
  it('posts system/user to generateContent and strips fences from the reply', async () => {
    const calls = stubFetch({
      candidates: [{ content: { parts: [{ text: '```json\n{"ok":true}\n```' }] } }],
    });
    const adapter = new GeminiAdapter({ GOOGLE_API_KEY: 'gk', GEMINI_MODEL: 'gemini-test' } as NodeJS.ProcessEnv);

    const reply = await adapter.complete('SYS', 'USER');

    expect(reply).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    );
    expect(calls[0].init.headers['x-goog-api-key']).toBe('gk');
    const body = JSON.parse(calls[0].init.body);
    expect(body.systemInstruction.parts[0].text).toBe('SYS');
    expect(body.contents[0].parts[0].text).toBe('USER');
  });

  it('defaults the model to gemini-3.1-flash', async () => {
    const calls = stubFetch({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
    await new GeminiAdapter({ GEMINI_API_KEY: 'gk' } as NodeJS.ProcessEnv).complete('s', 'u');
    expect(calls[0].url).toContain('/models/gemini-3.1-flash:');
  });

  it('throws with the HTTP status on a failed request', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 403, text: async () => 'denied' }));
    const adapter = new GeminiAdapter({ GOOGLE_API_KEY: 'gk' } as NodeJS.ProcessEnv);
    await expect(adapter.complete('s', 'u')).rejects.toThrow(/Gemini API 403/);
  });
});

describe('AnthropicAdapter', () => {
  it('posts to /v1/messages with auth headers and joins text blocks', async () => {
    const calls = stubFetch({
      content: [
        { type: 'text', text: '```json\n{"ok":' },
        { type: 'text', text: 'true}\n```' },
      ],
    });
    const adapter = new AnthropicAdapter({ ANTHROPIC_API_KEY: 'ak' } as NodeJS.ProcessEnv);

    const reply = await adapter.complete('SYS', 'USER');

    expect(reply).toBe('{"ok":true}');
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].init.headers['x-api-key']).toBe('ak');
    expect(calls[0].init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.system).toBe('SYS');
    expect(body.messages).toEqual([{ role: 'user', content: 'USER' }]);
  });

  it('honours ANTHROPIC_MODEL', async () => {
    const calls = stubFetch({ content: [{ type: 'text', text: '{}' }] });
    await new AnthropicAdapter({
      ANTHROPIC_API_KEY: 'ak',
      ANTHROPIC_MODEL: 'claude-test',
    } as NodeJS.ProcessEnv).complete('s', 'u');
    expect(JSON.parse(calls[0].init.body).model).toBe('claude-test');
  });
});
