// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createCommonsSearch } from '../src/commons';

/**
 * A PAGE ASKS COMMONS WITH NO HEADER OF ITS OWN (2026-10-08).
 *
 * A browser's own requests already count as identified to Wikimedia (200 a
 * minute), and any header a page adds turns each search into two round trips:
 * a CORS preflight, then the search. Measured from this office that morning, a
 * search with the header took 20-35 seconds and the same search without it
 * 3.5-9, on a slow route to Wikimedia. So the page sends none; a script, which
 * a browser does not identify, sends User-Agent.
 */
describe('Commons, asked from a page', () => {
  it('adds no header, so the search costs no preflight', async () => {
    const inits: (RequestInit | undefined)[] = [];
    const search = createCommonsSearch({
      fetch: (async (_url: string, init?: RequestInit) => {
        inits.push(init);
        return { ok: true, json: async () => ({ query: { pages: [] } }) } as unknown as Response;
      }) as never,
    });
    await search.search('a kidney', 12);
    await search.searchVideo!('a heart beating', 12);
    expect(inits.length).toBeGreaterThan(0);
    for (const init of inits) expect([...new Headers(init?.headers).keys()]).toEqual([]);
  });
});
