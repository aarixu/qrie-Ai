import { describe, expect, it, vi } from 'vitest';
import { prepareClass } from '@ai-tutor/class-prep';
import {
  ALLOWED_MODELS,
  BLOCKED_LINE,
  CAP_OUTPUT_TOKENS,
  MAX_REQUEST_BYTES,
  SAFETY_SETTINGS,
  bareModel,
  completeOnVertex,
  inlineFromDataUrl,
  isImageModel,
  toOpenAiReply,
  toVertexBody,
  vertexUrl,
  type OpenAiReply,
} from '../src/vertex.ts';

/**
 * THE TRANSLATION THAT LETS THE APP NOT KNOW.
 *
 * apps/classroom posts OpenAI chat completions and reads choices[0].message.
 * Vertex takes `contents` and returns `candidates`. Every test here is about
 * that seam holding, because the alternative was changing the browser — and a
 * browser that knows which provider is behind it is a browser that will one
 * day be asked to hold the credential too.
 */

const tokens = { token: async () => 'tok', projectId: 'curie-credits' };

// ------------------------------------------------------------- the names --

describe('naming a model', () => {
  it('drops the provider prefix OpenRouter needs and Vertex refuses', () => {
    expect(bareModel('google/gemini-3.7-flash')).toBe('gemini-3.7-flash');
    expect(bareModel('gemini-3.7-flash')).toBe('gemini-3.7-flash');
  });

  it('knows an image model by its name, because the app cannot say so', () => {
    // createBrowserImageArtist posts one user message and nothing else, so
    // there is no flag to read. Without responseModalities Vertex writes a
    // DESCRIPTION of the picture — a failure that looks like success right up
    // to a blank board.
    expect(isImageModel('gemini-3.1-flash-image')).toBe(true);
    expect(isImageModel('gemini-3-pro-image')).toBe(true);
    expect(isImageModel('gemini-3.7-flash')).toBe(false);
    expect(isImageModel('gemini-3.1-flash-lite')).toBe(false);
  });

  it('builds the URL Vertex actually answered on', () => {
    // location=global, not a region: asia-south1 and us-central1 both 404 on
    // every one of these models.
    const url = vertexUrl('curie-credits', 'google/gemini-3.8-flash');
    expect(url).toContain('/projects/curie-credits/locations/global/');
    expect(url).toContain('/publishers/google/models/gemini-3.8-flash:generateContent');
  });
});

// ---------------------------------------------------------- the request ---

describe('turning a chat into a Vertex body', () => {
  it('lifts the system message out of the turns', () => {
    const body = toVertexBody({
      model: 'google/gemini-3.7-flash',
      messages: [
        { role: 'system', content: 'You are a tutor.' },
        { role: 'user', content: 'Teach me speed.' },
      ],
    });
    expect(body.systemInstruction?.parts).toEqual([{ text: 'You are a tutor.' }]);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Teach me speed.' }] }]);
  });

  it('says "model" where OpenAI says "assistant"', () => {
    const body = toVertexBody({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model']);
  });

  it('treats an unknown role as the student talking rather than dropping it', () => {
    const body = toVertexBody({ messages: [{ role: 'developer', content: 'note' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'note' }] }]);
  });

  it('carries a picture through as inline data', () => {
    const body = toVertexBody({
      model: 'google/gemini-3.7-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Is this a kidney?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAB' } },
          ],
        },
      ],
    });
    expect(body.contents[0].parts).toEqual([
      { text: 'Is this a kidney?' },
      { inline_data: { mime_type: 'image/png', data: 'AAAB' } },
    ]);
  });

  it('drops an image URL Vertex would not fetch anyway', () => {
    const body = toVertexBody({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image_url', image_url: { url: 'https://example.org/x.png' } },
          ],
        },
      ],
    });
    expect(body.contents[0].parts).toEqual([{ text: 'look' }]);
  });

  it('turns response_format into a JSON mime type', () => {
    const body = toVertexBody({
      model: 'google/gemini-3.7-flash',
      messages: [{ role: 'user', content: 'plan it' }],
      response_format: { type: 'json_object' },
    });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('asks an image model to draw, and never for JSON as well', () => {
    // A picture is not JSON, and asking for both gets a refusal.
    const body = toVertexBody({
      model: 'google/gemini-3.1-flash-image',
      messages: [{ role: 'user', content: 'a red circle' }],
      response_format: { type: 'json_object' },
    });
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });

  it('skips a message with nothing in it', () => {
    const body = toVertexBody({ messages: [{ role: 'user', content: '' }, { role: 'user', content: 'hi' }] });
    expect(body.contents).toHaveLength(1);
  });
});

