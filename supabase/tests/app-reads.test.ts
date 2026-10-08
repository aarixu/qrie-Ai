// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { setLicence } from './admin-school-fixtures.ts';
import { billedSchool, makeFinance, readySeller, rpc } from './billing-fixtures.ts';
import { asClaims, asUser, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * THE READS THE APPS AND FINANCE NEED (migration 0064). Written first.
 *
 * lms.school_billing: the school admin's licence state and what is owed (spec
 * section 13), for the admin only. admin.stop_status: whether the tutor is
 * stopped, for every staff role, finance included (0061 lets finance stop it).
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let org: string;
let schoolAdmin: string;

interface Billing {
  state: string;
  graceUntil: string | null;
  openInvoices: number;
  duePaise: number;
  earliestDueOn: string | null;
}
const billingOf = (user: string) =>
  asUser(db, user, async (tx) => (await tx.query<{ b: Billing }>(`select lms.school_billing() as b`)).rows[0].b);
const stopStatus = (claims: JwtClaims) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ s: Record<string, unknown> }>(`select admin.stop_status() as s`)).rows[0].s);
const raise = () =>
  rpc<{ invoiceId: string; number: string }>(db, fresh(owner), 'billing_invoice_raise', {
    p_org: org,
    p_description: 'Term fee',
    p_amount_paise: 100000,
    p_due_days: 15,
    p_reason: 'term fee',
    p_env: 'TEST',
  });

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  finance = await makeFinance(db);
  await readySeller(db, owner);
  org = (await billedSchool(db, owner, 'SBOK')).org;
  schoolAdmin = (
    await db.query<{ user_id: string }>(`select user_id from lms.account where org_id = $1 and kind = 'admin'`, [org])
  ).rows[0].user_id;
});
afterAll(async () => {
  await db.close();
});

describe("the school admin's billing notice", () => {
  it('the school admin reads ok, no invoices, when nothing is owed', async () => {
    expect(await billingOf(schoolAdmin)).toEqual({
      state: 'ok',
      graceUntil: null,
      openInvoices: 0,
      duePaise: 0,
      earliestDueOn: null,
    });
  });

  it('an open invoice is counted with what is still due and its due day; a void one is not', async () => {
    const first = await raise();
    const { rows } = await db.query<{ total_paise: string; due_on: string }>(
      `select total_paise::text, to_char(due_on, 'YYYY-MM-DD') as due_on from billing.invoice where id = $1`,
      [first.invoiceId],
    );
    const b = await billingOf(schoolAdmin);
    expect(b.openInvoices).toBe(1);
    expect(b.duePaise).toBe(Number(rows[0].total_paise));
    expect(b.earliestDueOn).toBe(rows[0].due_on);

    const second = await raise();
    await rpc(db, fresh(owner), 'billing_invoice_void', {
      p_invoice: second.invoiceId,
      p_reason: 'raised twice',
      p_env: 'TEST',
      p_commit: true,
    });
    expect((await billingOf(schoolAdmin)).openInvoices).toBe(1);
  });

  it('grace says its last day; suspended and ended say suspended', async () => {
    await setLicence(db, 'SBOK', 100, -3);
    const until = (await db.query<{ d: string }>(`select (lms.india_today() - 3 + 14)::text as d`)).rows[0].d;
    expect(await billingOf(schoolAdmin)).toMatchObject({ state: 'grace', graceUntil: until });
    await setLicence(db, 'SBOK', 100, -20);
    expect(await billingOf(schoolAdmin)).toMatchObject({ state: 'suspended', graceUntil: null });
    await setLicence(db, 'SBOK', 100, -100);
    expect(await billingOf(schoolAdmin)).toMatchObject({ state: 'suspended', graceUntil: null });
  });

  it('only the school admin may read it', async () => {
    const teacher = (
      await db.query<{ user_id: string }>(`select user_id from lms.account where org_id = $1 and kind = 'teacher' limit 1`, [org])
    ).rows[0].user_id;
    const student = (
      await db.query<{ user_id: string }>(`select user_id from lms.account where org_id = $1 and kind = 'student' limit 1`, [org])
    ).rows[0].user_id;
    await expect(billingOf(teacher)).rejects.toThrow(/only the school admin can see this/);
    await expect(billingOf(student)).rejects.toThrow(/only the school admin can see this/);
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'lms.school_billing()', 'execute') as ok`,
    );
    expect(rows[0].ok).toBe(false);
  });
});

describe("the stop's state", () => {
  it("every staff role reads the stop's state, finance included, and nothing else", async () => {
    for (const who of [owner, ops, safety, finance]) {
      const s = await stopStatus(aal2(who));
      expect(Object.keys(s).sort(), who.role).toEqual(['halted', 'haltedAt', 'haltedReason']);
      expect(s.halted, who.role).toBe(false);
    }
    await asClaims(db, aal2(finance), (tx) => tx.query(`select admin.set_halt(true, 'vendor outage', 'TEST')`));
    try {
      const s = await stopStatus(aal2(finance));
      expect(s).toMatchObject({ halted: true, haltedReason: 'vendor outage' });
      expect(s.haltedAt).not.toBeNull();
    } finally {
      await db.query(`update public.relay_control set halted = false, halted_reason = null, halted_at = null`);
    }
  });

  it('a child or a session without the second factor is refused', async () => {
    const child = await anonymousChild(db);
    await expect(stopStatus({ sub: child, is_anonymous: true })).rejects.toThrow(/not allowed/);
    await expect(stopStatus({ sub: ops.id, aal: 'aal1' })).rejects.toThrow(/not allowed/);
  });
});
