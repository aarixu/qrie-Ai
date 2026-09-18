import { describe, expect, it } from 'vitest';
import { handleRelay, routeFor } from '../src/handler';
import {
  ENROLLED_NEXT,
  OTP_BURST_WINDOW_MINUTES,
  OTP_SENDS_PER_DAY_PROJECT,
  OTP_SENDS_PER_PHONE_BURST,
  createDevOtpProvider,
  createMemoryConsentStore,
  createMemoryOtpGate,
  createSupabaseConsentStore,
  createSupabaseOtpGate,
  isE164,
} from '../src/enroll';
import { MAX_CONTROL_BYTES } from '../src/prep';
import type { Gate } from '../src/gate';
import type { RelayRequest, RelayResponse } from '../src/relays';
import type { Verifier } from '../src/auth';

/**
 * ENROLMENT IS A CONSENT ARTIFACT FIRST AND A FORM SECOND.
 *
 * The users are children, so DPDP wants verifiable parental consent — a
 * parent's phone, an OTP that proves somebody holds it, and a row that says
 * when. No SMS vendor exists yet, so the provider is a SEAM: the dev
 * implementation logs the code server-side and accepts it back, and the real
 * vendor lands behind the same interface with its key held by the relay and
 * never a browser.
 */

const USER = '11111111-2222-3333-4444-555555555555';
const PHONE = '+919876543210';

const yes: Verifier = async (header) =>
  header === 'Bearer good-token'
    ? { ok: true, user: { userId: USER } }
    : { ok: false, status: 401, why: 'that sign-in is not valid' };

const gate = (over: Partial<Gate> = {}): Gate => ({
  verify: yes,
  ledger: { async claim() { return { allowed: true }; } },
  ...over,
});

const post = (url: string, value: unknown, over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url,
  headers: { authorization: 'Bearer good-token' },
  body: new TextEncoder().encode(JSON.stringify(value)),
  ...over,
});

const enrolment = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  studentName: 'Aarav',
  klass: 10,
  board: 'ncert',
  subjects: ['science'],
  parentName: 'Ashish',
  parentPhone: PHONE,
  consent: true,
  otp: '123456',
  ...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
  key: 'sk-test',
  gate: gate(),
  transcribe: async (): Promise<RelayResponse> => {
    throw new Error('the transcriber has no business in enrolment');
  },
  ...over,
});

const bodyOf = (out: RelayResponse): Record<string, unknown> =>
  out.body.kind === 'json' ? (out.body.value as Record<string, unknown>) : {};

/** A full working enrolment bench: dev OTP, open gate, memory consent. */
const bench = () => {
  const lines: string[] = [];
  const otp = createDevOtpProvider((l) => lines.push(l));
  const consent = createMemoryConsentStore();
  const otpGate = createMemoryOtpGate();
  const codeFor = (phone: string): string => {
    const line = lines.filter((l) => l.includes(phone)).pop() ?? '';
    return /\b(\d{6})\b/.exec(line)?.[1] ?? '';
  };
  return { otp, consent, otpGate, lines, codeFor };
};

describe('routeFor, for enrolment', () => {
  it('names both routes', () => {
    expect(routeFor('/api/enroll')).toBe('enroll');
    expect(routeFor('/api/enroll/otp')).toBe('enroll/otp');
    expect(routeFor('/relay/enroll/otp')).toBe('enroll/otp');
  });
});

describe('isE164', () => {
  it('takes a real international number and nothing else', () => {
    expect(isE164('+919876543210')).toBe(true);
    expect(isE164('9876543210')).toBe(false);
    expect(isE164('+0123')).toBe(false);
    expect(isE164('+91 98765 43210')).toBe(false);
  });
});

describe('the dev OTP provider', () => {
  it('logs the code server-side and never hands it to the caller', async () => {
    const { otp, lines } = bench();
    const sent = await otp.send(PHONE, USER);
    expect(sent.ok).toBe(true);
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(sent)).not.toMatch(/\d{6}/);
  });

  it('accepts the logged code exactly once', async () => {
    const { otp, codeFor } = bench();
    await otp.send(PHONE, USER);
    const code = codeFor(PHONE);
    expect(code).toMatch(/^\d{6}$/);
    expect(await otp.verify(PHONE, code, USER)).toBe(true);
    // One-shot: a replayed code must not enrol twice.
    expect(await otp.verify(PHONE, code, USER)).toBe(false);
  });

  it('refuses a wrong code and gives up after a few tries', async () => {
    const { otp, codeFor } = bench();
    await otp.send(PHONE, USER);
    for (let i = 0; i < 5; i += 1) expect(await otp.verify(PHONE, '000000', USER)).toBe(false);
    // Burned: even the right code is dead now, or 120 guesses a minute
    // through the shared window would walk a six-digit space eventually.
    expect(await otp.verify(PHONE, codeFor(PHONE), USER)).toBe(false);
  });

  /**
   * THE CODE BELONGS TO THE PAIR, NOT THE PHONE.
   *
   * On a shared device — a kiosk at a contest, which is the door this route
   * was built for — a second person can walk up while a code is live. If the
   * code were keyed on the phone alone, they could spend somebody else's
   * verified code against their OWN account, and consent_record would name
   * the wrong child. That is the artifact an auditor is shown.
   */
  it('will not let a second identity spend the first one’s code', async () => {
    const { otp, codeFor } = bench();
    const OTHER = '99999999-8888-7777-6666-555555555555';
    await otp.send(PHONE, USER);
    const code = codeFor(PHONE);
    expect(await otp.verify(PHONE, code, OTHER)).toBe(false);
    // And the rightful asker is untouched by the attempt.
    expect(await otp.verify(PHONE, code, USER)).toBe(true);
  });
});