describe('reading a data URL', () => {
  it('splits the mime type from the payload', () => {
    expect(inlineFromDataUrl('data:image/jpeg;base64,QUJD')).toEqual({
      inline_data: { mime_type: 'image/jpeg', data: 'QUJD' },
    });
  });

  it('is null for anything that is not one', () => {
    for (const url of ['https://x/y.png', 'data:image/png,notbase64', '', 'data:']) {
      expect(inlineFromDataUrl(url)).toBeNull();
    }
  });
});

// ----------------------------------------------------------- the reply ----

describe('turning a Vertex reply into the shape the app reads', () => {
  it('puts the text where choices[0].message.content is', () => {
    const out = toOpenAiReply(
      { candidates: [{ content: { parts: [{ text: '{"beats":[]}' }] }, finishReason: 'STOP' }] },
      'google/gemini-3.7-flash',
    );
    expect(out.choices[0].message.content).toBe('{"beats":[]}');
    expect(out.choices[0].finish_reason).toBe('stop');
  });

  it('joins parts, because a long reply arrives in several', () => {
    const out = toOpenAiReply(
      { candidates: [{ content: { parts: [{ text: 'one ' }, { text: 'two' }] } }] },
      'm',
    );
    expect(out.choices[0].message.content).toBe('one two');
  });

  it('rebuilds a drawn picture as the data URL the artist expects', () => {
    const out = toOpenAiReply(
      { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAB' } }] } }] },
      'google/gemini-3.1-flash-image',
    );
    expect(out.choices[0].message.images?.[0].image_url.url).toBe('data:image/png;base64,AAAB');
  });

  it('leaves images off entirely when nothing was drawn', () => {
    // The artist reads images?.[0] and treats absent as "no picture", which is
    // a class with one fewer picture rather than a failure.
    const out = toOpenAiReply({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }, 'm');
    expect(out.choices[0].message.images).toBeUndefined();
  });

  it('carries the token usage through', () => {
    const out = toOpenAiReply(
      { candidates: [{ content: { parts: [{ text: 'x' }] } }], usageMetadata: { totalTokenCount: 42 } },
      'm',
    );
    expect(out.usage).toEqual({ totalTokenCount: 42 });
  });

  it('survives a reply with no candidates at all', () => {
    const out = toOpenAiReply({}, 'm');
    expect(out.choices[0].message.content).toBe('');
  });
});

// ------------------------------------------------------------ end to end --

describe('completeOnVertex', () => {
  const reply = (value: unknown, ok = true, status = 200) =>
    ({ ok, status, json: async () => value }) as unknown as Response;

  it('sends a bearer token and returns the app-shaped answer', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return reply({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    });

    const out = await completeOnVertex(
      { model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] },
      { tokens, fetch: fetchMock as never },
    );

    expect((seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(seen[0].url).toContain('gemini-3.7-flash:generateContent');
    expect((out.body as { choices: { message: { content: string } }[] }).choices[0].message.content).toBe('ok');
  });

  it('answers an auth failure as a 502 that says which half broke', async () => {
    // A credential problem is ours, not the caller's, and "Vertex 401" would
    // send somebody looking at the wrong service.
    const out = await completeOnVertex(
      { model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] },
      {
        tokens: { projectId: 'p', token: async () => { throw new Error('bad private_key'); } },
        fetch: (async () => reply({})) as never,
      },
    );
    expect(out.status).toBe(502);
    expect(String((out.body as { error: { message: string } }).error.message)).toMatch(/Google auth failed.*private_key/);
  });

  it('passes an upstream error through in the shape the browser reads', async () => {
    const out = await completeOnVertex(
      { model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] },
      {
        tokens,
        fetch: (async () => reply({ error: { message: 'quota exceeded' } }, false, 429)) as never,
        sleep: async () => undefined,
      },
    );
    expect(out.status).toBe(429);
    expect((out.body as { error: { message: string } }).error.message).toBe('quota exceeded');
  });

  /**
   * WAITING OUT A BUSY QUOTA, WHICH THIS RELAY USED NOT TO DO.
   *
   * A 429 from Vertex is RESOURCE_EXHAUSTED — the request never reached a
   * model and nothing was charged for it. Handing it to the student meant a
   * class prep died on a busy minute having already paid for everything before
   * the failure, which is exactly how the first cost measurement of this
   * product ended.
   */
  describe('when Vertex is busy', () => {
    const flaky = (failures: number, status = 429) => {
      let calls = 0;
      const fn = vi.fn(async () => {
        calls += 1;
        return calls <= failures
          ? reply({ error: { message: 'RESOURCE_EXHAUSTED' } }, false, status)
          : reply({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
      });
      return { fn, calls: () => calls };
    };

    it('waits and tries again rather than failing the class', async () => {
      const { fn, calls } = flaky(2);
      const slept: number[] = [];
      const out = await completeOnVertex(
        { model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] },
        { tokens, fetch: fn as never, sleep: async (ms) => void slept.push(ms) },
      );
      expect(out.status).toBe(200);
      expect(calls()).toBe(3);
      // Backing off, not hammering.
      expect(slept).toEqual([1_000, 3_000]);
    });

    it('gives up rather than holding a student on a spinner forever', async () => {
      const { fn, calls } = flaky(99);
      const out = await completeOnVertex(
        { model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] },
        { tokens, fetch: fn as never, sleep: async () => undefined },
      );
      expect(out.status).toBe(429);
      expect(calls()).toBe(3);
    });

    it("takes the advice Vertex gives, but not more than five seconds of it", async () => {
      const slept: number[] = [];
      let calls = 0;
      const fn = vi.fn(async () => {
        calls += 1;
        return {
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h === 'retry-after' ? '60' : null) },
          json: async () => ({ error: { message: 'slow down' } }),
        } as unknown as Response;
      });
      await completeOnVertex(
        { model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] },
        { tokens, fetch: fn as never, sleep: async (ms) => void slept.push(ms) },
      );
      // A minute is Vertex protecting itself; five seconds is us protecting
      // the student, who would have closed the tab long before.
      expect(slept).toEqual([5_000, 5_000]);
    });

    it('does not retry a refusal that would be refused again', async () => {
      // 400 means the request is wrong. Sending it twice more is just slower.
      let calls = 0;
      const fn = vi.fn(async () => {
        calls += 1;
        return reply({ error: { message: 'bad request' } }, false, 400);
      });
      const out = await completeOnVertex(
        { model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] },
        { tokens, fetch: fn as never, sleep: async () => undefined },
      );
      expect(out.status).toBe(400);
      expect(calls).toBe(1);
    });
  });

  it('refuses a request that named no model', async () => {
    const out = await completeOnVertex({ messages: [] }, { tokens, fetch: (async () => reply({})) as never });
    expect(out.status).toBe(400);
  });
});

