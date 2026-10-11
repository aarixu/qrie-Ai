// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool } from '../../../supabase/tests/fixtures.ts';
import { asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import type { LibraryItem } from '../src/library.ts';
import { syncLibrary } from '../src/sync.ts';
import { pgliteLibraryStore } from './pgliteLibraryStore.ts';

const item = (n: number, over: Partial<LibraryItem> = {}): LibraryItem => ({
  libraryRef: `probe-${n}`,
  outcomeIds: [`node-${n}`],
  grade: 8,
  subject: 'Science',
  stem: `Question ${n}?`,
  options: ['a', 'b', 'c', 'd'],
  correctIndex: 1,
  misconceptions: ['x', '', 'y', 'z'],
  ...over,
});

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

const libraryCount = async () =>
  (await db.query<{ n: number }>(`select count(*)::int as n from lms.item where org_id is null`)).rows[0].n;

describe('syncLibrary', () => {
  it('adds every item as a library item', async () => {
    const r = await syncLibrary([item(1), item(2), item(3)], pgliteLibraryStore(db));
    expect(r).toEqual({ inserted: 3, unchanged: 0, changed: [] });
    expect(await libraryCount()).toBe(3);
  });

  it('adds nothing when run again', async () => {
    const r = await syncLibrary([item(1), item(2), item(3)], pgliteLibraryStore(db));
    expect(r).toEqual({ inserted: 0, unchanged: 3, changed: [] });
    expect(await libraryCount()).toBe(3);
  });

  it('never overwrites an item whose question or key changed — a teacher may have approved the old one', async () => {
    const r = await syncLibrary([item(1, { correctIndex: 3 }), item(2), item(3), item(4)], pgliteLibraryStore(db));
    expect(r).toEqual({ inserted: 1, unchanged: 2, changed: ['probe-1'] });
    const { rows } = await db.query<{ k: number }>(`select correct_index as k from lms.item where library_ref = 'probe-1'`);
    expect(rows[0].k).toBe(1);
  });

  it('loads every question of a node that has several (Task 16)', async () => {
    const first = item(7, { libraryRef: 'probe-node-7' });
    const retest = item(7, { libraryRef: 'probe-node-7-retest', stem: 'Question 7, asked again?' });
    const r = await syncLibrary([first, retest], pgliteLibraryStore(db));
    expect(r).toEqual({ inserted: 2, unchanged: 0, changed: [] });
    const { rows } = await db.query<{ ref: string }>(
      `select library_ref as ref from lms.item where org_id is null and outcome_ids = array['node-7'] order by library_ref`,
    );
    expect(rows.map((x) => x.ref)).toEqual(['probe-node-7', 'probe-node-7-retest']);
  });

  it('keeps library items out of a student’s sight (0023)', async () => {
    const school = await buildSchool(db, 'LIB');
    const { rows } = await asUser(db, school.kid8a, (tx) => tx.query(`select 1 from lms.item`));
    expect(rows).toEqual([]);
  });
});
