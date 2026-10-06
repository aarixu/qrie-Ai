import { describe, expect, it } from 'vitest';
import { handleRelay, type HandlerDeps } from '../src/handler';
import { createMemoryLedger, type Gate } from '../src/gate';
import type { RelayRequest } from '../src/relays';
import { MAX_PICTURE_BYTES, MAX_REQUEST_BYTES } from '../src/vertex';

/**
 * A VISION CALL CARRIES A PICTURE, AND THE PICTURE IS NOT TEXT.
 *
 * The request ceiling was 256 KB for everything, and a picture the image model
 * draws is about 1.2 MB as the `data:` URL it arrives in. So every call that
 * looked at a generated picture to find its parts was refused with a 413, and
 * no part of any generated picture was ever found: a small-intestine class on
 * 2026-10-06 wrote "Microvilli", "Lacteal" and the rest beside its villus with
 * no line to anything. The ceiling is for billed TEXT; a picture is billed by
 * its tiles, not its bytes.
 */

const tokens = { token: async () => 'tok', projectId: 'proj-1' };

const reply = () =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"villus": null}' }] } }],
      usageMetadata: { promptTokenCount: 1300, candidatesTokenCount: 9 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const gate: Gate = {
  verify: async (h) => (h === 'Bearer good' ? { ok: true, user: { userId: 'student-1' } } : { ok: false, status: 401, why: 'no' }),
  ledger: createMemoryLedger(),
};

function setup() {
  const sent: string[] = [];
  const deps: HandlerDeps = {
    key: '',
    gate,
    vertex: {
      tokens,
      fetch: (async (_url: string, init: RequestInit) => {
        sent.push(String(init.body));
        return reply();
      }) as unknown as typeof fetch,
    },
  };
  return { deps, sent };
}

/** A `data:` URL of a picture `bytes` long, the way the image model returns one. */
const picture = (bytes: number): string => {
  const head = 'data:image/png;base64,';
  return head + 'A'.repeat(bytes - head.length);
};

const llm = (body: unknown): RelayRequest => ({
  method: 'POST',
  url: '/api/llm',
  headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
  body: new TextEncoder().encode(JSON.stringify(body)),
});

const look = (url: string, text = 'Find these parts:\n- villus') => ({
  model: 'google/gemini-3.7-flash',
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: 'You are looking at one picture.' },
    { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url } }] },
  ],
});

describe('the llm relay on Vertex, given a picture to look at', () => {
  it('takes a generated picture of 1.2 MB and sends it to the model', async () => {
    const { deps, sent } = setup();
    const out = await handleRelay(llm(look(picture(1_223_294))), deps);
    expect(out.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]).contents[0].parts[1].inline_data.mime_type).toBe('image/png');
  });

  it('still refuses text over the ceiling, with no picture', async () => {
    const { deps, sent } = setup();
    const out = await handleRelay(
      llm({ model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'x'.repeat(MAX_REQUEST_BYTES + 1) }] }),
      deps,
    );
    expect(out.status).toBe(413);
    expect(sent).toHaveLength(0);
  });

  it('refuses text over the ceiling even when a picture rides along', async () => {
    const { deps, sent } = setup();
    const out = await handleRelay(llm(look(picture(10_000), 'x'.repeat(MAX_REQUEST_BYTES + 1))), deps);
    expect(out.status).toBe(413);
    expect(sent).toHaveLength(0);
  });

  it('refuses a picture larger than any this app sends', async () => {
    const { deps, sent } = setup();
    const out = await handleRelay(llm(look(picture(MAX_PICTURE_BYTES + 1))), deps);
    expect(out.status).toBe(413);
    expect(sent).toHaveLength(0);
  });

  it('refuses a second picture: a look is at one picture', async () => {
    const { deps, sent } = setup();
    const two = look(picture(400_000));
    (two.messages[1].content as unknown[]).push({ type: 'image_url', image_url: { url: picture(400_000) } });
    const out = await handleRelay(llm(two), deps);
    expect(out.status).toBe(413);
    expect(sent).toHaveLength(0);
  });

  it('counts a data URL that is not a picture as text', async () => {
    const { deps, sent } = setup();
    const out = await handleRelay(
      llm(look(`data:text/plain;base64,${'A'.repeat(MAX_REQUEST_BYTES + 1)}`)),
      deps,
    );
    expect(out.status).toBe(413);
    expect(sent).toHaveLength(0);
  });
});