// -------------------------------------------------- what a caller may ask --

describe('what this relay will spend on', () => {
  const reply = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as unknown as Response;
  const ask = (model: string) =>
    completeOnVertex(
      { model, messages: [{ role: 'user', content: 'hi' }] },
      { tokens, fetch: (async () => reply({ candidates: [] })) as never },
    );

  it('serves the four models the app actually names', async () => {
    for (const model of ALLOWED_MODELS) {
      expect((await ask(`google/${model}`)).status).toBe(200);
    }
  });

  it('refuses a model the app never names', async () => {
    /**
     * The model comes out of a request body, and the request body comes out of
     * a student's phone. gemini-3-pro-image takes thirty-one seconds and bills
     * like it; a pro model bills several times a flash one; and an anonymous
     * identity costs nothing to make.
     */
    for (const model of ['gemini-3-pro-image', 'gemini-3.1-pro-preview', 'gemini-2.5-pro']) {
      const out = await ask(`google/${model}`);
      expect(out.status).toBe(400);
      expect(String((out.body as { error: { message: string } }).error.message)).toContain('does not serve');
    }
  });

  it('caps the output whether or not the caller asked for one', () => {
    // The OpenRouter path has capped this since a batch of lesson prep died on
    // it. The Vertex path was written without the cap and put it straight back.
    expect(toVertexBody({ model: 'gemini-3.7-flash', messages: [] }).generationConfig.maxOutputTokens)
      .toBe(CAP_OUTPUT_TOKENS);
  });

  it('does not let a caller ask for more than the cap', () => {
    const asked = toVertexBody({
      model: 'gemini-3.7-flash',
      messages: [],
      max_tokens: 1_000_000,
    });
    expect(asked.generationConfig.maxOutputTokens).toBe(CAP_OUTPUT_TOKENS);
  });

  it('honours a smaller request', () => {
    const asked = toVertexBody({ model: 'gemini-3.7-flash', messages: [], max_tokens: 500 });
    expect(asked.generationConfig.maxOutputTokens).toBe(500);
  });

  it('has a request ceiling above every prompt this app builds', () => {
    // A planner prompt is a few thousand tokens; a vision call carries a
    // picture. Both sit well inside this.
    expect(MAX_REQUEST_BYTES).toBeGreaterThan(200_000);
  });
});

