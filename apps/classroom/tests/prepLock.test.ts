import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mintPrepId,
  prepStateOf,
  releasePrepLock,
  renewPrepLock,
  takePrepLock,
  waitForHolder,
} from '../src/lib/liveClass';

/**
 * THE LOCK, TAKEN.
 *
 * 0017 shipped `take_prep_lock` and the relay shipped the routes, and nothing
 * called either — so N students reaching one cold topic each paid about Rs 30
 * to prepare the same class. These tests are about the client half, and the
 * assertions that matter are the ones about what happens when the lock says
 * NO: a student who loses the race must end up in somebody else's class, and
 * a student the relay cannot answer for must still get taught.
 */

const calls: { url: string; init: RequestInit }[] = [];
/** Keyed by the path fragment the call carries, so order does not matter. */
let answers: Record<string, { status: number; body: unknown }> = {};

const reply = (url: string) => {
  for (const [fragment, answer] of Object.entries(answers)) {
    if (url.includes(fragment)) return answer;
  }
  return { status: 200, body: {} };
};

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  answers = {};
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const answer = reply(String(url));
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const of = (fragment: string) => calls.find((c) => c.url.includes(fragment));
const headerOf = (init: RequestInit | undefined, name: string): string | null => {
  const headers = init?.headers;
  if (!headers) return null;
  return new Headers(headers as HeadersInit).get(name);
};

const TOPIC = 'class10-science/blood/plasma';

describe('taking the lock', () => {
  it('asks for the topicRef and stamps the preparation id on the call', async () => {
    answers = { 'prep/lock': { status: 200, body: { granted: true, running: 1 } } };
    const gate = await takePrepLock(TOPIC, '11111111-2222-4333-8444-555555555555');

    expect(gate.kind).toBe('granted');
    const call = of('prep/lock');
    expect(call?.init.method).toBe('POST');
    expect(JSON.parse(String(call?.init.body))).toEqual({ topicRef: TOPIC });
    expect(headerOf(call?.init, 'x-prep-id')).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('reads "held" as somebody else is already preparing this', async () => {
    answers = {
      'prep/lock': {
        status: 200,
        body: { granted: false, reason: 'held', expiresAt: '2026-09-18T04:03:00.000Z', running: 2 },
      },
    };
    const gate = await takePrepLock(TOPIC, 'p');
    expect(gate).toEqual({ kind: 'held', expiresAt: '2026-09-18T04:03:00.000Z' });
  });

  it('reads "busy" as the project being at its ceiling, and carries the number', async () => {
    answers = {
      'prep/lock': { status: 200, body: { granted: false, reason: 'busy', running: 8 } },
    };
    expect(await takePrepLock(TOPIC, 'p')).toEqual({ kind: 'busy', running: 8 });
  });

  it('answers "unavailable" — never "held" — when the relay cannot answer', async () => {
    answers = { 'prep/lock': { status: 503, body: {} } };
    expect(await takePrepLock(TOPIC, 'p')).toEqual({ kind: 'unavailable' });
  });
});

describe('holding and letting go', () => {
  it('renews, and reports a lost lock as false', async () => {
    answers = { 'prep/renew': { status: 200, body: { renewed: false } } };
    expect(await renewPrepLock(TOPIC, 'p')).toBe(false);
  });

  it('releases on the topicRef, with the preparation id attached', async () => {
    answers = { 'prep/release': { status: 200, body: { released: true } } };
    await releasePrepLock(TOPIC, 'abc');
    const call = of('prep/release');
    expect(JSON.parse(String(call?.init.body))).toEqual({ topicRef: TOPIC });
    expect(headerOf(call?.init, 'x-prep-id')).toBe('abc');
  });

  it('never throws when the release fails — a class is playing behind it', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await expect(releasePrepLock(TOPIC, 'abc')).resolves.toBeUndefined();
  });
});

describe('reading the state of a topic', () => {
  it('reports what the relay says', async () => {
    answers = { 'prep/state': { status: 200, body: { states: { [TOPIC]: 'preparing' } } } };
    expect(await prepStateOf(TOPIC)).toBe('preparing');
  });

  it('answers null when the relay cannot say, which is not the same as absent', async () => {
    answers = { 'prep/state': { status: 503, body: {} } };
    expect(await prepStateOf(TOPIC)).toBeNull();
  });
});

describe('waiting for the holder', () => {
  const noSleep = () => Promise.resolve();

  it('ends at "ready" the moment the holder keeps their class', async () => {
    let asked = 0;
    vi.stubGlobal('fetch', (url: string) => {
      const ready = String(url).includes('prep/state') && ++asked >= 3;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ states: { [TOPIC]: ready ? 'ready' : 'preparing' } }),
      } as Response);
    });
    const waited: number[] = [];
    const out = await waitForHolder(TOPIC, {
      isCancelled: () => false,
      onWait: (n) => waited.push(n),
      sleep: noSleep,
    });
    expect(out).toBe('ready');
    expect(waited.length).toBeGreaterThan(0);
  });

  it('gives up and says "gone" when the holder dies without keeping anything', async () => {
    answers = { 'prep/state': { status: 200, body: { states: { [TOPIC]: 'absent' } } } };
    const out = await waitForHolder(TOPIC, { isCancelled: () => false, sleep: noSleep });
    expect(out).toBe('gone');
  });

  it('is BOUNDED — a holder that never finishes does not hold a child forever', async () => {
    answers = { 'prep/state': { status: 200, body: { states: { [TOPIC]: 'preparing' } } } };
    let clock = 0;
    const out = await waitForHolder(TOPIC, {
      isCancelled: () => false,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
    });
    expect(out).toBe('gone');
  });

  it('stops the moment the screen goes away', async () => {
    answers = { 'prep/state': { status: 200, body: { states: { [TOPIC]: 'preparing' } } } };
    const out = await waitForHolder(TOPIC, { isCancelled: () => true, sleep: noSleep });
    expect(out).toBe('cancelled');
  });
});

/**
 * THE PREP ID IS ATTRIBUTION, AND ATTRIBUTION MUST NEVER STOP A LESSON.
 *
 * `crypto.randomUUID` exists only in a secure context, and this repo has
 * already been bitten by that — stores/ledger.ts:136 mints a v4 by hand for
 * "http-on-a-LAN ... a school tablet or a phone pointed at a dev laptop". The
 * prep id is minted on the cold-topic path, so a throw there is a device that
 * can prepare no classes at all.
 */
describe('minting the prep id', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('mints a v4 uuid the relay will accept', () => {
    expect(mintPrepId()).toMatch(UUID);
  });

  it('still mints one where crypto.randomUUID does not exist', () => {
    const real = globalThis.crypto;
    // A non-secure context: getRandomValues is there, randomUUID is not.
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    try {
      expect(mintPrepId()).toMatch(UUID);
    } finally {
      vi.stubGlobal('crypto', real);
    }
  });

  it('still mints one with no crypto at all, rather than throwing', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    try {
      expect(mintPrepId()).toMatch(UUID);
    } finally {
      vi.stubGlobal('crypto', real);
    }
  });

  it('does not hand two preparations the same id', () => {
    expect(mintPrepId()).not.toBe(mintPrepId());
  });
});
