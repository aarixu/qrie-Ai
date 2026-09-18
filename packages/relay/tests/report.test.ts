import { describe, expect, it } from 'vitest';
import { handleRelay, routeFor } from '../src/handler';
import {
  MAX_REPORT_NOTE_CHARS,
  createMemoryReportStore,
  createSupabaseReportStore,
  readStudentReport,
  sendReportAlert,
  type ReportAlert,
} from '../src/report';
import type { Gate } from '../src/gate';
import type { RelayRequest, RelayResponse } from '../src/relays';
import type { Verifier } from '../src/auth';

/**
 * SAFETY #4: A CHILD'S REPORT MUST REACH A PERSON.
 *
 * Until this route existed, ReportSheet wrote localStorage and nothing left
 * the phone — a report button that filed complaints into a drawer nobody
 * opens. Everything here is about one property: an authenticated child who
 * taps "report" produces a row a person can read, exactly once, and a
 * refusal never loses the report silently because the client keeps its local
 * copy regardless.
 */

const USER = '11111111-2222-3333-4444-555555555555';

const yes: Verifier = async (header) =>
  header === 'Bearer good-token'
    ? { ok: true, user: { userId: USER } }
    : { ok: false, status: 401, why: 'that sign-in is not valid' };

const gate = (over: Partial<Gate> = {}): Gate => ({
  verify: yes,
  ledger: { async claim() { return { allowed: true }; } },
  ...over,
});

const report = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'unsafe',
  note: 'the tutor said something that scared me',
  lessonId: 'heredity-1',
  at: '2026-09-18T05:00:00.000Z',
  ...over,
});

const post = (value: unknown, over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url: '/api/report',
  headers: { authorization: 'Bearer good-token' },
  body: new TextEncoder().encode(JSON.stringify(value)),
  ...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
  key: 'sk-test',
  gate: gate(),
  transcribe: async (): Promise<RelayResponse> => {
    throw new Error('the transcriber has no business in a report');
  },
  ...over,
});

const bodyOf = (out: RelayResponse): Record<string, unknown> =>
  out.body.kind === 'json' ? (out.body.value as Record<string, unknown>) : {};

describe('routeFor', () => {
  it('names the report route from either host prefix', () => {
    expect(routeFor('/api/report')).toBe('report');
    expect(routeFor('/relay/report')).toBe('report');
    expect(routeFor('https://x.supabase.co/functions/v1/relay/report')).toBe('report');
  });

  it('has no opinion about a path it does not serve', () => {
    expect(routeFor('/api/reportage')).toBeNull();
    expect(routeFor('/api/llm')).toBeNull();
  });
});

describe('readStudentReport', () => {
  const decode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  it('accepts the shape the client sends', () => {
    const read = readStudentReport(decode(report({ beatId: 'b3', spokenLine: 'a line', topicRef: 'a/b/c' })));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.kind).toBe('unsafe');
    expect(read.value.beatId).toBe('b3');
  });

  /**
   * THE PAYLOAD BOTH PRD COPIES AGREE ON, every nullable field actually
   * null. This is what a report made outside a topic looks like — from Home,
   * from the Help screen — and the route used to answer it with a permanent
   * 400 on the Safety #4 path, because topicRef alone refused a null its
   * four siblings all accepted. Nobody sent it in a test, so nothing caught
   * it.
   */
  it('accepts the agreed payload with every nullable field null', () => {
    const read = readStudentReport(
      decode({
        kind: 'unsafe',
        note: 'she said something that scared me',
        lessonId: 'heredity-1',
        topicRef: null,
        beatId: null,
        spokenLine: null,
        sessionId: null,
        release: 'abc1234',
        platform: 'web',
        at: '2026-09-18T05:00:00.000Z',
      }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.topicRef).toBeNull();
    expect(read.value.platform).toBe('web');
  });

  it('carries topicRef as null when the client omits it entirely', () => {
    const read = readStudentReport(decode(report()));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.topicRef).toBeNull();
  });

  it('still refuses a topicRef that is neither text nor null', () => {
    expect(readStudentReport(decode(report({ topicRef: 42 }))).ok).toBe(false);
  });

  it('refuses a platform that is not one of the two the column holds', () => {
    // 0019 puts the same check on the column. Refused here with a 400 the
    // client can act on, rather than by Postgres with a 503 it cannot.
    expect(readStudentReport(decode(report({ platform: 'ios' }))).ok).toBe(false);
    expect(readStudentReport(decode(report({ platform: 'android' }))).ok).toBe(true);
  });

  it('refuses a kind it has never heard of', () => {
    const read = readStudentReport(decode(report({ kind: 'meh' })));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.response.status).toBe(400);
  });

  it('refuses a note past the cap rather than truncating a child mid-sentence', () => {
    const read = readStudentReport(decode(report({ note: 'x'.repeat(MAX_REPORT_NOTE_CHARS + 1) })));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.response.status).toBe(413);
  });

  it('accepts a note exactly at the cap', () => {
    expect(readStudentReport(decode(report({ note: 'x'.repeat(MAX_REPORT_NOTE_CHARS) }))).ok).toBe(true);
  });

  it('refuses a report with no lesson or no readable time, which the dedupe key needs', () => {
    expect(readStudentReport(decode(report({ lessonId: '' }))).ok).toBe(false);
    expect(readStudentReport(decode(report({ at: 'not a time' }))).ok).toBe(false);
  });

  it('drops a malformed sessionId instead of losing the report over telemetry', () => {
    // sessionId is attribution, not the child's words. REJECT-never-sanitise
    // is about content; refusing the whole report because a client bug
    // mangled a uuid would defeat the route's one purpose.
    const read = readStudentReport(decode(report({ sessionId: 'not-a-uuid' })));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.sessionId).toBeNull();
  });

  it('refuses what is not JSON at all', () => {
    expect(readStudentReport(new TextEncoder().encode('<xml/>')).ok).toBe(false);
  });
});

