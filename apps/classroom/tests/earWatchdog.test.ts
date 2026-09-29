import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));

/** A mic that opens and then never delivers a chunk — a suspended AudioContext. */
vi.mock('@ai-tutor/voice', async (real) => ({
  ...(await real<typeof import('@ai-tutor/voice')>()),
  createMicCapture: () => ({ start: async () => undefined, stop: () => undefined }),
}));

const { listenOnce } = await import('../src/lib/ear');

/** Third review, 2026-09-29: a listen used to wait forever on a mic that stopped. */
describe('listenOnce watchdog', () => {
  it('ends a listen whose mic stops delivering, as an error', async () => {
    const heard = await listenOnce({ stallMs: 300 });
    expect(heard).toEqual({ text: null, reason: 'error' });
  });

  it('sees a cancel without waiting for a chunk', async () => {
    let cancelled = false;
    setTimeout(() => (cancelled = true), 50);
    const heard = await listenOnce({ isCancelled: () => cancelled, stallMs: 10_000 });
    expect(heard).toEqual({ text: null, reason: 'cancelled' });
  });
});
