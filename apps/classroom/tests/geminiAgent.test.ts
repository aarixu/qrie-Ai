import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_MODELS, BLOCKED_FINISH, BLOCKED_LINE, bareModel } from '@ai-tutor/relay';
import {
  buildDoubtSystemPrompt,
  parseAgentReply,
  createTransport,
  createGeminiAgent,
  FILTERED_REPLY_LINE,
  MALFORMED_REPLY_LINE,
} from '../src/lib/geminiAgent';
import {
  createHandoff,
  createStubAgent,
  entryLine,
  type DoubtContext,
} from '@ai-tutor/doubt-session';
import { REGISTER, type StudentContext } from '@ai-tutor/persona';
import { profileStore } from '../src/stores/profile';
import { setTutorLanguage } from '../src/lib/workspace';

/**
 * NO PROJECT, NO SIGN-IN. These drive the real `relayFetch`, which asks
 * `supabase()` for a session and, finding none, signs the device in
 * anonymously against whatever project `.env.local` names. Null is the app's
 * own local-only path: no session, no Authorization header, no sign-in.
 */
vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));

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

  /**
   * A REPLY THAT IS NOT THE SHAPE ASKED FOR IS NOT SPOKEN.
   *
   * It used to be: the raw text, fences stripped, cut at 400 characters and
   * read aloud to a child. A model that broke format has already stopped doing
   * what it was told, and the prose it produced instead — half a JSON object,
   * a refusal, a monologue — is the least checked text in the whole path. So
   * she says one fixed line and the student asks again.
   */
  it('speaks a fixed line, never the raw text, when the reply is not JSON', () => {
    const r = parseAgentReply('Sorry, plain prose answer.', valid);
    expect(r.say).toBe(MALFORMED_REPLY_LINE);
    expect(r.say).not.toContain('plain prose');
    expect(r.done).toBe(false);
    expect(r.recallBeatId).toBeNull();
  });

  it('speaks the fixed line when say is missing, and does not end the doubt', () => {
    const r = parseAgentReply('{"recallBeatId":"pump","done":true}', valid);
    expect(r.say).toBe(MALFORMED_REPLY_LINE);
    expect(r.done).toBe(false);
    expect(r.recallBeatId).toBeNull();
  });

  it('speaks the fixed line for half a JSON object', () => {
    const r = parseAgentReply('{"say": "The left ventricle is', valid);
    expect(r.say).toBe(MALFORMED_REPLY_LINE);
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
    expect((await send('SYS', turns, new AbortController().signal)).text).toBe('hi');

    const call = llmCall(calls);
    // The Authorization header it MAY now carry is the student's own Supabase
    // session, which is theirs and is the point. What must never appear is a
    // provider key, in any header or anywhere in the body.
    expect(JSON.stringify(call.init.headers ?? {})).not.toMatch(/sk-or-|AIza/);
    expect(String(call.init.body)).not.toMatch(/api[-_]?key/i);
  });

  /**
   * THINKING AT ITS FLOOR (T0.1). A typed doubt turn is one short spoken line;
   * with no `reasoning_effort` the relay leaves Vertex on the model's default
   * thinking (packages/relay/src/vertex.ts sets thinkingConfig only when the
   * field is there), and every turn pays for it. 'none' is the lowest the
   * relay accepts; on a 3.x model it maps to thinking LOW, the floor.
   */
  it('relay: asks for the least thinking the model allows', async () => {
    const calls = stub({ choices: [{ message: { content: 'hi' } }] });
    await createTransport({ student })('SYS', turns, new AbortController().signal);
    const body = JSON.parse(String(llmCall(calls).init.body)) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe('none');
  });

  it('relay: is what you get when nobody names a provider', async () => {
    const calls = stub({ choices: [{ message: { content: 'hi' } }] });
    await createTransport({ student })('SYS', turns, new AbortController().signal);
    expect(llmCall(calls).url).toContain('/api/llm');
  });

  /**
   * A PROVIDER FILTER IS NOT AN ANSWER, AND THE TRANSPORT SAYS WHICH IT GOT.
   *
   * The relay answers a policy stop as a 200 with finish_reason
   * 'content_filter' (packages/relay/src/vertex.ts, BLOCKED_FINISH). The
   * transport used to hand back the content alone, so the session could not
   * tell the relay's fixed line from a reply the model wrote.
   */
  it('relay: says when a provider filter stopped the reply', async () => {
    stub({ choices: [{ message: { content: BLOCKED_LINE }, finish_reason: BLOCKED_FINISH }] });
    const send = createTransport({ student });
    expect(await send('SYS', turns, new AbortController().signal)).toEqual({
      text: BLOCKED_LINE,
      filtered: true,
    });
  });

  it('relay: an ordinary stop is not a filter, and neither is no finish_reason at all', async () => {
    stub({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
    const send = createTransport({ student });
    expect((await send('SYS', turns, new AbortController().signal)).filtered).toBe(false);
    stub({ choices: [{ message: { content: 'hi' } }] });
    expect((await send('SYS', turns, new AbortController().signal)).filtered).toBe(false);
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
    expect((await send('SYS', turns, new AbortController().signal)).text).toBe('hi');
    expect(calls[0].url).toContain('/models/gemini-3.7-flash:generateContent?key=gk');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('SYS');
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('OpenRouter: same turns, renamed to system/assistant/user', async () => {
    const calls = stub({ choices: [{ message: { content: 'hi' } }] });
    const send = createTransport({ apiKey: 'or', student, provider: 'openrouter' });
    expect((await send('SYS', turns, new AbortController().signal)).text).toBe('hi');
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

  it('OpenRouter: reads the same finish_reason the relay answers in', async () => {
    stub({ choices: [{ message: { content: 'half a' }, finish_reason: 'content_filter' }] });
    const send = createTransport({ apiKey: 'or', student, provider: 'openrouter' });
    expect((await send('SYS', turns, new AbortController().signal)).filtered).toBe(true);
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

/**
 * ONE OPENING, NOT TWO.
 *
 * The scripted stub is the typed tutor's safety net, and it used to be started
 * alongside the model on every raised hand — so it greeted ("I'm listening.
 * What would you like to ask…?") and pulled an earlier beat onto the board
 * right after the handoff's own bridge line, on every doubt, while the model
 * was working perfectly. The test that covered the fallback used a SILENT
 * stand-in, which is why nobody saw it. These use the real stub.
 */
describe('the scripted stub starts only when the model fails', () => {
  const doubtCtx: DoubtContext = {
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

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  }

  /** A real handoff over the real typed tutor, speaking into a list. */
  function room(fallback = createStubAgent()) {
    const said: string[] = [];
    const recalls: string[] = [];
    const handoff = createHandoff({
      agent: createGeminiAgent({ student, fallback }),
      speak: async (text, onSaid) => {
        onSaid(text);
        said.push(text);
      },
      onPause() {},
      onResume() {},
      onRecall: (id) => void recalls.push(id),
    });
    return { handoff, said, recalls };
  }

  const llmCalls = (fetchMock: ReturnType<typeof vi.fn>): number =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/llm')).length;

  afterEach(() => vi.unstubAllGlobals());

  it('a working model: one opening line, no recall, and the model answers', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"say":"Each side has two.","recallBeatId":null,"done":false}' } }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const r = room();

    r.handoff.raiseHand(doubtCtx);
    await settle();
    expect(r.handoff.state).toBe('LIVE');
    expect(r.said).toEqual([entryLine(doubtCtx)]);
    expect(r.recalls).toEqual([]);
    expect(llmCalls(fetchMock)).toBe(0);

    r.handoff.sendUserText('why four?');
    await settle();
    expect(r.said).toEqual([entryLine(doubtCtx), 'Each side has two.']);
    expect(r.recalls).toEqual([]);
    expect(llmCalls(fetchMock)).toBe(1);
  });

  it('a failing model: the relief answers the question, with no second greeting', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const r = room(createStubAgent({ opening: false }));

    r.handoff.raiseHand(doubtCtx);
    await settle();
    r.handoff.sendUserText('why four?');
    await settle();

    expect(r.said).toHaveLength(2);
    expect(r.said[0]).toBe(entryLine(doubtCtx));
    expect(r.said[1]).toContain('Four chambers');
    expect(r.said.join(' ')).not.toMatch(/what would you like to ask/i);
    expect(r.said.join(' ')).not.toMatch(/trouble connecting/i);
    expect(r.recalls).toEqual([]);
  });

  it('a relief started once is the same relief on the next failure, not a new one', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const starts: string[] = [];
    const fallback = {
      start: () => {
        starts.push('start');
        return { sendUserText: () => {}, stop: () => {} };
      },
    };
    const session = createGeminiAgent({ student, fallback }).start(
      doubtCtx,
      { say: async () => {}, recall: () => {}, done: () => {} },
    );
    session.sendUserText('one');
    await settle();
    session.sendUserText('two');
    await settle();
    expect(starts).toEqual(['start']);
  });
});

/**
 * WHEN THE PROVIDER'S FILTER STOPS A TURN.
 *
 * The relay answers a policy stop as a 200 whose finish_reason is
 * 'content_filter'. This session used to parse that reply as a model answer:
 * it is not JSON, so the child heard "ask me once more, maybe in different
 * words" — an invitation to rephrase the very thing that was blocked — and the
 * blocked turn stayed in the history that every later turn sends again, so a
 * whole-prompt block would fire on every question after it.
 */
describe('a turn the provider filter stopped', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  }

  /** Answers /api/llm from a queue, and keeps every body it was sent. */
  function relayAnswering(...replies: unknown[]) {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (String(url).includes('/api/llm')) bodies.push(String(init.body));
      return { ok: true, status: 200, json: async () => replies.shift() };
    });
    return bodies;
  }

  const blocked = (content: string) => ({
    choices: [{ message: { content }, finish_reason: BLOCKED_FINISH }],
  });
  const answer = (say: string) => ({
    choices: [{ message: { content: JSON.stringify({ say, recallBeatId: null, done: false }) }, finish_reason: 'stop' }],
  });

  function session() {
    const said: string[] = [];
    let ended = 0;
    const s = createGeminiAgent({ student }).start(
      {
        lessonId: 'l1',
        beatId: 'chambers',
        beatTopic: 'Four chambers',
        transcriptSoFar: 'The heart is a pump.',
        visibleElementIds: [],
        recentBeats: [{ id: 'chambers', topic: 'Four chambers' }],
        outcomeIds: [],
      },
      {
        say: async (t: string) => void said.push(t),
        recall: () => {},
        done: () => {
          ended += 1;
        },
      },
    );
    return { s, said, ended: () => ended };
  }

  it('is the same line the relay answers with', () => {
    // Spelled in the app, because @ai-tutor/relay is server code the client
    // bundle does not import. This keeps the copy from drifting.
    expect(FILTERED_REPLY_LINE).toBe(BLOCKED_LINE);
  });

  it('says the steer-back line, not the "ask me again in other words" one, and never the filtered text', async () => {
    relayAnswering(blocked('PARTIAL TEXT THE FILTER STOPPED'));
    const r = session();
    r.s.sendUserText('the blocked question');
    await settle();

    expect(r.said).toEqual([FILTERED_REPLY_LINE]);
    expect(r.said).not.toContain(MALFORMED_REPLY_LINE);
    expect(r.said.join(' ')).not.toContain('PARTIAL TEXT');
  });

  it('leaves the doubt open, the way an off-limits question in ClassRoom does', async () => {
    relayAnswering(blocked(BLOCKED_LINE));
    const r = session();
    r.s.sendUserText('the blocked question');
    await settle();
    expect(r.ended()).toBe(0);
  });

  it('does not send the blocked turn, or the reply to it, with the next question', async () => {
    const bodies = relayAnswering(blocked('PARTIAL TEXT THE FILTER STOPPED'), answer('Each side has two.'));
    const r = session();
    r.s.sendUserText('the blocked question');
    await settle();
    r.s.sendUserText('why four chambers?');
    await settle();

    expect(bodies).toHaveLength(2);
    const second = JSON.parse(bodies[1]) as { messages: { role: string; content: string }[] };
    const sent = second.messages.filter((m) => m.role !== 'system');
    expect(sent).toEqual([{ role: 'user', content: 'why four chambers?' }]);
    expect(bodies[1]).not.toContain('the blocked question');
    expect(bodies[1]).not.toContain('PARTIAL TEXT');
    expect(r.said).toEqual([FILTERED_REPLY_LINE, 'Each side has two.']);
  });

  it('keeps the answered turns before it', async () => {
    const bodies = relayAnswering(answer('A pump.'), blocked(BLOCKED_LINE), answer('Two each side.'));
    const r = session();
    r.s.sendUserText('what is the heart?');
    await settle();
    r.s.sendUserText('the blocked question');
    await settle();
    r.s.sendUserText('why four?');
    await settle();

    const third = JSON.parse(bodies[2]) as { messages: { role: string; content: string }[] };
    expect(third.messages.filter((m) => m.role !== 'system').map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(bodies[2]).toContain('what is the heart?');
    expect(bodies[2]).not.toContain('the blocked question');
  });
});

/**
 * WHAT A TURN COST, WHEN THE REPLY SAYS.
 *
 * The relay passes Vertex's usageMetadata through as `usage`
 * (packages/relay/src/vertex.ts, toOpenAiReply). The transport used to drop
 * it. It is handed to `onUsage` per turn; nothing is invented when it is
 * absent.
 */
describe('token counts per turn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports prompt, output and thinking tokens from a Vertex-shaped usage block', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'hi' } }],
        usage: { promptTokenCount: 812, candidatesTokenCount: 41, thoughtsTokenCount: 230 },
      }),
    }));
    const seen: unknown[] = [];
    const send = createTransport({ student, onUsage: (u) => seen.push(u) });
    await send('SYS', [{ role: 'user', text: 'why?' }], new AbortController().signal);
    expect(seen).toEqual([{ prompt: 812, output: 41, thinking: 230 }]);
  });

  it('reads the OpenAI-shaped names too, and leaves out what is not there', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 90, completion_tokens: 12 },
      }),
    }));
    const seen: unknown[] = [];
    const send = createTransport({ student, onUsage: (u) => seen.push(u) });
    await send('SYS', [{ role: 'user', text: 'why?' }], new AbortController().signal);
    expect(seen).toEqual([{ prompt: 90, output: 12 }]);
  });

  /**
   * OpenRouter's thinking arrives INSIDE `completion_tokens`, itemised under
   * `completion_tokens_details.reasoning_tokens`. Vertex counts the two apart
   * (candidatesTokenCount excludes thoughtsTokenCount), so the OpenAI shape is
   * split the same way: thinking on its own, output without it.
   */
  it('splits OpenRouter reasoning tokens out of completion_tokens', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'hi' } }],
        usage: {
          prompt_tokens: 90,
          completion_tokens: 212,
          completion_tokens_details: { reasoning_tokens: 200 },
        },
      }),
    }));
    const seen: unknown[] = [];
    const send = createTransport({ student, onUsage: (u) => seen.push(u) });
    await send('SYS', [{ role: 'user', text: 'why?' }], new AbortController().signal);
    expect(seen).toEqual([{ prompt: 90, output: 12, thinking: 200 }]);
  });

  it('reports nothing when the reply carries no usage', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
    }));
    const seen: unknown[] = [];
    const send = createTransport({ student, onUsage: (u) => seen.push(u) });
    await send('SYS', [{ role: 'user', text: 'why?' }], new AbortController().signal);
    expect(seen).toEqual([]);
  });
});

