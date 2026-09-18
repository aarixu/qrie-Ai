import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE CLIENT FOR THE FRONT DOOR.
 *
 * packages/relay/src/enroll.ts is the contract; this file asserts the client
 * reads it correctly, and — the part that matters at the screen — that every
 * refusal comes back as words a parent standing beside a child can act on.
 * A status code on that screen is a dead end.
 */

const relayFetch = vi.fn();
vi.mock('../src/lib/relay', () => ({
  relayFetch: (path: string, init?: RequestInit) => relayFetch(path, init),
}));

let enrol: typeof import('../src/lib/enroll');

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }) as unknown as Response;

const sent = (): { path: string; body: Record<string, unknown> } => {
  const [path, init] = relayFetch.mock.calls.at(-1) as [string, RequestInit];
  return { path, body: JSON.parse(String(init.body)) };
};

const FORM = {
  studentName: 'Aarav',
  klass: 9,
  board: 'ncert' as const,
  subjects: ['Science'],
  parentName: 'A parent',
  parentPhone: '+919876543210',
  otp: '123456',
};

beforeEach(async () => {
  vi.resetModules();
  relayFetch.mockReset();
  enrol = await import('../src/lib/enroll');
});

describe('a phone number, in the one shape the relay stores', () => {
  it('makes an Indian ten-digit mobile E.164, spaces and all', () => {
    expect(enrol.toE164('98765 43210')).toBe('+919876543210');
    expect(enrol.toE164('098765-43210')).toBe('+919876543210');
    expect(enrol.toE164('+91 98765 43210')).toBe('+919876543210');
  });

  /**
   * THE 91-SERIES. 9198765432 is an allocated ten-digit Indian mobile whose
   * first two digits happen to be 9 and 1. A prefix strip turns it into eight
   * digits and a parent is told their own number is not a number.
   */
  it('keeps a ten-digit mobile that happens to begin 91', () => {
    expect(enrol.toE164('9198765432')).toBe('+919198765432');
    expect(enrol.toE164('9112345678')).toBe('+919112345678');
    expect(enrol.toE164('09198765432')).toBe('+919198765432');
    expect(enrol.toE164('919198765432')).toBe('+919198765432');
  });

  it('refuses rather than guesses when it is not a number we can be sure of', () => {
    expect(enrol.toE164('9876543')).toBeNull();
    expect(enrol.toE164('1234567890')).toBeNull(); // no Indian mobile starts 1
    expect(enrol.toE164('not a phone')).toBeNull();
  });
});

describe('asking for a code', () => {
  it('posts the phone to the relay and reports the send', async () => {
    relayFetch.mockResolvedValue(reply(200, { sent: true }));
    const out = await enrol.requestOtp('+919876543210');
    expect(out.ok).toBe(true);
    expect(sent().path).toBe('/api/enroll/otp');
    expect(sent().body).toEqual({ parentPhone: '+919876543210' });
  });

  it('carries the retry-after through a 429 and prefers what the relay said', async () => {
    /**
     * A 429 here has two causes the client cannot distinguish — the send gate
     * and admitFree's rate window — so it REPORTS rather than guessing, the
     * way submitEnrolment always has. The retry-after is still read, because
     * the number is the relay's and the words about it are ours.
     */
    relayFetch.mockResolvedValue(
      reply(429, { error: { message: 'that is a lot of codes' } }, { 'retry-after': '240' }),
    );
    const out = await enrol.requestOtp('+919876543210');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.kind).toBe('rate-limited');
    expect(out.refusal.kind === 'rate-limited' && out.refusal.retryAfterSeconds).toBe(240);
    expect(out.message).toBe('that is a lot of codes');
    expect(out.message).not.toMatch(/429/);
  });

  it('says how long to wait itself when the relay sent no words at all', async () => {
    relayFetch.mockResolvedValue(reply(429, null, { 'retry-after': '240' }));
    const out = await enrol.requestOtp('+919876543210');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/minute/i);
    expect(out.message).not.toMatch(/429/);
  });

  it('tells them the code could not be sent on a 502, and to try again', async () => {
    relayFetch.mockResolvedValue(reply(502, { error: { message: 'the code could not be sent' } }));
    const out = await enrol.requestOtp('+919876543210');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.kind).toBe('send-failed');
    expect(out.message).not.toMatch(/502/);
    expect(out.message.length).toBeGreaterThan(20);
  });

  it('treats a 503 as a moment to wait, not a broken app', async () => {
    relayFetch.mockResolvedValue(reply(503, { error: { message: 'x' } }, { 'retry-after': '5' }));
    const out = await enrol.requestOtp('+919876543210');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.kind).toBe('gate-down');
    expect(out.message).not.toMatch(/503/);
  });

  it('calls a dead network a dead network', async () => {
    relayFetch.mockRejectedValue(new Error('offline'));
    const out = await enrol.requestOtp('+919876543210');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.kind).toBe('offline');
  });

  it('never sends a number the relay would refuse', async () => {
    const out = await enrol.requestOtp('98765');
    expect(out.ok).toBe(false);
    expect(relayFetch).not.toHaveBeenCalled();
  });
});

