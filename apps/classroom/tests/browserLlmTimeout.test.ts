import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));

import { createBrowserLlm } from '../src/lib/browserLlm';

/**
 * A MODEL CALL A STUDENT IS WAITING ON GIVES UP (overnight review #31).
 *
 * The judge runs while the chips are hidden; a call that never answered left
 * the class frozen. `timeoutMs` aborts the request, and the failure is what
 * every caller already handles.
 */
describe('createBrowserLlm timeoutMs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a call that never answers, and aborts the request', async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      seen = init.signal ?? undefined;
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError'))));
    });
    await expect(createBrowserLlm('m', { timeoutMs: 30 }).complete('s', 'u')).rejects.toBeDefined();
    expect(seen?.aborted).toBe(true);
  });

  it('sends no deadline when none is asked for', async () => {
    let seen: AbortSignal | null | undefined = null;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen = init.signal;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    await expect(createBrowserLlm('m').complete('s', 'u')).resolves.toBe('ok');
    expect(seen).toBeUndefined();
  });
});
