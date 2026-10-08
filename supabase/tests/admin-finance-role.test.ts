// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { makeFinance } from './billing-fixtures.ts';
import { asClaims, createUser, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * THE FINANCE ROLE (migration 0056). Written first.
 *
 * Spec section 3: finance reads billing, records an offline payment and prints
 * invoices; nothing about children, switches or classes. Every plan-1 function
 * keeps its own role list, so finance reaches me() and nothing else there.
 */

let db: PGlite;
let owner: Staff;
let finance: { id: string; role: 'finance' };

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  await makeStaff(db, 'ops');
  finance = await makeFinance(db);
});
afterAll(async () => {
  await db.close();
});

const call = (claims: JwtClaims, sql: string) => asClaims(db, claims, (tx) => tx.query(sql));

/**
 * staff_set as this branch has it (five arguments) or as plan 2's 0054 makes it
 * (six, with p_env). The helper reads which one the database has, so this file
 * passes before and after plan 2 is merged, and never creates either.
 */
async function staffSet(claims: JwtClaims, args: { user: string; role: string; name: string; reason: string }) {
  const { rows } = await db.query<{ n: number }>(
    `select max(p.pronargs)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'admin' and p.proname = 'staff_set'`,
  );
  const withEnv = rows[0].n === 6;
  return asClaims(db, claims, (tx) =>
    tx.query(
      `select admin.staff_set(p_user => $1, p_role => $2, p_name => $3, p_active => true, p_reason => $4${
        withEnv ? `, p_env => 'TEST'` : ''
      })`,
      [args.user, args.role, args.name, args.reason],
    ),
  );
}

describe('the finance role', () => {
  it('finance is a role the staff table accepts, and an unknown role is not', async () => {
    expect(finance.role).toBe('finance');
    const id = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    await expect(
      db.query(`insert into admin.platform_staff (user_id, role, display_name) values ($1, 'auditor', 'x')`, [id]),
    ).rejects.toThrow(/platform_staff_role_check/);
  });

  it('a finance member reaches me() and is told their role', async () => {
    const { rows } = await asClaims(db, aal2(finance), (tx) => tx.query<{ m: { role: string } }>(`select admin.me() as m`));
    expect(rows[0].m.role).toBe('finance');
  });

  // The stop itself is open to finance since 0061 (the owner's ruling on spec
  // section 3): admin-wave1-merge.test.ts pins it.
  it('finance is refused Today, the switches and the relay', async () => {
    for (const sql of [
      `select admin.today()`,
      `select admin.flag_list()`,
      `select admin.relay_status()`,
    ]) {
      await expect(call(aal2(finance), sql)).rejects.toThrow(/not allowed/);
    }
  });

  it('the owner makes a finance member through staff_set with a fresh code', async () => {
    const u = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    await staffSet(fresh(owner), { user: u, role: 'finance', name: 'Accounts', reason: 'new accountant' });
    const { rows } = await db.query<{ role: string }>(`select role from admin.platform_staff where user_id = $1`, [u]);
    expect(rows[0].role).toBe('finance');
  });

  it('staff_set still refuses a role that does not exist', async () => {
    const u = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    await expect(staffSet(fresh(owner), { user: u, role: 'auditor', name: 'X', reason: 'trying a role' })).rejects.toThrow(
      /a role is owner, ops, safety or finance|there is no staff role called auditor/,
    );
  });
});