describe('POST /api/report through handleRelay', () => {
  it('reaches the store only after the caller is admitted', async () => {
    const store = createMemoryReportStore();
    const out = await handleRelay(post(report(), { headers: {} }), deps({ reports: store }));
    expect(out.status).toBe(401);
    expect(store.kept).toHaveLength(0);
  });

  it('says plainly when this host cannot take a report', async () => {
    expect((await handleRelay(post(report()), deps())).status).toBe(501);
  });

  it('answers 202 with the id of the kept report', async () => {
    const store = createMemoryReportStore();
    const out = await handleRelay(post(report()), deps({ reports: store }));
    expect(out.status).toBe(202);
    expect(typeof bodyOf(out).id).toBe('string');
    expect(store.kept).toHaveLength(1);
    expect(store.kept[0].userId).toBe(USER);
  });

  it('is idempotent on (user, lesson, beat, at) — a retried POST is the same report', async () => {
    const store = createMemoryReportStore();
    const first = await handleRelay(post(report({ beatId: 'b2' })), deps({ reports: store }));
    const second = await handleRelay(post(report({ beatId: 'b2' })), deps({ reports: store }));
    expect(bodyOf(second).id).toBe(bodyOf(first).id);
    expect(store.kept).toHaveLength(1);

    const third = await handleRelay(post(report({ beatId: 'b3' })), deps({ reports: store }));
    expect(bodyOf(third).id).not.toBe(bodyOf(first).id);
    expect(store.kept).toHaveLength(2);
  });

  it('alerts a person ONCE for a report, however many times the client retries', async () => {
    // The alert is the only thing that says a report exists. A client
    // retrying through a flaky connection writes one row and must not knock
    // five times, or the channel is one somebody mutes.
    const posted: unknown[] = [];
    const store = createMemoryReportStore();
    const webhookDeps = deps({
      reports: store,
      opsAlertWebhook: 'https://ops.example/hook',
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: { body?: unknown }) => {
      posted.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      await handleRelay(post(report({ beatId: 'b9' })), webhookDeps);
      await handleRelay(post(report({ beatId: 'b9' })), webhookDeps);
      await handleRelay(post(report({ beatId: 'b9' })), webhookDeps);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(store.kept).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });

  it('still honours the per-minute window, because identities are free', async () => {
    const out = await handleRelay(
      post(report()),
      deps({
        reports: createMemoryReportStore(),
        gate: gate({ ledger: { async claim() { return { allowed: false, reason: 'rate', retryAfterSeconds: 30 }; } } }),
      }),
    );
    // The client keeps its local copy, so a refusal here loses nothing.
    expect(out.status).toBe(429);
  });

  /**
   * THE ONE ROUTE THE KILL SWITCH DOES NOT REACH.
   *
   * Every relay goes silent when somebody flips it, and that is the point of
   * it — it stops SPEND. A report spends nothing, and the minute somebody
   * pauses the relay (a leaked key, a wrong answer, an incident) is the
   * minute a child is most likely to have something to say. A report button
   * that only works while nothing is wrong is not Safety #4.
   */
  it('is taken even while the kill switch is down, because a report is not spend', async () => {
    const out = await handleRelay(post(report()), deps({ disabled: true, reports: createMemoryReportStore() }));
    expect(out.status).toBe(202);
  });

  it('is taken while the ledger says the project day is spent or the relay is halted', async () => {
    for (const reason of ['halted', 'capped', 'budget'] as const) {
      const out = await handleRelay(
        post(report()),
        deps({
          reports: createMemoryReportStore(),
          gate: gate({ ledger: { async claim() { return { allowed: false, reason, retryAfterSeconds: 300 }; } } }),
        }),
      );
      expect(out.status).toBe(202);
    }
  });

  it('still obeys the per-minute window and a meter it cannot reach', async () => {
    // 'rate' is a flood, not an incident, and 'unavailable' is a meter that
    // is not answering at all — neither is the deliberate pause the
    // exemption is for.
    for (const [reason, status] of [['rate', 429], ['unavailable', 503]] as const) {
      const out = await handleRelay(
        post(report()),
        deps({
          reports: createMemoryReportStore(),
          gate: gate({ ledger: { async claim() { return { allowed: false, reason, retryAfterSeconds: 30 }; } } }),
        }),
      );
      expect(out.status).toBe(status);
    }
  });

  it('still refuses an unsigned caller while the kill switch is down', async () => {
    const out = await handleRelay(
      { ...post(report()), headers: {} },
      deps({ disabled: true, reports: createMemoryReportStore() }),
    );
    expect(out.status).toBe(401);
  });

  it('answers 503 when the store cannot keep it, never a silent 202', async () => {
    const out = await handleRelay(
      post(report()),
      deps({ reports: { async keep() { return null; } } }),
    );
    expect(out.status).toBe(503);
  });
});

describe('createSupabaseReportStore', () => {
  it('writes through the definer function with the service role, and reads back the id', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const store = createSupabaseReportStore('https://x.supabase.co', 'service-key', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      // `returns table (report_id, fresh)` — PostgREST hands back a one-row
      // array, not a bare scalar.
      return new Response(
        JSON.stringify([{ report_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fresh: true }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const kept = await store.keep(USER, {
      kind: 'rude',
      note: 'she laughed at my answer',
      lessonId: 'l1',
      at: '2026-09-18T05:00:00.000Z',
      topicRef: null,
      beatId: null,
      spokenLine: null,
      sessionId: null,
    });

    expect(kept).toEqual({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fresh: true });
    expect(calls[0].url).toBe('https://x.supabase.co/rest/v1/rpc/keep_student_report');
    expect(calls[0].body.p_user).toBe(USER);
    expect(calls[0].body.p_note).toBe('she laughed at my answer');
    expect(calls[0].body.p_beat).toBeNull();
  });

  it('answers null rather than throwing when Postgres is unreachable', async () => {
    const store = createSupabaseReportStore('https://x.supabase.co', 'service-key', async () => {
      throw new Error('down');
    });
    expect(
      await store.keep(USER, {
        kind: 'other',
        note: '',
        lessonId: 'l',
        at: '2026-01-01T00:00:00Z',
        topicRef: null,
        beatId: null,
        spokenLine: null,
        sessionId: null,
      }),
    ).toBeNull();
  });
});

describe('sendReportAlert', () => {
  const alert: ReportAlert = {
    kind: 'unsafe',
    lessonId: 'heredity-1',
    at: '2026-09-18T05:00:00.000Z',
    reportId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  };

  it('posts the minimal JSON and NEVER the child’s words', async () => {
    let sent = '';
    sendReportAlert('https://hooks.example/ops', alert, async (_url, init) => {
      sent = String(init?.body);
      return new Response(null, { status: 200 });
    });
    // Fire and forget resolves on a later tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(sent)).toEqual({
      kind: 'unsafe',
      lessonId: 'heredity-1',
      at: '2026-09-18T05:00:00.000Z',
      reportId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(sent).not.toMatch(/note/i);
  });

  it('logs one line instead when no webhook is set', () => {
    const lines: string[] = [];
    sendReportAlert(undefined, alert, async () => new Response(null, { status: 200 }), (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/laughed|words/);
  });

  it('never throws when the webhook is down — an alert failure must not fail the 202', async () => {
    expect(() =>
      sendReportAlert('https://hooks.example/ops', alert, async () => {
        throw new Error('webhook is down');
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
