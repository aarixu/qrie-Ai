import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flagStore, recordFlag } from '../src/stores/flags';
import {
  captureStore,
  drainDistress,
  sendDistress,
  startDistressCapture,
  type CaptureDeps,
  type SafetyFlagBody,
} from '../src/lib/distressCapture';
import type { WhoIsHere } from '../src/lib/supabase';

/**
 * A DISTRESS FLAG LEAVES THE PHONE, AND THE WORDS DO NOT. (Plan 5.)
 *
 * The safety screen records a 'distress' flag on the device. This module sends
 * each new one to the relay's /api/flag: a fresh id, the category, whose words
 * matched, the time, the platform and the build. Nothing else, and nothing at
 * all during a trial. A flag that cannot be sent now waits on the phone, under
 * the child it belongs to, as a kept report does.
 */

const CHILD = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const here = (id: string | null): WhoIsHere => ({ known: true, account: id === null ? null : { id, label: '', anonymous: true } as never });
const unknown: WhoIsHere = { known: false };

let ids = 0;
const deps = (over: Partial<CaptureDeps> = {}): CaptureDeps & { send: ReturnType<typeof vi.fn> } => {
  const send = vi.fn(async (_flag: SafetyFlagBody) => 'sent' as const);
  return {
    send,
    whoIsHere: async () => here(CHILD),
    mayPersist: () => true,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    platform: () => 'web',
    release: 'test-build',
    ...over,
  } as CaptureDeps & { send: ReturnType<typeof vi.fn> };
};

let stop: (() => void) | null = null;
beforeEach(() => {
  localStorage.clear();
  flagStore.set({ flags: [] });
  captureStore.set({ waiting: [] });
});
afterEach(() => {
  stop?.();
  stop = null;
});