describe('enrolling', () => {
  it('sends exactly the fields the relay accepts, and consent as the literal true', async () => {
    relayFetch.mockResolvedValue(reply(200, { ok: true, next: '/app/diagnostic' }));
    await enrol.submitEnrolment({ ...FORM, schoolName: 'A school', city: 'Indore' });
    const { path, body } = sent();
    expect(path).toBe('/api/enroll');
    expect(body.consent).toBe(true);
    // Every extra field is a data-protection liability with no use in MVP-1.
    expect(Object.keys(body).sort()).toEqual(
      [
        'board',
        'city',
        'consent',
        'klass',
        'otp',
        'parentName',
        'parentPhone',
        'schoolName',
        'studentName',
        'subjects',
      ].sort(),
    );
  });

  it('leaves the optional fields out entirely rather than sending empty ones', async () => {
    relayFetch.mockResolvedValue(reply(200, { ok: true, next: '/app/diagnostic' }));
    await enrol.submitEnrolment({ ...FORM, schoolName: '  ', city: undefined });
    expect(Object.keys(sent().body)).not.toContain('schoolName');
    expect(Object.keys(sent().body)).not.toContain('city');
  });

  it('carries the contest code when there is one', async () => {
    relayFetch.mockResolvedValue(reply(200, { ok: true, next: '/app/diagnostic' }));
    await enrol.submitEnrolment({ ...FORM, contestCode: 'spring-26' });
    expect(sent().body.contestCode).toBe('spring-26');
  });

  it('returns the server’s next VERBATIM — the destination is not ours to build', async () => {
    relayFetch.mockResolvedValue(reply(200, { ok: true, next: '/app/somewhere-else' }));
    const out = await enrol.submitEnrolment(FORM);
    expect(out.ok).toBe(true);
    expect(out.ok && out.next).toBe('/app/somewhere-else');
  });

  it('refuses a 200 that carries no next rather than inventing one', async () => {
    relayFetch.mockResolvedValue(reply(200, { ok: true }));
    const out = await enrol.submitEnrolment(FORM);
    expect(out.ok).toBe(false);
  });

  it('sends a wrong code back as a wrong code, in the relay’s own words', async () => {
    relayFetch.mockResolvedValue(
      reply(400, { error: { message: 'that code is not right or has expired — ask for a new one' } }),
    );
    const out = await enrol.submitEnrolment(FORM);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.kind).toBe('bad-code');
    expect(out.message).toContain('ask for a new one');
  });

  it('says the enrolment was not recorded on a 503, because it was not', async () => {
    // The relay's own sentence, verbatim from handleEnroll — it is already
    // the right words for a parent, so the client shows it rather than
    // replacing it.
    relayFetch.mockResolvedValue(
      reply(503, {
        error: { message: 'we could not record the enrolment — please ask for a new code and try again' },
      }),
    );
    const out = await enrol.submitEnrolment(FORM);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.kind).toBe('not-recorded');
    expect(out.message).toMatch(/new code/i);
  });

  it('has words of its own when the relay says nothing at all', async () => {
    relayFetch.mockResolvedValue(reply(503, null));
    const out = await enrol.submitEnrolment(FORM);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/nothing was recorded|new code/i);
  });

  /**
   * A refusal answers "what do I do next". Telling a parent whose NUMBER could
   * not be read to ask for a new code sends them at the send gate — three per
   * phone per ten minutes — over a fault three screens back.
   */
  it('names the phone when the phone is the problem, and never sends it', async () => {
    const out = await enrol.submitEnrolment({ ...FORM, parentPhone: 'not a phone' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.kind).toBe('bad-phone');
    expect(out.message).toMatch(/number/i);
    expect(out.message).not.toMatch(/code/i);
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it('never shows a bare status code to a parent', async () => {
    for (const status of [400, 401, 413, 429, 500, 501, 503]) {
      /**
       * THE RELAY'S SENTENCE CARRIES A NUMBER ON PURPOSE. With a fixture of
       * 'nope' this loop passed whatever the client did — there was no
       * three-digit number anywhere for the assertion to find, so it was
       * testing the fixture. The client may pass relay prose through, and must
       * still never be the thing that turns a status into words a parent
       * reads.
       */
      relayFetch.mockResolvedValue(
        reply(status, { error: { message: 'no enrolment was recorded in 2026' } }),
      );
      const out = await enrol.submitEnrolment(FORM);
      expect(out.ok).toBe(false);
      if (out.ok) continue;
      expect(out.message).not.toMatch(/\b[45]\d\d\b/);
    }
  });
});