/**
 * THE CHILD'S LANGUAGE, IN THE TYPED DOUBT TUTOR'S BRIEF.
 *
 * The class planner has always been told which language the student chose at
 * onboarding; the doubt tutor was not, so a Hinglish class could pause for a
 * raised hand and answer it in English. The workspace's `tutorLanguage()` is
 * read when each turn's prompt is built, and persona renders the same register
 * line the judge and the close carry.
 */
describe('the language the child chose', () => {
  const EMPTY_PROFILE = { name: null, klass: null, subjects: [], diagnostic: null, diagnosedAt: null };

  beforeEach(() => {
    localStorage.clear();
    profileStore.set({ ...EMPTY_PROFILE });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('briefs her in Hinglish for a child who chose Hinglish', () => {
    setTutorLanguage('hi-en');
    const p = buildDoubtSystemPrompt(ctx, { klass: 10 });
    expect(p).toContain(REGISTER['hi-en']);
    expect(p).not.toContain(REGISTER.en);
  });

  it('briefs her in plain English, with no Hinglish line, for a child who chose English', () => {
    setTutorLanguage('en');
    const p = buildDoubtSystemPrompt(ctx, { klass: 10 });
    expect(p).toContain(REGISTER.en);
    expect(p).not.toMatch(/hinglish/i);
  });

  it('keeps a language the caller already set, rather than overriding it', () => {
    // Whoever built the student context measured this; the workspace is only
    // the fallback for a context that does not carry one yet.
    setTutorLanguage('hi-en');
    const p = buildDoubtSystemPrompt(ctx, { klass: 10, language: 'en' });
    expect(p).toContain(REGISTER.en);
    expect(p).not.toContain(REGISTER['hi-en']);
  });

  it('sends the Hinglish brief on the wire, on the turn the child asks', async () => {
    setTutorLanguage('hi-en');
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (String(url).includes('/api/llm')) bodies.push(String(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"say":"Chaar chambers kyun?","recallBeatId":null,"done":false}' } }],
        }),
      };
    });
    const session = createGeminiAgent({ student }).start(ctx, {
      say: async () => {},
      recall: () => {},
      done: () => {},
    });
    session.sendUserText('chaar kyun?');
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(bodies).toHaveLength(1);
    const system = (JSON.parse(bodies[0]) as { messages: { role: string; content: string }[] }).messages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain(REGISTER['hi-en']);
  });
});

