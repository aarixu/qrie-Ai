import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_MODELS, bareModel } from '@ai-tutor/relay';
import { buildDoubtSystemPrompt, parseAgentReply, createTransport, createGeminiAgent } from '../src/lib/geminiAgent';
import type { DoubtContext } from '@ai-tutor/doubt-session';
import type { StudentContext } from '@ai-tutor/persona';

const ctx: DoubtContext = {
  lessonId: 'l1',
  beatId: 'chambers',
  beatTopic: 'Four chambers',
  transcriptSoFar: 'The heart is a pump.\nIt has four chambers.',
  visibleElementIds: ['b_ra'],
  recentBeats: [
    { id: 'pump', topic: 'The heart is a pump' },
    { id: 'chambers', topic: 'Four chambers' },
  ],
  outcomeIds: [],
};

describe('buildDoubtSystemPrompt', () => {
  it('carries the moment, the transcript and every recall target', () => {
    const p = buildDoubtSystemPrompt(ctx, { klass: 10 } satisfies StudentContext);
    expect(p).toContain('Four chambers');
    expect(p).toContain('The heart is a pump.');
    expect(p).toContain('id "pump"');
    expect(p).toContain('id "chambers"');
    expect(p).toContain('"recallBeatId"');
  });
});

describe('parseAgentReply', () => {
  const seen = new Set(['pump', 'chambers']);
  const valid = (id: string): boolean => seen.has(id);

  it('parses a clean reply', () => {
    const r = parseAgentReply('{"say":"Look here.","recallBeatId":"pump","done":false}', valid);
    expect(r).toEqual({ say: 'Look here.', recallBeatId: 'pump', done: false });
  });

  it('strips markdown fences', () => {
    const r = parseAgentReply('```json\n{"say":"Hi","recallBeatId":null,"done":true}\n```', valid);
    expect(r.say).toBe('Hi');
    expect(r.done).toBe(true);
  });

  it('drops a hallucinated recall id', () => {
    const r = parseAgentReply('{"say":"See this","recallBeatId":"ghost","done":false}', valid);
    expect(r.recallBeatId).toBeNull();
  });

  it('falls back to raw text when the reply is not JSON', () => {
    const r = parseAgentReply('Sorry, plain prose answer.', valid);
    expect(r.say).toContain('plain prose');
    expect(r.done).toBe(false);
    expect(r.recallBeatId).toBeNull();
  });

  it('falls back when say is missing', () => {
    const r = parseAgentReply('{"recallBeatId":"pump","done":true}', valid);
    expect(r.say.length).toBeGreaterThan(0);
    expect(r.done).toBe(false);
  });
});

