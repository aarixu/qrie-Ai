// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, staleAmr, type Staff } from './admin-fixtures.ts';
import { asClaims, asService, createUser, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * THE ADMIN CONSOLE'S FOUNDATION (migration 0047). Written first.
 *
 * Who is staff: an active row AND a JWT that is not anonymous AND at aal2.
 * Every refusal reads the same. The audit log cannot be edited by anybody,
 * the service role included. Staff accounts do not become children.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
});
afterAll(async () => {
  await db.close();
});

interface Me {
  userId: string;
  role: string;
  displayName: string;
  environment: string;
}
const me = (claims: JwtClaims) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ m: Me }>(`select admin.me() as m`)).rows[0].m);

describe('who counts as staff', () => {
  it('an active owner at aal2 is read back with the environment', async () => {
    const m = await me(aal2(owner));
    expect(m).toMatchObject({ userId: owner.id, role: 'owner', displayName: 'Aarav', environment: 'TEST' });
  });

  it('is refused at aal1, even for an owner', async () => {
    await expect(me({ sub: owner.id, aal: 'aal1' })).rejects.toThrow(/not allowed/);
  });

  it('is refused when the token says anonymous, even for an owner', async () => {
    await expect(me(aal2(owner, { is_anonymous: true }))).rejects.toThrow(/not allowed/);
  });

  it('refuses a child holding the same role staff hold', async () => {
    const child = await anonymousChild(db);
    await expect(me({ sub: child, aal: 'aal2', is_anonymous: true })).rejects.toThrow(/not allowed/);
  });

  it('refuses a permanent account that is not on the staff list', async () => {
    const stranger = await createUser(db);
    await expect(me({ sub: stranger, aal: 'aal2' })).rejects.toThrow(/not allowed/);
  });

  it('refuses a deactivated member on the very next call, whatever the token says', async () => {
    const leaver = await makeStaff(db, 'ops', 'Leaver');
    expect((await me(aal2(leaver))).role).toBe('ops');
    await asClaims(db, fresh(owner), (tx) =>
      tx.query(`select admin.staff_set($1, 'ops', 'Leaver', false, 'left the company')`, [leaver.id]),
    );
    await expect(me(aal2(leaver))).rejects.toThrow(/not allowed/);
  });
});

describe('the staff screen', () => {
  it('only an owner may list staff', async () => {
    await expect(asClaims(db, aal2(ops), (tx) => tx.query(`select * from admin.staff_list()`))).rejects.toThrow(
      /not allowed/,
    );
    const rows = await asClaims(db, aal2(owner), async (tx) => (await tx.query(`select * from admin.staff_list()`)).rows);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('changing staff needs the authenticator code verified a moment ago', async () => {
    const hire = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    await expect(
      asClaims(db, aal2(owner, { amr: staleAmr() }), (tx) =>
        tx.query(`select admin.staff_set($1, 'safety', 'Reviewer', true, 'new reviewer')`, [hire]),
      ),
    ).rejects.toThrow(/authenticator code/);
    await asClaims(db, fresh(owner), (tx) =>
      tx.query(`select admin.staff_set($1, 'safety', 'Reviewer', true, 'new reviewer')`, [hire]),
    );
    expect((await me(aal2({ id: hire }))).role).toBe('safety');
  });

  it('an anonymous account can never be staff', async () => {
    const child = await anonymousChild(db);
    await expect(
      asClaims(db, fresh(owner), (tx) => tx.query(`select admin.staff_set($1, 'ops', 'Kid', true, 'not a kid account')`, [child])),
    ).rejects.toThrow(/anonymous/);
  });

  it('an owner cannot demote or deactivate themselves', async () => {
    await expect(
      asClaims(db, fresh(owner), (tx) => tx.query(`select admin.staff_set($1, 'ops', 'Aarav', true, 'oops')`, [owner.id])),
    ).rejects.toThrow(/yourself/);
  });

  it('every change names the person in the audit log', async () => {
    const { rows } = await db.query<{ actor_name: string; reason: string }>(
      `select actor_name, reason from admin.audit_event where action = 'staff-set' order by id`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.actor_name === 'Aarav' && r.reason.length >= 3)).toBe(true);
  });
});

describe('the audit log cannot be edited', () => {
  it.each([
    ['update', `update admin.audit_event set action = 'x'`],
    ['delete', `delete from admin.audit_event`],
    ['truncate', `truncate admin.audit_event`],
  ])('refuses %s for the service role', async (_name, sql) => {
    await expect(asService(db, (tx) => tx.query(sql))).rejects.toThrow(/permission denied|insert-only/);
  });

  it('is not readable by a signed-in staff member except through a function', async () => {
    await expect(asClaims(db, aal2(owner), (tx) => tx.query(`select * from admin.audit_event`))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('staff are not children', () => {
  const memberships = async (id: string) =>
    (await db.query<{ n: number }>(`select count(*)::int as n from public.membership where user_id = $1`, [id])).rows[0].n;

  it('a staff account gets no solo organisation', async () => {
    expect(await memberships(owner.id)).toBe(0);
  });

  it('an ordinary account still does', async () => {
    expect(await memberships(await createUser(db))).toBe(1);
  });
});

describe('the first owner', () => {
  it('is made once, by the service role only', async () => {
    const fresh2 = await freshDatabase();
    try {
      await fresh2.query(`select admin.set_environment('TEST')`);
      const who = await createUser(fresh2, { appMeta: { provisioned_by: 'staff' } });
      await expect(
        asClaims(fresh2, { sub: who, aal: 'aal2' }, (tx) => tx.query(`select admin.bootstrap_owner($1, 'Aarav')`, [who])),
      ).rejects.toThrow(/permission denied/);
      await asService(fresh2, (tx) => tx.query(`select admin.bootstrap_owner($1, 'Aarav')`, [who]));
      const other = await createUser(fresh2, { appMeta: { provisioned_by: 'staff' } });
      await expect(
        asService(fresh2, (tx) => tx.query(`select admin.bootstrap_owner($1, 'Eve')`, [other])),
      ).rejects.toThrow(/already an owner/);
      const log = await fresh2.query<{ actor_role: string }>(
        `select actor_role from admin.audit_event where action = 'owner-bootstrapped'`,
      );
      expect(log.rows).toEqual([{ actor_role: 'service' }]);
    } finally {
      await fresh2.close();
    }
  });
});
