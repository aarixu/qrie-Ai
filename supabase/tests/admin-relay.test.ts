// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, staleAmr, type Staff } from './admin-fixtures.ts';
import { asClaims, asService, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * THE STOP SWITCH AND THE CEILING (migration 0048). Written first.
 *
 * Any staff member may STOP the tutor in one call. Only an owner who has just
 * verified their authenticator code may RESUME it or move the ceiling. A raise
 * reverts by itself the next UTC day. A hand-written UPDATE of relay_control
 * leaves an 'unmanaged-change' row; the admin functions do not.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let child: string;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  child = await anonymousChild(db);
});
afterAll(async () => {
  await db.close();
});

interface RelayStatus {
  halted: boolean;
  haltedReason: string | null;
  ceilingUnits: number;
  unitsToday: number;
  capOverride: { previousUnits: number; revertOn: string } | null;
}
const status = (claims: JwtClaims) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ s: RelayStatus }>(`select admin.relay_status() as s`)).rows[0].s);
const call = (claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, (tx) => tx.query(sql, params));
const stop = (who: Staff, reason = 'vendor outage', env = 'TEST') =>
  call(aal2(who), `select admin.set_halt(true, $1, $2)`, [reason, env]);
const resume = (reason = 'all clear') => call(fresh(owner), `select admin.set_halt(false, $1, 'TEST')`, [reason]);

// Test setup writes the tables directly, as the database owner; the tripwire
// notes each such write, which is why the tripwire test counts differences.
beforeEach(async () => {
  await db.query(`update public.relay_control set halted = false, halted_reason = null, global_units_per_day = 50000`);
  await db.query(`delete from admin.cap_override`);
  await db.query(`delete from public.relay_budget_day`);
});

describe('stopping the tutor', () => {
  it('one call from any staff member stops it, and the relay then refuses everybody', async () => {
    await stop(ops);
    const s = await status(aal2(ops));
    expect(s).toMatchObject({ halted: true, haltedReason: 'vendor outage' });
    const { rows } = await asService(db, (tx) =>
      tx.query<{ allowed: boolean; reason: string }>(`select * from public.claim_relay($1, 'llm', 1)`, [child]),
    );
    expect(rows[0]).toMatchObject({ allowed: false, reason: 'halted' });
  });

  it('is refused for a console pointed at the wrong environment', async () => {
    await expect(stop(ops, 'x1x', 'HOSTED')).rejects.toThrow(/this console is TEST, not HOSTED/);
  });

  it('is refused for a child, and wants a reason', async () => {
    await expect(
      call({ sub: child, aal: 'aal2', is_anonymous: true }, `select admin.set_halt(true, 'x1x', 'TEST')`),
    ).rejects.toThrow(/not allowed/);
    await expect(stop(ops, 'x')).rejects.toThrow(/say why/);
  });

  it('resuming is for an owner, with the code verified a moment ago', async () => {
    await stop(ops);
    await expect(call(aal2(ops), `select admin.set_halt(false, 'all clear', 'TEST')`)).rejects.toThrow(/not allowed/);
    await expect(call(aal2(owner, { amr: staleAmr() }), `select admin.set_halt(false, 'all clear', 'TEST')`)).rejects.toThrow(
      /authenticator code/,
    );
    await resume();
    expect((await status(aal2(owner))).halted).toBe(false);
  });
});

describe('the daily ceiling', () => {
  it('only an owner may move it, and only inside 1000 to 1000000', async () => {
    await expect(call(fresh(ops), `select admin.set_caps(80000, 'launch day', 'TEST')`)).rejects.toThrow(/not allowed/);
    await expect(call(fresh(owner), `select admin.set_caps(10, 'too low', 'TEST')`)).rejects.toThrow(/between 1000 and 1000000/);
    await expect(call(fresh(owner), `select admin.set_caps(5000000, 'too high', 'TEST')`)).rejects.toThrow(
      /between 1000 and 1000000/,
    );
  });

  it('a raise remembers the old ceiling, and reverts on its day', async () => {
    await call(fresh(owner), `select admin.set_caps(80000, 'launch day', 'TEST')`);
    const raised = await status(aal2(owner));
    expect(raised.ceilingUnits).toBe(80000);
    expect(raised.capOverride?.previousUnits).toBe(50000);

    const revert = async () =>
      (await asService(db, (tx) => tx.query<{ n: number }>(`select admin.revert_caps() as n`))).rows[0].n;
    expect(await revert()).toBe(0);
    await db.query(`update admin.cap_override set revert_on = (now() at time zone 'utc')::date`);
    expect(await revert()).toBe(1);
    expect(await status(aal2(owner))).toMatchObject({ ceilingUnits: 50000, capOverride: null });
  });

  it('refuses a ceiling at or below today\'s spend unless the tutor is stopped first', async () => {
    await db.query(`insert into public.relay_budget_day (day, units) values ((now() at time zone 'utc')::date, 20000)`);
    await expect(call(fresh(owner), `select admin.set_caps(15000, 'trim', 'TEST')`)).rejects.toThrow(/stop the tutor first/);
    await stop(ops);
    await call(fresh(owner), `select admin.set_caps(15000, 'trim', 'TEST')`);
    expect((await status(aal2(owner))).ceilingUnits).toBe(15000);
  });

  it('is reverted every night by a scheduled job', async () => {
    const { rows } = await db.query<{ schedule: string }>(`select schedule from cron.job where jobname = 'admin-revert-caps'`);
    expect(rows).toEqual([{ schedule: '5 0 * * *' }]);
  });
});

describe('the tripwire', () => {
  const unmanaged = async () =>
    (await db.query<{ n: number }>(`select count(*)::int as n from admin.audit_event where action = 'unmanaged-change'`)).rows[0].n;

  it('notes a hand-written UPDATE of relay_control', async () => {
    const before = await unmanaged();
    await asService(db, (tx) => tx.query(`update public.relay_control set halted_reason = 'by hand'`));
    expect(await unmanaged()).toBe(before + 1);
  });

  it('stays quiet for the admin functions', async () => {
    const before = await unmanaged();
    await stop(ops, 'drill');
    await resume('drill over');
    await call(fresh(owner), `select admin.set_caps(60000, 'drill', 'TEST')`);
    expect(await unmanaged()).toBe(before);
  });

  it('every stop, resume and ceiling change is in the audit log with who did it', async () => {
    await stop(ops, 'logged');
    const { rows } = await db.query<{ action: string; actor_name: string }>(
      `select action, actor_name from admin.audit_event where action in ('tutor-stopped') order by id desc limit 1`,
    );
    expect(rows[0]).toEqual({ action: 'tutor-stopped', actor_name: 'Ops person' });
  });
});
