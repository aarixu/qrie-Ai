import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { sendRelayResponse } from '../src/node';
import { fail } from '../src/relays';

/**
 * THE DEV ADAPTER MUST CARRY WHAT THE DECISION DECIDED.
 *
 * `npm run dev` and the deployed Edge Function run the same handleRelay, and
 * the whole value of that is that what a developer exercises every day is
 * what faces the internet. It stops being true the moment an adapter drops
 * part of the answer: this one set content-type and nothing else on every
 * JSON response, so `retry-after` — the one thing a client can actually act
 * on after a 429 or a 503 — never arrived in dev at all.
 *
 * Three contracts now put that header in writing (an OTP flood, an
 * unreachable prep store, every admit refusal), so a client written to
 * honour it has to be testable against the dev server.
 */

const stub = () => {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    end(body?: string) {
      (this as { body?: string }).body = body;
    },
  };
  return { res: res as unknown as ServerResponse, headers, sent: res as { body?: string; statusCode: number } };
};

describe('sendRelayResponse, for JSON answers', () => {
  it('carries every header the decision set, not just the content type', async () => {
    const out = fail(429, 'that is a lot of codes — please wait a little and try again');
    out.headers['retry-after'] = '600';

    const { res, headers, sent } = stub();
    await sendRelayResponse(res, out);

    expect(sent.statusCode).toBe(429);
    expect(headers['retry-after']).toBe('600');
    expect(headers['content-type']).toBe('application/json');
  });

  it('still says application/json when the decision named no content type', async () => {
    const { res, headers, sent } = stub();
    await sendRelayResponse(res, {
      status: 202,
      headers: {},
      body: { kind: 'json', value: { id: 'abc' } },
    });

    expect(sent.statusCode).toBe(202);
    expect(headers['content-type']).toBe('application/json');
    expect(sent.body).toBe(JSON.stringify({ id: 'abc' }));
  });
});