/**
 * THINKING TOKENS BILL AT THE OUTPUT RATE, AND NOBODY READS THEM.
 *
 * Measured over one real class: the judge spent 2,460 prompt tokens, 296
 * output tokens and 2,353 THINKING tokens deciding whether four spoken answers
 * matched a known option. Three quarters of that bill bought reasoning the
 * student never hears, on a question with four printed options.
 *
 * The relay had no way to say so. It does now, in OpenAI's vocabulary, because
 * that is the shape every caller here already speaks.
 */
describe('how hard the model is asked to think', () => {
  const bodyFor = (chat: Parameters<typeof toVertexBody>[0]) =>
    toVertexBody(chat).generationConfig as {
      thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number };
    };

  it('says nothing at all when the caller did not ask', () => {
    // The important half. A model told to think MINIMAL when nobody asked
    // would be a silent change to every answer this relay has ever given.
    expect(bodyFor({ model: 'google/gemini-3.7-flash', messages: [] }).thinkingConfig).toBeUndefined();
  });

  /**
   * GEMINI 3 RENAMED THE DIAL, AND SENDING BOTH IS AN ERROR.
   *
   * This sent `thinkingBudget`, the 2.5-era integer scale, to models that are
   * all 3.x — and Google documents a Gemini 3 model as taking `thinkingLevel`
   * and REFUSING a request carrying both. Which is why the one thing a budget
   * of zero could not do here was stop the spending: measured,
   * `thinkingBudget: 0` on gemini-3.7-flash still produced 5,724 thinking
   * tokens across 72 answers, down from 12,030 rather than to none.
   */
  it('asks a Gemini 3 model for a LEVEL, which is the dial it actually has', () => {
    expect(bodyFor({ model: 'google/gemini-3.8-flash', messages: [], reasoning_effort: 'none' }).thinkingConfig)
      .toEqual({ thinkingLevel: 'LOW' });
  });

  /**
   * MINIMAL IS DOCUMENTED AND IT IS NOT THERE.
   *
   * Google lists MINIMAL for Gemini 3 Flash. Vertex, asked for it on this
   * project on 2026-09-14, answered 400 "Thinking level is unsupported:
   * THINKING_LEVEL_MINIMAL" on 3.7-flash and on 3.8-flash alike. Sending it
   * would not be a cheaper setting, it would be an outage: the class swallows
   * a failed judge on purpose, so every spoken answer would go unjudged and
   * silent, which is the exact defect this repo shipped once already.
   */
  it('never asks for MINIMAL, which Vertex refuses outright', () => {
    for (const m of ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite']) {
      for (const e of ['none', 'low', 'medium', 'high'] as const) {
        expect(
          bodyFor({ model: `google/${m}`, messages: [], reasoning_effort: e }).thinkingConfig?.thinkingLevel,
          `${m} at ${e}`,
        ).not.toBe('MINIMAL');
      }
    }
  });

  it('never sends a Gemini 3 model both, because that is refused outright', () => {
    for (const m of ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite']) {
      const cfg = bodyFor({ model: `google/${m}`, messages: [], reasoning_effort: 'none' }).thinkingConfig;
      expect(cfg, m).toHaveProperty('thinkingLevel');
      expect(cfg, m).not.toHaveProperty('thinkingBudget');
    }
  });

  it('keeps the integer scale for a name from before the rename', () => {
    // Nothing in ALLOWED_MODELS is one today. It is here so pointing this
    // relay at a 2.5-era name later does not silently send the wrong dial.
    expect(bodyFor({ model: 'google/gemini-2.5-flash', messages: [], reasoning_effort: 'none' }).thinkingConfig)
      .toEqual({ thinkingBudget: 0 });
  });

  it('carries the tiers between', () => {
    const at = (e: 'low' | 'medium' | 'high') =>
      bodyFor({ model: 'google/gemini-3.8-flash', messages: [], reasoning_effort: e }).thinkingConfig?.thinkingLevel;
    expect(at('low')).toBe('LOW');
    expect(at('medium')).toBe('MEDIUM');
    expect(at('high')).toBe('HIGH');
  });

  it('ignores a word it does not know rather than guessing a budget', () => {
    expect(
      bodyFor({ model: 'google/gemini-3.7-flash', messages: [], reasoning_effort: 'enormous' as never })
        .thinkingConfig,
    ).toBeUndefined();
  });
})