/**
 * A BOARD REPLY, SPOKEN STEP BY STEP (overnight review #30, #41).
 */
describe('a board reply', () => {
  afterEach(() => vi.unstubAllGlobals());
  // An earlier test leaves the workspace in Hinglish.
  beforeEach(() => setTutorLanguage('en'));
  const settleAll = async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  };
  const steps = JSON.stringify({ steps: [{ say: 'One.', ink: [] }, { say: 'Two.', ink: [] }, { say: 'Three.', ink: [] }], recallBeatId: null, done: false });
  const replying = () =>
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: steps }, finish_reason: 'stop' }] }),
    }));
  const board = (turn: () => unknown) => ({ turn, onScreen: () => ({}), holding: () => null }) as never;

  it('fetches the next sentence while the current one is being said', async () => {
    replying();
    const said: string[] = [];
    const primed: string[] = [];
    const lines = ['One.', 'Two.', 'Three.'].map((say) => ({ say, show: () => undefined }));
    const s = createGeminiAgent({ student: { klass: 10 } as never, board: board(() => ({ lines })) }).start(ctx, {
      say: async (t: string, o?: { onStart?: () => void }) => {
        said.push(t);
        o?.onStart?.();
      },
      recall: () => {},
      done: () => {},
      prime: (t: string) => void primed.push(t),
    });
    s.sendUserText('why four?');
    await settleAll();
    expect(said).toEqual(['One.', 'Two.', 'Three.']);
    expect(primed).toEqual(['Two.', 'Three.']);
  });

  it('a failure while speaking says the muddled line, not a second answer from the stand-in', async () => {
    replying();
    const said: string[] = [];
    const fallback = { start: () => ({ sendUserText: () => said.push('STAND-IN'), stop: () => {} }) };
    const s = createGeminiAgent({
      student: { klass: 10 } as never,
      fallback: fallback as never,
      board: board(() => {
        throw new RangeError('checker fault');
      }),
    }).start(ctx, { say: async (t: string) => void said.push(t), recall: () => {}, done: () => {} });
    s.sendUserText('why four?');
    await settleAll();
    expect(said).toEqual([MALFORMED_REPLY_LINE]);
  });
});

/** T5-lite: a slow reply gets her thinking-aloud line first; a quick one does not. */
describe('thinking out loud', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => setTutorLanguage('en'));
  const answerAfter = (ms: number) =>
    vi.stubGlobal('fetch', async () => {
      await new Promise((r) => setTimeout(r, ms));
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ say: 'Here is why.', recallBeatId: null, done: false }) }, finish_reason: 'stop' }] }),
      };
    });
  const run = async (ms: number) => {
    answerAfter(ms);
    const said: string[] = [];
    const s = createGeminiAgent({ student: { klass: 10 } as never, thinkingMs: 30 }).start(ctx, {
      say: async (t: string) => void said.push(t),
      recall: () => {},
      done: () => {},
    });
    s.sendUserText('why four chambers?');
    await new Promise((r) => setTimeout(r, ms + 80));
    return said;
  };

  it('says she is thinking when the reply is slow, then the reply', async () => {
    const said = await run(150);
    expect(said).toHaveLength(2);
    expect(said[0]).toMatch(/think|second|see/i);
    expect(said[1]).toBe('Here is why.');
  });

  it('says nothing extra when the reply is quick', async () => {
    const said = await run(0);
    expect(said).toEqual(['Here is why.']);
  });
});
