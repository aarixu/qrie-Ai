import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../index.ts';

/**
 * WHICH DOOR, AND WHICH MODEL.
 *
 * Both of these were wrong in a way nothing could catch, because nobody had
 * run the adapter yet:
 *
 * The default model was `gemini-3.7-flash`, which is in the model list and
 * never answers — three calls with a one-pixel image aborted at 30 and 45
 * seconds. Curriculum generation would have hung on its first request.
 *
 * And there was only one endpoint. A key made inside a Google Cloud project
 * that holds credits spends them through Vertex; the same call to
 * generativelanguage.googleapis.com is billed as AI Studio and, unpaid, is
 * capped at twenty requests a day per model. Same key, same header — the
 * difference is a base URL, so it is one env var and not a second adapter.
 */

const ok = () =>
  ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: '{"n":1}' }] } }] }),
  }) as unknown as Response;

const spy = () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return ok();
  });
  vi.stubGlobal('fetch', fetchMock);
  return seen;
};

afterEach(() => vi.unstubAllGlobals());

const run = async (env: Record<string, string>) => {
  const seen = spy();
  await new GeminiAdapter({ GEMINI_API_KEY: 'k', ...env } as NodeJS.ProcessEnv).complete('s', 'u');
  return seen[0];
};

describe('which endpoint the key is pointed at', () => {
  it('goes to AI Studio by default', async () => {
    expect((await run({})).url).toContain('generativelanguage.googleapis.com');
  });

  it('goes to Vertex when told to, with the same key in the same header', async () => {
    // Vertex express mode: no service account, no OAuth token, no hourly
    // refresh. That is the whole reason this is an env var and not a rewrite.
    const call = await run({ GEMINI_ENDPOINT: 'vertex' });
    expect(call.url).toContain('aiplatform.googleapis.com');
    expect(call.url).toContain('/publishers/google/models/');
    expect((call.init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
  });

  it('takes an explicit base URL, for a region or a mirror', async () => {
    const call = await run({ GEMINI_BASE_URL: 'https://asia-south1-aiplatform.googleapis.com/v1/publishers/google/models' });
    expect(call.url).toContain('asia-south1');
  });

  it('treats any other value as AI Studio rather than guessing', async () => {
    expect((await run({ GEMINI_ENDPOINT: 'typo' })).url).toContain('generativelanguage');
  });
});

describe('which model it asks for', () => {
  it('defaults to one that actually answers', async () => {
    // Not 3.7-flash. It is listed, and it never replies.
    const call = await run({});
    expect(call.url).toContain('gemini-3.8-flash');
    expect(call.url).not.toContain('3.7-flash');
  });

  it('takes an override', async () => {
    expect((await run({ GEMINI_MODEL: 'gemini-3.1-flash-lite' })).url).toContain('flash-lite');
  });
});

describe('what it asks for in the body', () => {
  it('asks for JSON and caps the thinking', async () => {
    const call = await run({});
    const body = JSON.parse(String(call.init.body));
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    // The flash models deliberate for minutes by default. Generating a
    // chapter of outcome nodes is a writing task with a schema, not a puzzle.
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(1024);
  });

  it('keeps the system prompt out of the user turn', async () => {
    const body = JSON.parse(String((await run({})).init.body));
    expect(body.systemInstruction.parts[0].text).toBe('s');
    expect(body.contents[0].parts[0].text).toBe('u');
  });
});
