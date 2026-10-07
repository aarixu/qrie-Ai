import { describe, expect, it } from 'vitest';
import { supabaseTransport, type RpcClient } from '../src/transport.ts';

/**
 * PostgREST hands back at most 1,000 rows from one call (its max-rows), and
 * says nothing about the rest. A school of 1,500 students must not lose 500
 * from the portal without a word, so rows() asks page by page.
 */

function fakeClient(total: number, cap = 1000) {
  const calls: [number, number][] = [];
  const all = Array.from({ length: total }, (_, i) => ({ n: i }));
  const client: RpcClient = {
    schema: () => ({
      rpc: () => {
        const unpaged = Promise.resolve({ data: all.slice(0, cap), error: null });
        return Object.assign(unpaged, {
          range: (from: number, to: number) => {
            calls.push([from, to]);
            return Promise.resolve({ data: all.slice(from, Math.min(to + 1, from + cap)), error: null });
          },
        });
      },
    }),
  };
  return { client, calls };
}

describe('rows from the hosted project', () => {
  it('are all of them, however many, asked for 1,000 at a time', async () => {
    const { client, calls } = fakeClient(2500);
    const rows = await supabaseTransport(client).rows('school_students');
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toEqual({ n: 2499 });
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('take one call when there are fewer than a page', async () => {
    const { client, calls } = fakeClient(12);
    expect(await supabaseTransport(client).rows('my_classes')).toHaveLength(12);
    expect(calls).toEqual([[0, 999]]);
  });

  it('come back exactly a page long without a lost row', async () => {
    const { client } = fakeClient(1000);
    expect(await supabaseTransport(client).rows('school_students')).toHaveLength(1000);
  });
});
