import { describe, expect, it, vi } from 'vitest';

/**
 * THE RUNG IS ACTUALLY REACHED.
 *
 * A review found the whole web-picture ladder — the module, the licence gate,
 * the verifier, three hundred lines of tests — wired to nothing: it took a
 * `web` adapter and no call site passed one, so every picture was still
 * generated and every test still passed.
 *
 * The fix was to make the search the DEFAULT rather than the caller's job, and
 * this is the test that keeps it that way. It asserts on the argument
 * prepareClass is actually handed, which is the only place the wiring is real.
 */

const prepared = vi.hoisted(() => ({
  fn: vi.fn(async () => ({
    lesson: { id: 'x', title: 'T', beats: [], elements: [] },
    assets: {},
    report: { topic: 'T', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [] },
  })),
}));

vi.mock('@ai-tutor/class-prep', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, prepareClass: prepared.fn };
});

// Nothing here should reach a network or a relay.
vi.mock('../src/lib/browserLlm', () => ({ createBrowserLlm: () => ({ complete: async () => '{}' }) }));
vi.mock('../src/lib/browserImage', () => ({
  createBrowserImageArtist: () => ({ draw: async () => null }),
  createBrowserVision: () => ({ look: async () => '{}' }),
}));
vi.mock('../src/lib/relay', () => ({ relayFetch: async () => new Response('{}') }));

import { prepareLiveClass } from '../src/lib/liveClass';

const ask = { topic: 'The Kidney', klass: 10, minutes: 3 };
const optionsOf = () => {
  const last = prepared.fn.mock.calls.at(-1) as unknown[] | undefined;
  if (!last) throw new Error('prepareClass was never called');
  return last[0] as { web?: unknown; eyes?: unknown };
};

describe('the picture search reaches prepareClass', () => {
  it('is passed by default, without any caller asking for it', async () => {
    prepared.fn.mockClear();
    await prepareLiveClass(ask, () => {});

    const web = optionsOf().web as { search?: unknown; fetch?: unknown } | undefined;
    expect(web).toBeDefined();
    expect(typeof web!.search).toBe('function');
    expect(typeof web!.fetch).toBe('function');
  });

  it('takes an adapter the caller supplies instead', async () => {
    prepared.fn.mockClear();
    const mine = { search: async () => [], fetch: async () => null };
    await prepareLiveClass({ ...ask, web: mine }, () => {});
    expect(optionsOf().web).toBe(mine);
  });

  it('can be turned off deliberately with null', async () => {
    // Different from forgetting: null says a caller decided, and the ladder
    // falls straight through to generation.
    prepared.fn.mockClear();
    await prepareLiveClass({ ...ask, web: null }, () => {});
    expect(optionsOf().web).toBeUndefined();
  });

  it('still hands over the eyes the verifier needs', async () => {
    // Without a vision adapter findOnTheWeb skips the rung entirely, so a
    // search with no eyes is the same as no search at all.
    prepared.fn.mockClear();
    await prepareLiveClass(ask, () => {});
    expect(optionsOf()).toHaveProperty('eyes');
  });
});