describe('the memory OTP gate', () => {
  it('mirrors the SQL: a burst per phone is refused with a retry', async () => {
    const otpGate = createMemoryOtpGate(() => 1_000_000);
    for (let i = 0; i < OTP_SENDS_PER_PHONE_BURST; i += 1) {
      expect(await otpGate.claim(USER, PHONE)).toEqual({ allowed: true });
    }
    const refused = await otpGate.claim(USER, PHONE);
    expect(refused).not.toBeNull();
    expect(refused!.allowed).toBe(false);
    if (refused!.allowed) return;
    expect(refused!.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused!.retryAfterSeconds).toBeLessThanOrEqual(OTP_BURST_WINDOW_MINUTES * 60);
  });

  it('counts per phone across users, because the bill is per SMS, not per account', async () => {
    const otpGate = createMemoryOtpGate(() => 1_000_000);
    for (let i = 0; i < OTP_SENDS_PER_PHONE_BURST; i += 1) {
      await otpGate.claim(`00000000-0000-4000-8000-00000000000${i}`, PHONE);
    }
    expect((await otpGate.claim(USER, PHONE))!.allowed).toBe(false);
  });

  /**
   * THE LINE UNDER ALL OF THEM. Per-phone and per-user caps together bound
   * nothing on their own: the browser mints free anonymous identities, so N
   * accounts x N phones is an unbounded daily SMS bill with every individual
   * key inside its limit. The same hole UNITS_PER_DAY had, and the same
   * answer.
   */
  it('stops at the project’s day however many fresh identities and phones arrive', async () => {
    let at = 1_000_000;
    const otpGate = createMemoryOtpGate(() => at);
    let allowed = 0;
    // A fresh identity and a fresh phone each time, so neither the burst nor
    // either daily key can be what refuses.
    for (let i = 0; i < OTP_SENDS_PER_DAY_PROJECT + 25; i += 1) {
      const claim = await otpGate.claim(
        `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        `+9198${String(i).padStart(8, '0')}`,
      );
      if (claim!.allowed) allowed += 1;
      at += 1_000;
    }
    expect(allowed).toBe(OTP_SENDS_PER_DAY_PROJECT);
  });
});

describe('POST /api/enroll/otp through handleRelay', () => {
  it('says plainly when this host cannot send codes', async () => {
    expect((await handleRelay(post('/api/enroll/otp', { parentPhone: PHONE }), deps())).status).toBe(501);
  });

  it('admits first — no identity, no SMS', async () => {
    const b = bench();
    const out = await handleRelay(post('/api/enroll/otp', { parentPhone: PHONE }, { headers: {} }), deps(b));
    expect(out.status).toBe(401);
    expect(b.lines).toHaveLength(0);
  });

  it('refuses a phone that is not E.164 before anything is spent', async () => {
    const b = bench();
    const out = await handleRelay(post('/api/enroll/otp', { parentPhone: '98765' }), deps(b));
    expect(out.status).toBe(400);
    expect(b.lines).toHaveLength(0);
  });

  it('sends once admitted and within the gate', async () => {
    const b = bench();
    const out = await handleRelay(post('/api/enroll/otp', { parentPhone: PHONE }), deps(b));
    expect(out.status).toBe(200);
    expect(bodyOf(out)).toEqual({ sent: true });
    expect(b.lines).toHaveLength(1);
  });

  it('refuses a flood with 429 and a retry-after, because SMS is money', async () => {
    const b = bench();
    for (let i = 0; i < OTP_SENDS_PER_PHONE_BURST; i += 1) {
      await handleRelay(post('/api/enroll/otp', { parentPhone: PHONE }), deps(b));
    }
    const out = await handleRelay(post('/api/enroll/otp', { parentPhone: PHONE }), deps(b));
    expect(out.status).toBe(429);
    expect(out.headers['retry-after']).toBeDefined();
    expect(b.lines).toHaveLength(OTP_SENDS_PER_PHONE_BURST);
  });
});

describe('POST /api/enroll through handleRelay', () => {
  const enrol = async (b: ReturnType<typeof bench>, over: Record<string, unknown> = {}) => {
    await handleRelay(post('/api/enroll/otp', { parentPhone: PHONE }), deps(b));
    return handleRelay(post('/api/enroll', enrolment({ otp: b.codeFor(PHONE), ...over })), deps(b));
  };

  it('enrols with the right code and hands back the server-decided next step', async () => {
    const b = bench();
    const out = await enrol(b);
    expect(out.status).toBe(200);
    expect(bodyOf(out)).toEqual({ ok: true, next: ENROLLED_NEXT });
    expect(b.consent.rows).toHaveLength(1);
    expect(b.consent.rows[0]).toMatchObject({
      userId: USER,
      parentName: 'Ashish',
      parentPhone: PHONE,
      source: 'self_serve',
      contestCode: null,
    });
  });

  it('records a contest enrolment as contest', async () => {
    const b = bench();
    await enrol(b, { contestCode: 'SCHOOL-42' });
    expect(b.consent.rows[0].source).toBe('contest');
    expect(b.consent.rows[0].contestCode).toBe('SCHOOL-42');
  });

  it('refuses a wrong code and records no consent', async () => {
    const b = bench();
    const out = await enrol(b, { otp: '000000' });
    expect(out.status).toBe(400);
    expect(b.consent.rows).toHaveLength(0);
  });

  it('refuses consent that is anything but the literal true', async () => {
    const b = bench();
    for (const consent of ['true', 1, undefined, null]) {
      const out = await enrol(b, { consent });
      expect(out.status).toBe(400);
    }
    expect(b.consent.rows).toHaveLength(0);
  });

  it('holds the same class bounds as the rest of the product', async () => {
    const b = bench();
    expect((await enrol(b, { klass: 5 })).status).toBe(400);
    expect((await enrol(b, { klass: 13 })).status).toBe(400);
    expect((await enrol(b, { klass: 9.5 })).status).toBe(400);
  });

  it('takes only the board that exists', async () => {
    const b = bench();
    expect((await enrol(b, { board: 'cbse' })).status).toBe(400);
  });

  it('needs at least one subject', async () => {
    const b = bench();
    expect((await enrol(b, { subjects: [] })).status).toBe(400);
  });

  it('refuses a body larger than any enrolment, before decoding it', async () => {
    const b = bench();
    const out = await handleRelay(
      {
        method: 'POST',
        url: '/api/enroll',
        headers: { authorization: 'Bearer good-token' },
        body: new Uint8Array(MAX_CONTROL_BYTES + 1),
      },
      deps({ otp: b.otp, otpGate: b.otpGate, consent: b.consent }),
    );
    expect(out.status).toBe(413);
    expect(b.consent.rows).toHaveLength(0);
  });

  it('refuses an oversized otp-send body too — an identity is free', async () => {
    const b = bench();
    const out = await handleRelay(
      {
        method: 'POST',
        url: '/api/enroll/otp',
        headers: { authorization: 'Bearer good-token' },
        body: new Uint8Array(MAX_CONTROL_BYTES + 1),
      },
      deps({ otp: b.otp, otpGate: b.otpGate, consent: b.consent }),
    );
    expect(out.status).toBe(413);
  });

  it('answers 503 when consent cannot be written — an unrecorded consent is no enrolment', async () => {
    const b = bench();
    await handleRelay(post('/api/enroll/otp', { parentPhone: PHONE }), deps(b));
    const out = await handleRelay(
      post('/api/enroll', enrolment({ otp: b.codeFor(PHONE) })),
      deps({ ...b, consent: { async record() { return false; } } }),
    );
    expect(out.status).toBe(503);
  });

  it('says plainly when this host cannot enrol', async () => {
    expect((await handleRelay(post('/api/enroll', enrolment()), deps())).status).toBe(501);
  });
});

describe('the Supabase halves', () => {
  it('claims an OTP send through the definer function', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const otpGate = createSupabaseOtpGate('https://x.supabase.co', 'service-key', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify([{ allowed: false, retry_after: 600 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    expect(await otpGate.claim(USER, PHONE)).toEqual({ allowed: false, retryAfterSeconds: 600 });
    expect(calls[0].url).toBe('https://x.supabase.co/rest/v1/rpc/claim_otp_send');
    expect(calls[0].body).toEqual({ p_user: USER, p_phone: PHONE });
  });

  it('fails the gate closed when Postgres is unreachable', async () => {
    const otpGate = createSupabaseOtpGate('https://x.supabase.co', 'service-key', async () => {
      throw new Error('down');
    });
    expect(await otpGate.claim(USER, PHONE)).toBeNull();
  });

  it('writes the consent row with the service role', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const consent = createSupabaseConsentStore('https://x.supabase.co', 'service-key', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 201 });
    });
    const ok = await consent.record({
      userId: USER,
      parentName: 'Ashish',
      parentPhone: PHONE,
      source: 'self_serve',
      otpVerifiedAt: '2026-09-18T05:00:00.000Z',
      contestCode: null,
    });
    expect(ok).toBe(true);
    expect(calls[0].url).toBe('https://x.supabase.co/rest/v1/consent_record');
    expect(calls[0].body).toEqual({
      user_id: USER,
      parent_name: 'Ashish',
      parent_phone: PHONE,
      source: 'self_serve',
      otp_verified_at: '2026-09-18T05:00:00.000Z',
      contest_code: null,
    });
  });
});
