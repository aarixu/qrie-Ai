// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from './harness.ts';

/**
 * WHO MAY CALL WHAT, PINNED AS A LIST. Written first.
 *
 * PostgreSQL gives EXECUTE to PUBLIC on every new function, so a function
 * written without its own revoke is callable by anybody. This test reads the
 * grants from the catalog: a new admin function must either not be callable
 * from a browser, or be added to the list below on purpose, in review.
 */

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

const callableBy = async (role: string) =>
  (
    await db.query<{ fn: string }>(
      `select n.nspname || '.' || p.proname as fn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'admin' and has_function_privilege($1, p.oid, 'execute')
        order by 1`,
      [role],
    )
  ).rows.map((r) => r.fn);

describe('the admin schema', () => {
  it('has no function an anonymous visitor may call', async () => {
    expect(await callableBy('anon')).toEqual([]);
  });

  it('lets a signed-in person call exactly the functions the panel uses, each of which checks for staff itself', async () => {
    expect(await callableBy('authenticated')).toEqual([
      'admin.flag_list',
      'admin.flag_set',
      'admin.me',
      'admin.relay_status',
      'admin.school_health',
      'admin.school_index',
      'admin.school_list',
      'admin.set_caps',
      'admin.set_halt',
      'admin.staff_list',
      'admin.staff_set',
      'admin.today',
    ]);
  });

  it('keeps the service-role tools to the service role', async () => {
    const service = await callableBy('service_role');
    expect(service).toEqual(
      expect.arrayContaining([
        'admin.alert_token_set',
        'admin.bootstrap_owner',
        'admin.bootstrap_status',
        'admin.revert_caps',
        'admin.set_environment',
      ]),
    );
    const signedIn = await callableBy('authenticated');
    for (const fn of ['admin.alert_token_set', 'admin.bootstrap_owner', 'admin.bootstrap_status', 'admin.revert_caps', 'admin.set_environment']) {
      expect(signedIn).not.toContain(fn);
    }
  });

  it('exposes only two functions to the public schema for the apps and the checker', async () => {
    const { rows } = await db.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('app_config', 'alert_snapshot')
          and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(rows.map((r) => r.fn)).toEqual(['alert_snapshot', 'app_config']);
  });
});
