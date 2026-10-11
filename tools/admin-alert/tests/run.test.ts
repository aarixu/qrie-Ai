import { describe, expect, it } from 'vitest';
import { fetchSnapshot, runOnce, sendTelegram, type Env } from '../src/run.ts';
/** The error a promise rejects with; fails the test if it does not reject. */
async function failure(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a rejection');
}

const env: Env = {
  SUPABASE_URL: 'https://p.supabase.co/',
  SUPABASE_ANON_KEY: 'anon-key',
  ALERT_TOKEN: 'the-alert-token-that-must-not-be-sent-to-telegram',
  TELEGRAM_BOT_TOKEN: '123:bot-secret',
  TELEGRAM_CHAT_OPS: 'ops-chat',
  TELEGRAM_CHAT_SAFETY: 'safety-chat',
};

const SNAPSHOT = {
  at: 'now', halted: true, ceilingUnits: 50000, unitsToday: 0, newReports: 1, unsafeNewReports: 1,
  oldestNewReportMinutes: 10, pendingClasses: 0, relayEvents5m: 0, relayFailures5m: 0,
};

interface Call { url: string; body: Record<string, unknown>; headers: Record<string, string> }
function stub(handler: (url: string) => { ok: boolean; status: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = handler(url);
    return { ok: r.ok, status: r.status, json: async () => r.json };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('reading the snapshot', () => {
  it('calls the public function with the anon key and the token in the body', async () => {
    const { calls, fetchImpl } = stub(() => ({ ok: true, status: 200, json: SNAPSHOT }));
    expect(await fetchSnapshot(env, fetchImpl)).toEqual(SNAPSHOT);
    expect(calls[0].url).toBe('https://p.supabase.co/rest/v1/rpc/alert_snapshot');
    expect(calls[0].headers.apikey).toBe('anon-key');
    expect(calls[0].body).toEqual({ p_token: env.ALERT_TOKEN });
  });

  it('is null when the database cannot be reached or answers an error status', async () => {
    expect(await fetchSnapshot(env, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
    const { fetchImpl } = stub(() => ({ ok: false, status: 503 }));
    expect(await fetchSnapshot(env, fetchImpl)).toBeNull();
  });
});

describe('one run', () => {
  const START = 120 * 1000;

  it('sends the unsafe report to the safety chat and the stop to the ops chat, and never the token', async () => {
    const { calls, fetchImpl } = stub((url) => (url.includes('telegram') ? { ok: true, status: 200 } : { ok: true, status: 200, json: SNAPSHOT }));
    const { sent } = await runOnce(env, START, fetchImpl);
    expect(sent.map((a) => a.key).sort()).toEqual(['halted', 'unsafe-report']);
    const telegram = calls.filter((c) => c.url.includes('api.telegram.org'));
    expect(telegram).toHaveLength(2);
    const byChat = Object.fromEntries(telegram.map((c) => [c.body.chat_id as string, c.body.text as string]));
    expect(byChat['safety-chat']).toMatch(/^Qrie safety:/);
    expect(byChat['ops-chat']).toMatch(/^Qrie ops:/);
    for (const c of telegram) {
      expect(JSON.stringify(c.body)).not.toContain(env.ALERT_TOKEN);
      expect(c.url).toBe('https://api.telegram.org/bot123:bot-secret/sendMessage');
    }
  });

  it('sends nothing on a quiet platform', async () => {
    const { calls, fetchImpl } = stub(() => ({ ok: true, status: 200, json: { ...SNAPSHOT, halted: false, newReports: 0, unsafeNewReports: 0 } }));
    expect((await runOnce(env, START, fetchImpl)).sent).toEqual([]);
    expect(calls.filter((c) => c.url.includes('telegram'))).toHaveLength(0);
  });

  it("one chat refusing does not silence the other: every alert is tried, then the run still fails so the job turns red", async () => {
    const snapshot = { ...SNAPSHOT, unsafeNewReports: 0, newReports: 0, ceilingUnits: 100, unitsToday: 100, distressFlags: 1, distressWindowMinutes: 15 };
    for (const broken of ['safety-chat', 'ops-chat']) {
      const { calls, fetchImpl } = stub(() => ({ ok: true, status: 200, json: snapshot }));
      const refusing = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
        if (url.includes('telegram') && JSON.parse(init.body).chat_id === broken) {
          calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
          return { ok: false, status: 400, json: async () => ({}) };
        }
        return fetchImpl(url as unknown as RequestInfo, init as unknown as RequestInit);
      }) as unknown as typeof fetch;
      const err = await failure(runOnce(env, START, refusing));
      expect(err.message, broken).toBe('telegram refused the message (400)');
      const tried = calls.filter((c) => c.url.includes('telegram')).map((c) => c.body.chat_id);
      expect(tried, broken).toEqual(expect.arrayContaining(['safety-chat', 'ops-chat']));
      // halted, ceiling reached and the distress flag: three messages, each tried once.
      expect(tried, broken).toHaveLength(3);
    }
  });

  it('throws when a message cannot be sent, so the scheduled job turns red, without the bot token in the error', async () => {
    const { fetchImpl } = stub((url) => (url.includes('telegram') ? { ok: false, status: 401 } : { ok: true, status: 200, json: SNAPSHOT }));
    const err = await failure(runOnce(env, START, fetchImpl));
    expect(err.message).toBe('telegram refused the message (401)');
    expect(err.message).not.toContain('bot-secret');
    await expect(sendTelegram('t', 'c', 'x', stub(() => ({ ok: false, status: 400 })).fetchImpl)).rejects.toThrow(/400/);
  });
});
