import { describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_MODELS,
  CAP_OUTPUT_TOKENS,
  MAX_REQUEST_BYTES,
  bareModel,
  completeOnVertex,
  inlineFromDataUrl,
  isImageModel,
  toOpenAiReply,
  toVertexBody,
  vertexUrl,
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
      },
    );
    expect(out.status).toBe(429);
    expect((out.body as { error: { message: string } }).error.message).toBe('quota exceeded');
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
