// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from './harness.ts';

/**
 * NOTHING IN SCHEMA `billing` IS REACHABLE FROM THE API. Written first.
 *
 * The tables and helpers of billing are reached only by SECURITY DEFINER
 * functions in `admin`, which run as their owner. No API role, the service
 * role included, may read or write a billing table or call a billing function
 * directly (ruling R21).
 */

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

const ROLES = ['anon', 'authenticated', 'service_role'];

describe('the billing schema', () => {
  it('no billing table can be read or written by anon, authenticated or service_role', async () => {
    const { rows } = await db.query<{ t: string; role: string }>(
      `select c.relname as t, r.role
         from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest($1::text[]) as r(role)
        where n.nspname = 'billing' and c.relkind = 'r'
          and has_table_privilege(r.role, c.oid, 'select,insert,update,delete')`,
      [ROLES],
    );
    expect(rows).toEqual([]);
    const { rows: tables } = await db.query(
      `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'billing' and c.relkind = 'r'`,
    );
    expect(tables.length).toBeGreaterThanOrEqual(12);
  });

  it('no billing function can be called by anon, authenticated or service_role', async () => {
    const { rows } = await db.query<{ f: string; role: string }>(
      `select p.proname as f, r.role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest($1::text[]) as r(role)
        where n.nspname = 'billing' and has_function_privilege(r.role, p.oid, 'execute')`,
      [ROLES],
    );
    expect(rows).toEqual([]);
    const { rows: fns } = await db.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'billing'`,
    );
    expect(fns.length).toBeGreaterThan(0);
  });

  it('every billing table except the webhook log and school_state carries the tripwire', async () => {
    const { rows } = await db.query<{ t: string }>(
      `select distinct c.relname as t
         from pg_trigger g
         join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_proc p on p.oid = g.tgfoid
         join pg_namespace pn on pn.oid = p.pronamespace
        where n.nspname = 'billing' and pn.nspname = 'admin' and p.proname = 'tripwire'
        order by 1`,
    );
    expect(rows.map((r) => r.t)).toEqual(
      ['account', 'credit_note', 'invoice', 'number_counter', 'payment', 'payment_link', 'plan', 'refund', 'seller', 'subscription'],
    );
  });
});
