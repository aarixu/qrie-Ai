// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { draftChat } from '../../../packages/lms-client/src/index.ts';
import { vertexAi } from '../src/ai.ts';

/**
 * The demo's "Draft with AI", when the demo runs with Qrie's AI key: the
 * same Vertex code the hosted relay runs (packages/relay completeOnVertex),
 * here with a stand-in token and a stand-in Google, so no test calls a real
 * model. Written first.
 */

const tokens = { projectId: 'demo-project', token: async () => 'stand-in-token' };
const chat = draftChat({ grade: 8, subject: 'Mathematics', chapter: 'Rational numbers', count: 2 });

describe('the demo’s AI', () => {
  it("returns the model's text, asked of Vertex as the relay asks it", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('authorization') });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"questions":[]}' }] } }] }), { status: 200 });
    }) as typeof globalThis.fetch;
    expect(await vertexAi(tokens, fetch)(chat as never)).toEqual({ text: '{"questions":[]}' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('demo-project');
    expect(calls[0].url).toContain('gemini-3.7-flash');
    expect(calls[0].auth).toBe('Bearer stand-in-token');
  });

  it("says why when Vertex refuses, in Vertex's words", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Permission denied on the project' } }), { status: 403 })) as unknown as typeof globalThis.fetch;
    expect(await vertexAi(tokens, fetch)(chat as never)).toEqual({ error: 'Permission denied on the project' });
  });

  it('refuses a model the relay does not serve, without calling Google', async () => {
    let called = false;
    const fetch = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof globalThis.fetch;
    expect(await vertexAi(tokens, fetch)({ ...chat, model: 'google/gemini-9-ultra' } as never)).toEqual({
      error: 'this relay does not serve google/gemini-9-ultra',
    });
    expect(called).toBe(false);
  });
});