/** Lets the module's queued promises settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('sending distress flags', () => {
  it('a distress flag recorded on the device is sent once, with no words, and leaves the queue', async () => {
    const d = deps();
    stop = startDistressCapture(d);
    recordFlag({ kind: 'distress', at: '2026-10-08T05:00:00.000Z', lessonId: 'L1' });
    await vi.waitFor(() => expect(d.send).toHaveBeenCalledTimes(1));
    await settle();
    const body = d.send.mock.calls[0][0] as SafetyFlagBody;
    expect(Object.keys(body).sort()).toEqual(['at', 'category', 'direction', 'id', 'platform', 'release']);
    expect(body).toMatchObject({
      category: 'distress',
      direction: 'from-student',
      at: '2026-10-08T05:00:00.000Z',
      platform: 'web',
      release: 'test-build',
    });
    expect(JSON.stringify(body)).not.toContain('L1');
    expect(captureStore.get().waiting).toEqual([]);
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("the tutor's own flagged line is sent as to-student", async () => {
    const d = deps();
    stop = startDistressCapture(d);
    recordFlag({ kind: 'distress', direction: 'to-student', at: '2026-10-08T05:01:00.000Z' });
    await vi.waitFor(() => expect(d.send).toHaveBeenCalledTimes(1));
    expect((d.send.mock.calls[0][0] as SafetyFlagBody).direction).toBe('to-student');
  });

  it('redirect, cleaned and reported flags are not sent', async () => {
    const d = deps();
    stop = startDistressCapture(d);
    recordFlag({ kind: 'redirect', at: '2026-10-08T05:02:00.000Z' });
    recordFlag({ kind: 'cleaned', at: '2026-10-08T05:03:00.000Z' });
    recordFlag({ kind: 'reported', at: '2026-10-08T05:04:00.000Z', note: 'a note' });
    await settle();
    await settle();
    expect(d.send).not.toHaveBeenCalled();
    expect(captureStore.get().waiting).toEqual([]);
  });

  it('a send that did not land waits and goes on the next drain; a refused one is dropped', async () => {
    const outcomes: ('kept' | 'sent' | 'refused')[] = ['kept', 'refused'];
    const d = deps({ send: vi.fn(async () => outcomes.shift() ?? 'sent') });
    stop = startDistressCapture(d);
    recordFlag({ kind: 'distress', at: '2026-10-08T05:05:00.000Z' });
    await vi.waitFor(() => expect(d.send).toHaveBeenCalledTimes(1));
    await settle();
    expect(captureStore.get().waiting).toHaveLength(1);

    const later = vi.fn(async () => 'sent' as const);
    expect(await drainDistress(here(CHILD), later)).toEqual({ sent: 1, discarded: 0 });
    expect(captureStore.get().waiting).toEqual([]);

    // A refused one: the relay will give the same answer to the same bytes.
    recordFlag({ kind: 'distress', at: '2026-10-08T05:06:00.000Z' });
    await vi.waitFor(() => expect(d.send).toHaveBeenCalledTimes(2));
    await settle();
    expect(captureStore.get().waiting).toEqual([]);
  });

  it('a waiting flag of another child is discarded; one whose owner is unknown waits', async () => {
    const flag = (at: string): SafetyFlagBody => ({
      id: crypto.randomUUID(), category: 'distress', direction: 'from-student', at, platform: 'web', release: 'b',
    });
    captureStore.set({
      waiting: [
        { flag: flag('2026-10-08T06:00:00.000Z'), owner: OTHER },
        { flag: flag('2026-10-08T06:01:00.000Z'), owner: 'unknown' },
        { flag: flag('2026-10-08T06:02:00.000Z'), owner: CHILD },
      ],
    });
    const send = vi.fn(async () => 'sent' as const);
    expect(await drainDistress(here(CHILD), send)).toEqual({ sent: 1, discarded: 1 });
    expect(captureStore.get().waiting.map((w) => w.owner)).toEqual(['unknown']);
    // Nobody can be told apart while storage fails: everything waits.
    captureStore.set({ waiting: [{ flag: flag('2026-10-08T06:03:00.000Z'), owner: CHILD }] });
    expect(await drainDistress(unknown, send)).toEqual({ sent: 0, discarded: 0 });
    expect(captureStore.get().waiting).toHaveLength(1);
  });

  it('nothing is sent or queued during a trial', async () => {
    const d = deps({ mayPersist: () => false });
    stop = startDistressCapture(d);
    recordFlag({ kind: 'distress', at: '2026-10-08T05:07:00.000Z' });
    await settle();
    await settle();
    expect(d.send).not.toHaveBeenCalled();
    expect(captureStore.get().waiting).toEqual([]);
  });

  it('flags already on the device when the app opens are not sent again', async () => {
    recordFlag({ kind: 'distress', at: '2026-10-08T04:00:00.000Z' });
    recordFlag({ kind: 'distress', at: '2026-10-08T04:01:00.000Z' });
    const d = deps();
    stop = startDistressCapture(d);
    await settle();
    recordFlag({ kind: 'redirect', at: '2026-10-08T05:08:00.000Z' });
    await settle();
    await settle();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('at most 20 flags wait', async () => {
    const d = deps({ send: vi.fn(async () => 'kept' as const) });
    stop = startDistressCapture(d);
    for (let i = 0; i < 25; i++) {
      recordFlag({ kind: 'distress', at: `2026-10-08T07:${String(i).padStart(2, '0')}:00.000Z` });
    }
    await vi.waitFor(() => expect(d.send.mock.calls.length).toBeGreaterThanOrEqual(25));
    await settle();
    const waiting = captureStore.get().waiting;
    expect(waiting).toHaveLength(20);
    // The newest twenty are the ones kept.
    expect(waiting[waiting.length - 1].flag.at).toBe('2026-10-08T07:24:00.000Z');
    expect(waiting[0].flag.at).toBe('2026-10-08T07:05:00.000Z');
  });
});

describe('sendDistress', () => {
  it('posts the body to /api/flag and reads 2xx as sent, 400, 405 and 413 as refused, the rest as kept', async () => {
    const body: SafetyFlagBody = {
      id: crypto.randomUUID(), category: 'distress', direction: 'from-student', at: '2026-10-08T05:00:00.000Z', platform: 'web', release: 'b',
    };
    const seen: { path: string; init: RequestInit }[] = [];
    const answering = (status: number) =>
      (async (path: string, init: RequestInit = {}) => {
        seen.push({ path, init });
        return new Response('{}', { status });
      }) as never;
    expect(await sendDistress(body, answering(202))).toBe('sent');
    expect(seen[0].path).toBe('/api/flag');
    expect(seen[0].init.method).toBe('POST');
    expect(JSON.parse(String(seen[0].init.body))).toEqual(body);
    for (const s of [400, 405, 413]) expect(await sendDistress(body, answering(s))).toBe('refused');
    for (const s of [401, 429, 501, 503]) expect(await sendDistress(body, answering(s))).toBe('kept');
    expect(
      await sendDistress(body, (async () => {
        throw new Error('offline');
      }) as never),
    ).toBe('kept');
  });
});
