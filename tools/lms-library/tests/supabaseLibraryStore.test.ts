import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../src/library.ts';
import { supabaseLibraryStore } from '../src/supabaseLibraryStore.ts';

const URL_ = 'https://x.supabase.co';
const KEY = 'service-role-secret-key';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      ...(init?.body ? { body: String(init.body) } : {}),
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, impl };
}

const item = (n: number): LibraryItem => ({
  libraryRef: `probe-${n}`,
  outcomeIds: [`node-${n}`],
  grade: 8,
  subject: 'Science',
  stem: `Q${n}`,
  options: ['a', 'b'],
  correctIndex: 0,
});

describe('supabaseLibraryStore', () => {
  it('reads every stored library item, a page at a time', async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ library_ref: `probe-${from + i}`, stem: 's', options: ['a'], correct_index: 0 }));
    const { calls, impl } = fakeFetch((c) =>
      new Response(JSON.stringify(c.url.includes('offset=0') ? page(1000, 0) : page(3, 1000)), { status: 200 }),
    );
    const existing = await supabaseLibraryStore(URL_, KEY, impl).existing();
    expect(existing.size).toBe(1003);
    expect(calls).toHaveLength(2);
    expect(calls[0].headers['Accept-Profile']).toBe('lms');
  });

  it('inserts in batches of at most 500, never overwriting a stored item', async () => {
    const { calls, impl } = fakeFetch(() => new Response('', { status: 201 }));
    await supabaseLibraryStore(URL_, KEY, impl).insert(Array.from({ length: 1201 }, (_, i) => item(i)));
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => JSON.parse(c.body!).length)).toEqual([500, 500, 201]);
    for (const p of posts) {
      expect(p.url).toBe(`${URL_}/rest/v1/item?on_conflict=library_ref`);
      expect(p.headers).toMatchObject({ 'Content-Profile': 'lms', prefer: 'resolution=ignore-duplicates' });
    }
    expect(JSON.parse(posts[0].body!)[0]).toEqual({
      library_ref: 'probe-0',
      outcome_ids: ['node-0'],
      grade: 8,
      subject: 'Science',
      kind: 'mcq',
      stem: 'Q0',
      options: ['a', 'b'],
      correct_index: 0,
      misconceptions: null,
    });
  });

  it('fails loudly on an error without echoing the key', async () => {
    const { impl } = fakeFetch(() => new Response('nope', { status: 403 }));
    const err = await supabaseLibraryStore(URL_, KEY, impl).existing().catch((e: Error) => e);
    expect((err as Error).message).toMatch(/403/);
    expect((err as Error).message).not.toContain(KEY);
  });
});
