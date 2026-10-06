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

  it('gives a signed-out browser (anon) no function but the sign-in screen’s school look', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'lms' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(['school_brand(p_code text)']);
  });

  it('lets a signed-out browser read, write or change no table', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'lms' and c.relkind in ('r', 'v')
          and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
               or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
        order by 1`,
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
      'work_facts(p_org uuid, p_section uuid, p_subject uuid, p_students uuid[], p_due_after timestamp with time zone, p_due_by timestamp with time zone)',
      'practice_pool(p_student uuid)',
      'may_see_student(p_student uuid)',
      'require_admin()',
      'teaches(p_teacher uuid, p_student uuid, p_subject uuid)',
      'trim_space(p_text text)',
      'may_remark(p_student uuid)',
      'may_see_notice(p_notice uuid)',
      'may_manage_notice(p_notice uuid)',
      'notice_audience(p_notice uuid)',
      'set_for(p_assignment uuid, p_student uuid)',
      'practice_items(p_section uuid, p_subject uuid, p_chapter text, p_misconception text)',
      'guard_set_for()',
      'seats_used(p_org uuid)',
      'require_seat(p_org uuid)',
      'usable_question(p_stem text, p_options jsonb, p_correct integer, p_labels jsonb)',
      'own_draft(p_draft uuid)',
      'handed_in_with(p_key uuid, p_assignment uuid)',
      'is_guardian_of(p_student uuid)',
      'set_licence(p_code text, p_plan text, p_seats integer, p_until date)',
      'founder_schools()',
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
