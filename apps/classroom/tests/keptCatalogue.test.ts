import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * I1: THE CATALOGUE SERVES ONLY PUBLISHED, UNRETRACTED CLASSES.
 *
 * prepared_class carries review_status ('pending' | 'published' |
 * 'retracted') and retracted_at since migration 0018, and the read here asked
 * for neither — so a class kept 'pending' by the relay, or retracted by an
 * operator, went on being served to every student who opened its topic.
 *
 * The table below stands in for Postgres: it applies the filters the query
 * asks for, the way PostgREST would, so what is asserted is which ROWS reach
 * the catalogue — not which methods were called.
 */

type Row = Record<string, unknown>;

const table = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock('../src/lib/supabase', () => {
  /** A PostgREST query over `table.rows`: each filter narrows, awaiting resolves. */
  const query = (rows: Row[]) => {
    const q = {
      select: () => query(rows),
      eq: (col: string, v: unknown) => query(rows.filter((r) => r[col] === v)),
      is: (col: string, v: null) => query(rows.filter((r) => (r[col] ?? null) === v)),
      lte: (col: string, v: number) => query(rows.filter((r) => (r[col] as number) <= v)),
      gte: (col: string, v: number) => query(rows.filter((r) => (r[col] as number) >= v)),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  return { supabase: () => ({ from: () => query(table.rows) }) };
});

import { fetchCatalog, forgetCatalog } from '../src/lib/content';
import { profileStore } from '../src/stores/profile';

const row = (id: string, over: Row = {}): Row => ({
  id,
  topic_ref: `class10-science/chapter/${id}`,
  title: id,
  subtitle: null,
  klass: 10,
  subject: 'Science',
  review_status: 'published',
  retracted_at: null,
  ...over,
});

beforeEach(() => {
  forgetCatalog();
  localStorage.clear();
  profileStore.set({ name: null, klass: 10, subjects: [], diagnostic: null, diagnosedAt: null });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ lessons: [] })));
});

describe('which kept classes a student is served', () => {
  it('serves a published class', async () => {
    table.rows = [row('kept-and-published')];
    expect((await fetchCatalog()).map((e) => e.id)).toEqual(['kept-and-published']);
  });

  it('does not serve one still pending review', async () => {
    table.rows = [row('published'), row('waiting', { review_status: 'pending' })];
    expect((await fetchCatalog()).map((e) => e.id)).toEqual(['published']);
  });

  it('does not serve a retracted one, by status or by date', async () => {
    table.rows = [
      row('published'),
      row('retracted', { review_status: 'retracted', retracted_at: '2026-09-29T00:00:00Z' }),
      row('half-retracted', { retracted_at: '2026-09-29T00:00:00Z' }),
    ];
    expect((await fetchCatalog()).map((e) => e.id)).toEqual(['published']);
  });

  it('still serves the six classes kept before the relay stored anything pending', async () => {
    // 0018 added review_status with DEFAULT 'published' and retracted_at with
    // no default, so every row kept before it reads exactly like this.
    table.rows = Array.from({ length: 6 }, (_, n) => row(`kept-${n}`));
    expect(await fetchCatalog()).toHaveLength(6);
  });
});

/**
 * A PUBLISHED CLASS OPENED BY ITS OWN ADDRESS IS SERVED, WHATEVER THE BAND
 * (found on production, 2026-09-29): a Class 6-8 student who opened a
 * published Class 10 topic had it prepared from cold, because the catalogue
 * read only their band.
 */
describe('a kept class looked up by its topic', () => {
  it('finds a published class outside the student’s band', async () => {
    const { findKeptTopic } = await import('../src/lib/content');
    profileStore.set({ name: null, klass: 6, subjects: [], diagnostic: null, diagnosedAt: null });
    table.rows = [row('linear', { topic_ref: 'class10-mathematics/linear/substitution', klass: 10 })];
    expect((await fetchCatalog()).map((e) => e.id)).toEqual([]);
    expect((await findKeptTopic('class10-mathematics/linear/substitution'))?.id).toBe('linear');
    // And the lesson route that it hands over to finds it by id.
    const { findEntry } = await import('../src/lib/content');
    expect((await findEntry('linear'))?.id).toBe('linear');
  });

  it('never finds one that is pending or retracted', async () => {
    const { findKeptTopic } = await import('../src/lib/content');
    table.rows = [
      row('waiting', { topic_ref: 't/a/b', review_status: 'pending' }),
      row('gone', { topic_ref: 't/a/c', retracted_at: '2026-09-29T00:00:00Z' }),
    ];
    expect(await findKeptTopic('t/a/b')).toBeNull();
    expect(await findKeptTopic('t/a/c')).toBeNull();
  });
});
