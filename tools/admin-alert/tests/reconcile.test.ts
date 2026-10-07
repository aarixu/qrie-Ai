import { afterEach, describe, expect, it, vi } from 'vitest';
import { askReconcile } from '../src/reconcile.ts';
import { runOnce, type Env } from '../src/run.ts';

/**
 * THE CHECKER ASKS BILLING-API TO RECONCILE. Written first.
 *
 * With BILLING_RECONCILE_TOKEN set, each run also asks billing-api's
 * /reconcile route; the database answers "not due" except once an hour. The
 * ask never throws and never shows its token, and a failed Telegram send does
 * not stop it.
 */

const RECONCILE = 'the-reconcile-token-that-must-not-be-printed';
const env: Env = {
  SUPABASE_URL: 'https://p.supabase.co/',
  SUPABASE_ANON_KEY: 'anon-key',
  ALERT_TOKEN: 'alert-token',
  TELEGRAM_BOT_TOKEN: '123:bot-secret',
  TELEGRAM_CHAT_OPS: 'ops-chat',
  TELEGRAM_CHAT_SAFETY: 'safety-chat',
};

const SNAPSHOT = {
  at: 'now', halted: true, ceilingUnits: 50000, unitsToday: 0, newReports: 0, unsafeNewReports: 0,
  oldestNewReportMinutes: 0, pendingClasses: 0, relayEvents5m: 0, relayFailures5m: 0,
};

interface Call { url: string; body: unknown; headers: Record<string, string> }
function stub(handler: (url: string) => { ok: boolean; status: number; json?: unknown } | Error) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = handler(url);
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status, json: async () => r.json };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('asking for reconciliation', () => {
  it('asks billing-api\'s reconcile route with the token as Bearer and the anon key as apikey', async () => {
    const { calls, fetchImpl } = stub(() => ({ ok: true, status: 200, json: { ran: true, checked: 2, changed: 1, failed: 0 } }));
    const r = await askReconcile({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: 'anon-key', BILLING_RECONCILE_TOKEN: RECONCILE }, fetchImpl);
    expect(r).toEqual({ ok: true, status: 200, ran: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://p.supabase.co/functions/v1/billing-api/reconcile');
    expect(calls[0].headers).toMatchObject({ authorization: `Bearer ${RECONCILE}`, apikey: 'anon-key', 'content-type': 'application/json' });
    expect(calls[0].body).toEqual({});
    const notDue = stub(() => ({ ok: true, status: 200, json: { ran: false } }));
    expect(await askReconcile({ ...env, BILLING_RECONCILE_TOKEN: RECONCILE }, notDue.fetchImpl)).toEqual({ ok: true, status: 200, ran: false });
  });

  it('never throws; a network error or a 500 comes back as ok false, and the token is in neither the result nor anything logged', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = stub(() => new Error(`connect ECONNREFUSED ${RECONCILE}`));
    const a = await askReconcile({ ...env, BILLING_RECONCILE_TOKEN: RECONCILE }, down.fetchImpl);
    expect(a).toEqual({ ok: false, status: 0, ran: null });
    const broken = stub(() => ({ ok: false, status: 500, json: { error: 'Something went wrong' } }));
    const b = await askReconcile({ ...env, BILLING_RECONCILE_TOKEN: RECONCILE }, broken.fetchImpl);
    expect(b).toEqual({ ok: false, status: 500, ran: null });
    const printed = [...log.mock.calls, ...error.mock.calls].flat().map(String).join(' ');
    expect(`${JSON.stringify([a, b])} ${printed}`).not.toContain(RECONCILE);
  });
});

describe('the run', () => {
  const START = 120 * 1000;

  it('runOnce asks once when the token is set, and not at all when it is not', async () => {
    const answer = (url: string) =>
      url.includes('billing-api') ? { ok: true, status: 200, json: { ran: false } } : url.includes('telegram') ? { ok: true, status: 200 } : { ok: true, status: 200, json: SNAPSHOT };
    const withToken = stub(answer);
    const r = await runOnce({ ...env, BILLING_RECONCILE_TOKEN: RECONCILE }, START, withToken.fetchImpl);
    expect(r.reconcile).toEqual({ ok: true, status: 200, ran: false });
    expect(withToken.calls.filter((c) => c.url.includes('billing-api'))).toHaveLength(1);
    const without = stub(answer);
    const s = await runOnce(env, START, without.fetchImpl);
    expect(s.reconcile).toBeNull();
    expect(without.calls.filter((c) => c.url.includes('billing-api'))).toHaveLength(0);
  });

  it('a failed Telegram send still lets the reconcile run, and the send\'s error still surfaces', async () => {
    const { calls, fetchImpl } = stub((url) =>
      url.includes('telegram')
        ? { ok: false, status: 401 }
        : url.includes('billing-api')
          ? { ok: true, status: 200, json: { ran: true } }
          : { ok: true, status: 200, json: SNAPSHOT },
    );
    await expect(runOnce({ ...env, BILLING_RECONCILE_TOKEN: RECONCILE }, START, fetchImpl)).rejects.toThrow(
      'telegram refused the message (401)',
    );
    expect(calls.filter((c) => c.url.includes('billing-api'))).toHaveLength(1);
  });
});
