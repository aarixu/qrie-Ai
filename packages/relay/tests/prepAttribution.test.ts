import { describe, expect, it } from 'vitest';
import { handleRelay } from '../src/handler';
import { createMemoryUsage, createSupabaseUsage } from '../src/usage';
import type { Gate } from '../src/gate';
import type { RelayRequest, RelayResponse } from '../src/relays';
import type { Verifier } from '../src/auth';

/**
 * S — HOW MANY STUDENTS SHARE ONE PREPARATION — CAN ONLY BE MEASURED IF THE
 * CALLS SAY WHICH PREPARATION THEY BELONG TO.
 *
 * 0018 poured usage_event.prep_id; this is the small seam that fills it: an
 * optional x-prep-id header, validated as a uuid and DROPPED otherwise,
 * because a header is browser input and browser input does not get to write
 * unvalidated bytes into the cost books.
 */

const USER = '11111111-2222-3333-4444-555555555555';
const PREP = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const yes: Verifier = async (header) =>
  header === 'Bearer good-token'
    ? { ok: true, user: { userId: USER } }
    : { ok: false, status: 401, why: 'that sign-in is not valid' };

const gate: Gate = {
  verify: yes,
  ledger: { async claim() { return { allowed: true }; } },
};

const llm = (headers: Record<string, string>): RelayRequest => ({
  method: 'POST',
  url: '/api/llm',
  headers: { authorization: 'Bearer good-token', ...headers },
  body: new TextEncoder().encode('{"model":"m"}'),
});

const deps = (usage: ReturnType<typeof createMemoryUsage>) => ({
  key: 'sk-test',
  gate,
  usage,
  transcribe: async (): Promise<RelayResponse> => {
    throw new Error('not this test');
  },
});

describe('the x-prep-id passthrough', () => {
  it('carries a valid uuid into the usage record', async () => {
    const usage = createMemoryUsage();
    await handleRelay(llm({ 'x-prep-id': PREP }), deps(usage));
    expect(usage.events).toHaveLength(1);
    expect(usage.events[0].prepId).toBe(PREP);
  });

  it('drops anything that is not a uuid, never trusting a header', async () => {
    const usage = createMemoryUsage();
    await handleRelay(llm({ 'x-prep-id': 'DROP TABLE usage_event' }), deps(usage));
    expect(usage.events[0].prepId).toBeNull();
  });

  it('is simply null when the header is absent', async () => {
    const usage = createMemoryUsage();
    await handleRelay(llm({}), deps(usage));
    expect(usage.events[0].prepId).toBeNull();
  });

  it('reaches Postgres as p_prep_id', async () => {
    let sent: Record<string, unknown> = {};
    const usage = createSupabaseUsage('https://x.supabase.co', 'service-key', async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    });
    await usage.record({
      userId: USER,
      sessionId: null,
      prepId: PREP,
      relay: 'llm',
      provider: 'vertex',
      model: 'gemini',
      status: 200,
    });
    expect(sent.p_prep_id).toBe(PREP);
  });

  it('omits the parameter entirely for the rows that have no preparation', async () => {
    let sent: Record<string, unknown> = {};
    const usage = createSupabaseUsage('https://x.supabase.co', 'service-key', async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    });
    await usage.record({
      userId: USER,
      sessionId: null,
      relay: 'speech',
      provider: 'openrouter',
      model: 'aura',
      status: 0,
      characters: 12,
    });
    /**
     * NOT `null` — absent. record_usage defaults p_prep_id, so leaving the
     * key out is the same row; what it buys is that the overwhelming
     * majority of usage calls still work against the PRE-0019 thirteen
     * argument function. A relay deployed ahead of its migration would
     * otherwise have every usage row refused with PGRST202 and swallowed.
     */
    expect('p_prep_id' in sent).toBe(false);
  });
});