describe('createTransport', () => {
  const student = { klass: 10 } as never;
  const turns = [
    { role: 'user' as const, text: 'why?' },
    { role: 'model' as const, text: 'because' },
    { role: 'user' as const, text: 'and?' },
  ];

  const stub = (payload: unknown, ok = true, status = 200) => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok, status, json: async () => payload };
    });
    return calls;
  };

  afterEach(() => vi.unstubAllGlobals());

  /**
   * The relay call, whichever call it turned out to be.
   *
   * Relay calls go through lib/relay, which first makes sure the device has an
   * identity — every relay demands a verified caller now, because behind each
   * one is somebody's money. So the LLM request is no longer necessarily the
   * first fetch, and a test that assumed it was would be asserting the order of
   * an implementation detail rather than the thing that matters.
   */
  const llmCall = (calls: { url: string; init: RequestInit }[]) => {
    const found = calls.find((c) => c.url.includes('/api/llm'));
    if (!found) throw new Error(`no /api/llm call among: ${calls.map((c) => c.url).join(', ')}`);
    return found;
  };

  /**
   * The transport that actually ships. The two below it are dev-only now:
   * Vite inlines every VITE_ variable, so a key read in the browser is a key
   * printed into the bundle for anyone who unzips the APK.
   */
  it('relay: carries no provider key, because it has none', async () => {
    const calls = stub({ choices: [{ message: { content: 'hi' } }] });
    const send = createTransport({ student, provider: 'relay' });
    expect(await send('SYS', turns, new AbortController().signal)).toBe('hi');

    const call = llmCall(calls);
    // The Authorization header it MAY now carry is the student's own Supabase
    // session, which is theirs and is the point. What must never appear is a
    // provider key, in any header or anywhere in the body.
    expect(JSON.stringify(call.init.headers ?? {})).not.toMatch(/sk-or-|AIza/);
    expect(String(call.init.body)).not.toMatch(/api[-_]?key/i);
  });

  it('relay: is what you get when nobody names a provider', async () => {
    const calls = stub({ choices: [{ message: { content: 'hi' } }] });
    await createTransport({ student })('SYS', turns, new AbortController().signal);
    expect(llmCall(calls).url).toContain('/api/llm');
  });

  it('relay: surfaces a 200 carrying an error body, the way upstream sends them', async () => {
    stub({ error: { message: 'over budget' } });
    const send = createTransport({ student });
    await expect(send('SYS', turns, new AbortController().signal)).rejects.toThrow('over budget');
  });

  it('refuses to call a direct provider with no key rather than calling it unauthenticated', () => {
    expect(() => createTransport({ student, provider: 'gemini' })).toThrow(/key/i);
  });

  it('Gemini: posts contents with the model/user roles it expects', async () => {
    const calls = stub({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] });
    const send = createTransport({ apiKey: 'gk', student, provider: 'gemini' });
    expect(await send('SYS', turns, new AbortController().signal)).toBe('hi');
    expect(calls[0].url).toContain('/models/gemini-3.7-flash:generateContent?key=gk');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('SYS');
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('OpenRouter: same turns, renamed to system/assistant/user', async () => {
    const calls = stub({ choices: [{ message: { content: 'hi' } }] });
    const send = createTransport({ apiKey: 'or', student, provider: 'openrouter' });
    expect(await send('SYS', turns, new AbortController().signal)).toBe('hi');
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer or');
    const body = JSON.parse(calls[0].init.body as string);
    // Not a pinned name: the name this asserted for weeks was one the relay's
    // Vertex allow-list refuses with a 400, so the doubt tutor's relay path
    // was broken in production and this test was green. The assertion is now
    // the property that matters — the relay will actually serve it.
    expect(ALLOWED_MODELS.has(bareModel(body.model))).toBe(true);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('OpenRouter: an upstream failure arrives as a 200 with an error body', async () => {
    stub({ error: { message: 'no credits' } });
    const send = createTransport({ apiKey: 'or', student, provider: 'openrouter' });
    await expect(send('SYS', turns, new AbortController().signal)).rejects.toThrow(/no credits/);
  });

  it('both surface an HTTP failure, so the session can hand the room back', async () => {
    stub({}, false, 429);
    const gem = createTransport({ apiKey: 'k', student, provider: 'gemini' });
    await expect(gem('S', turns, new AbortController().signal)).rejects.toThrow(/Gemini 429/);
    stub({}, false, 401);
    const or = createTransport({ apiKey: 'k', student, provider: 'openrouter' });
    await expect(or('S', turns, new AbortController().signal)).rejects.toThrow(/OpenRouter 401/);
  });
});

const student = { klass: 10 } as never;

describe('when the model cannot answer', () => {
  const ctx = { beatId: 'b1', lessonId: 'l', beatTopic: 't', said: '' } as never;

  it('hands the question to the scripted tutor instead of apologising', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const said: string[] = [];
    const io = { say: async (t: string) => void said.push(t), recall: () => {}, done: () => {} };

    const scripted: string[] = [];
    const fallback = {
      start: () => ({
        sendUserText: (t: string) => scripted.push(t),
        stop: () => {},
      }),
    };

    const agent = createGeminiAgent({ student, fallback } as never);
    const session = agent.start(ctx, io as never);
    session.sendUserText('why is the sky blue?');
    await new Promise((r) => setTimeout(r, 0));

    expect(scripted).toEqual(['why is the sky blue?']);
    expect(said.join(' ')).not.toMatch(/trouble connecting/i);
    vi.unstubAllGlobals();
  });

  it('still hands the room back when there is no fallback at all', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const said: string[] = [];
    let handedBack = false;
    const io = {
      say: async (t: string) => void said.push(t),
      recall: () => {},
      done: () => {
        handedBack = true;
      },
    };

    const session = createGeminiAgent({ student } as never).start(ctx, io as never);
    session.sendUserText('anything');
    await new Promise((r) => setTimeout(r, 0));

    expect(said.join(' ')).toMatch(/trouble connecting/i);
    expect(handedBack).toBe(true);
    vi.unstubAllGlobals();
  });
});
