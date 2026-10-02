// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from './harness.ts';

/**
 * RULES EVERY LMS MIGRATION MUST KEEP, checked over the whole schema rather
 * than function by function, so a new table or function that forgets one
 * fails here the day it is written.
 */

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

describe('the lms schema', () => {
  it('has row-level security on every table', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'lms' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('gives a signed-out browser (anon) no function at all', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'lms' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('pins the search path of every SECURITY DEFINER function', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'lms' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
        order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('keeps the jobs and internal pieces away from signed-in browsers', async () => {
    const internal = [
      'finalize_tests(p_assignment uuid)',
      'work_facts(p_org uuid)',
      'practice_pool(p_student uuid)',
      'may_see_student(p_student uuid)',
      'require_admin()',
      'teaches(p_teacher uuid, p_student uuid, p_subject uuid)',
    ];
    const { rows } = await db.query<{ name: string }>(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'lms' and has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
    );
    const open = new Set(rows.map((r) => r.name));
    expect(internal.filter((f) => open.has(f))).toEqual([]);
  });
});
