import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDoubtSystemPrompt, parseAgentReply, createTransport } from '../src/lib/geminiAgent';
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
   * The transport that actually ships. The two below it are dev-only now:
   * Vite inlines every VITE_ variable, so a key read in the browser is a key
   * printed into the bundle for anyone who unzips the APK.
   */
  it('relay: sends no key anywhere, because it has none', async () => {
    const calls = stub({ choices: [{ message: { content: 'hi' } }] });
    const send = createTransport({ student, provider: 'relay' });
    expect(await send('SYS', turns, new AbortController().signal)).toBe('hi');
    expect(calls[0].url).toBe('/api/llm');
    expect(JSON.stringify(calls[0].init.headers ?? {}).toLowerCase()).not.toContain('authorization');
    expect(String(calls[0].init.body)).not.toMatch(/api[-_]?key/i);
  });

  it('relay: is what you get when nobody names a provider', async () => {
    const calls = stub({ choices: [{ message: { content: 'hi' } }] });
    await createTransport({ student })('SYS', turns, new AbortController().signal);
    expect(calls[0].url).toBe('/api/llm');
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
    expect(body.model).toBe('google/gemini-3-flash-preview');
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