/**
 * THE PROVIDER'S OWN HARM FILTERS, AND WHAT A CHILD HEARS WHEN ONE FIRES.
 *
 * Nothing here named a safety setting, so every call ran at whatever Vertex's
 * default is for that model — a setting nobody in this repo chose or can
 * point to. The live voice path chose BLOCK_ONLY_HIGH on purpose
 * (apps/classroom/src/lib/liveAgent.ts, buildSetupFrame) and this is the same
 * choice, made for the same syllabus, on the path most of a class runs on.
 */
describe("the provider's own harm filters", () => {
  const CATEGORIES = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ];

  it('names all four categories, at BLOCK_ONLY_HIGH, for every model this relay serves', () => {
    // The image model included: a picture drawn for a child is exactly where
    // SEXUALLY_EXPLICIT has to be on.
    for (const model of ALLOWED_MODELS) {
      const body = toVertexBody({ model: `google/${model}`, messages: [{ role: 'user', content: 'hi' }] });
      expect(body.safetySettings, model).toEqual(
        CATEGORIES.map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
      );
    }
  });

  it('is no stricter than BLOCK_ONLY_HIGH, because the syllabus is not a general audience', () => {
    // Reproduction, the nervous system, alcohol and two world wars are Class
    // 10 chapters. A stricter threshold refuses the lesson, not the harm.
    for (const s of SAFETY_SETTINGS) {
      expect(['BLOCK_LOW_AND_ABOVE', 'BLOCK_MEDIUM_AND_ABOVE']).not.toContain(s.threshold);
      // ...and never off.
      expect(['BLOCK_NONE', 'OFF']).not.toContain(s.threshold);
    }
  });

  it('puts them on the wire, not just on the body', async () => {
    let sent: { safetySettings?: unknown } = {};
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ candidates: [] }) } as unknown as Response;
    });
    await completeOnVertex(
      { model: 'google/gemini-3.8-flash', messages: [{ role: 'user', content: 'hi' }] },
      { tokens, fetch: fetchMock as never },
    );
    expect(sent.safetySettings).toEqual(SAFETY_SETTINGS);
  });

  it('hands each body its own copy, so one caller cannot loosen the next', () => {
    const first = toVertexBody({ model: 'gemini-3.7-flash', messages: [] });
    first.safetySettings[0].threshold = 'BLOCK_NONE';
    expect(toVertexBody({ model: 'gemini-3.7-flash', messages: [] }).safetySettings[0].threshold)
      .toBe('BLOCK_ONLY_HIGH');
  });
});

