import { describe, expect, it } from 'vitest';
import { CANNOT_REACH, friendlyError } from '../src/errors.ts';
import { isOffline } from '../src/outbox.ts';
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

/**
 * A phone that loses its signal. postgrest-js (2.112) does not throw when
 * fetch itself fails: it answers with status 0 and the fetch error's name and
 * message as the error's message. Each call must still fail the way the
 * browser's own fetch does, with a TypeError, because that is what tells a
 * person "Could not reach your school", what the apps retry, and what keeps a
 * child's work waiting in the outbox.
 */
describe('a call that never reaches the hosted project', () => {
  const answering = (answer: unknown): RpcClient => ({
    schema: () => ({
      rpc: () => Object.assign(Promise.resolve(answer), { range: () => Promise.resolve(answer) }) as never,
    }),
  });
  const failure = (call: Promise<unknown>) => call.then(() => null, (e: unknown) => e);

  it('fails with a TypeError, read as "Could not reach your school"', async () => {
    for (const message of ['TypeError: Failed to fetch', 'TypeError: fetch failed', 'FetchError: request to the project failed']) {
      const client = answering({ data: null, error: { message, details: '', hint: '', code: '' }, status: 0, statusText: '' });
      for (const error of [await failure(supabaseTransport(client).value('me')), await failure(supabaseTransport(client).rows('my_classes'))]) {
        expect(error, message).toBeInstanceOf(TypeError);
        expect(friendlyError(error)).toBe(CANNOT_REACH);
        expect(isOffline(error)).toBe(true);
      }
    }
  });

  it('keeps a refusal from the school a plain Error in its own words', async () => {
    const client = answering({ data: null, error: { message: 'this is not your class' }, status: 400, statusText: 'Bad Request' });
    const error = await failure(supabaseTransport(client).value('class_marks'));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(friendlyError(error)).toBe('this is not your class');
  });
});