describe('when a filter fires', () => {
  const content = (out: OpenAiReply) => out.choices[0].message.content;
  const answering = (value: unknown) =>
    (async () => ({ ok: true, status: 200, json: async () => value }) as unknown as Response) as never;

  it('speaks the fixed line, never the half-written reply the filter stopped', () => {
    // Vertex can return the text it had written before the stop. That text is
    // precisely the part a filter judged unfit for a child.
    const out = toOpenAiReply(
      {
        candidates: [
          { content: { parts: [{ text: 'Here is the part the filter stopped' }] }, finishReason: 'SAFETY' },
        ],
      },
      'google/gemini-3.7-flash',
    );
    expect(content(out)).toBe(BLOCKED_LINE);
    expect(content(out)).not.toContain('filter stopped');
  });

  it("says so in OpenAI's own word, so a client can tell a block from an answer", () => {
    const out = toOpenAiReply({ candidates: [{ finishReason: 'SAFETY' }] }, 'm');
    expect(out.choices[0].finish_reason).toBe('content_filter');
  });

  it('treats a refused PROMPT the same way, which arrives with no candidate at all', () => {
    // A blocked prompt is a 200 with promptFeedback and nothing else. Before
    // this it read as an empty reply, which createBrowserLlm throws on as
    // "The model replied with nothing".
    const out = toOpenAiReply({ promptFeedback: { blockReason: 'SAFETY' } }, 'm');
    expect(content(out)).toBe(BLOCKED_LINE);
    expect(out.choices[0].finish_reason).toBe('content_filter');
  });

  it('covers the policy stops that are not called SAFETY', () => {
    for (const finishReason of ['PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']) {
      const out = toOpenAiReply({ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason }] }, 'm');
      expect(content(out), finishReason).toBe(BLOCKED_LINE);
      expect(out.choices[0].finish_reason, finishReason).toBe('content_filter');
    }
    for (const blockReason of ['OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT']) {
      expect(content(toOpenAiReply({ promptFeedback: { blockReason } }, 'm')), blockReason).toBe(BLOCKED_LINE);
    }
  });

  it('passes no picture through from a stopped image call', () => {
    const out = toOpenAiReply(
      {
        candidates: [
          {
            content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAB' } }] },
            finishReason: 'IMAGE_SAFETY',
          },
        ],
      },
      'google/gemini-3.1-flash-image',
    );
    // The artist reads images?.[0] and takes absent as "one fewer picture".
    expect(out.choices[0].message.images).toBeUndefined();
  });

  it('keeps the usage, so a blocked call is still on the books', () => {
    const out = toOpenAiReply(
      { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 812 } },
      'm',
    );
    expect(out.usage).toEqual({ promptTokenCount: 812 });
  });

  it('leaves an ordinary stop alone', () => {
    // RECITATION is Google's copyright stop, not a harm filter, and a reply
    // cut at the token cap is an answer that ran long. Neither is a block.
    const long = toOpenAiReply(
      { candidates: [{ content: { parts: [{ text: 'a b' }] }, finishReason: 'MAX_TOKENS' }] },
      'm',
    );
    expect(content(long)).toBe('a b');
    expect(long.choices[0].finish_reason).toBe('max_tokens');
    const recited = toOpenAiReply(
      { candidates: [{ content: { parts: [{ text: 'c' }] }, finishReason: 'RECITATION' }] },
      'm',
    );
    expect(recited.choices[0].finish_reason).toBe('recitation');
    // An unspecified prompt verdict is not a verdict.
    const unspecified = toOpenAiReply(
      {
        promptFeedback: { blockReason: 'BLOCKED_REASON_UNSPECIFIED' },
        candidates: [{ content: { parts: [{ text: 'd' }] } }],
      },
      'm',
    );
    expect(content(unspecified)).toBe('d');
  });

  it('answers 200 end to end, in the shape the browser already reads', async () => {
    const out = await completeOnVertex(
      { model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] },
      { tokens, fetch: answering({ candidates: [{ finishReason: 'SAFETY' }] }) },
    );
    expect(out.status).toBe(200);
    expect(content(out.body as OpenAiReply)).toBe(BLOCKED_LINE);
    expect((out.body as OpenAiReply).choices[0].finish_reason).toBe('content_filter');
  });

  /**
   * A JSON CALLER MUST FAIL CLEANLY ON THE LINE, NOT CRASH AND NOT KEEP IT.
   *
   * The planner asks for `json_object` and gets this line back like any other
   * text. It must never parse as a plan — a lesson built out of it would be
   * kept and served to every later student on that topic — and it must not
   * throw anything stranger than prep already throws on a garbled plan.
   */
  it('reads as no plan at all to the class planner, which asks once more and then gives up plainly', async () => {
    const blocked = await completeOnVertex(
      {
        model: 'google/gemini-3.7-flash',
        messages: [{ role: 'user', content: 'plan it' }],
        response_format: { type: 'json_object' },
      },
      { tokens, fetch: answering({ candidates: [{ finishReason: 'SAFETY' }] }) },
    );
    const line = content(blocked.body as OpenAiReply);
    expect(line).toBe(BLOCKED_LINE);
    // No brace anywhere: parsePlan and parseVerdict both rescue JSON by
    // slicing between the outermost braces, and there must be nothing to slice.
    expect(line).not.toMatch(/[{}]/);

    let asked = 0;
    const planner = {
      complete: async () => {
        asked += 1;
        return line;
      },
    };
    const artist = {
      complete: async (): Promise<string> => {
        throw new Error('the artist is never reached');
      },
    };
    await expect(prepareClass({ topic: 'How do organisms reproduce?', klass: 10, planner, artist }))
      .rejects.toThrow('The planner did not return readable JSON, twice.');
    expect(asked).toBe(2);
  });
});
