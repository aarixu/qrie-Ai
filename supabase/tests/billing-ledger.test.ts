// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { billedSchool, CONTACT, makeFinance, rpc, SELLER, subscribe } from './billing-fixtures.ts';
import { asClaims, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * THE BILLING LEDGER (migration 0057). Written first.
 *
 * Qrie's own numbered invoice is the record (spec section 10): numbers run
 * without gaps per Indian financial year, GST is split by the two state codes,
 * and an issued invoice is never edited or deleted, even by hand.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let child: string;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety');
  finance = await makeFinance(db, 'Accounts');
  child = await anonymousChild(db);
});
afterAll(async () => {
  await db.close();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const fyNow = async () => (await one<{ fy: string }>(`select billing.fy_of(lms.india_today()) as fy`)).fy;

interface InvoiceRow {
  id: string;
  number: string;
  seq: number;
  fy: string;
  kind: string;
  description: string;
  quantity: number;
  unit_paise: string;
  taxable_paise: string;
  cgst_paise: string;
  sgst_paise: string;
  igst_paise: string;
  total_paise: string;
  issued_on: string;
  due_on: string;
}
const invoiceRow = (id: string) =>
  one<InvoiceRow>(
    `select id, number, seq, fy, kind, description, quantity, unit_paise::text, taxable_paise::text, cgst_paise::text,
            sgst_paise::text, igst_paise::text, total_paise::text, to_char(issued_on, 'YYYY-MM-DD') as issued_on,
            to_char(due_on, 'YYYY-MM-DD') as due_on
       from billing.invoice where id = $1`,
    [id],
  );

const raise = (claims: JwtClaims, org: string, amountPaise: number, description = 'Teacher training day') =>
  rpc<{ invoiceId: string; number: string }>(db, claims, 'billing_invoice_raise', {
    p_org: org,
    p_description: description,
    p_amount_paise: amountPaise,
    p_due_days: 15,
    p_reason: 'test raise',
    p_env: 'TEST',
  });

const settingsArgs = (over: Record<string, unknown> = {}) => ({
  p_legal_name: SELLER.legalName,
  p_gstin: SELLER.gstin,
  p_state: SELLER.state,
  p_address: SELLER.address,
  p_sac: SELLER.sac,
  p_gst_rate_bp: SELLER.rateBp,
  p_title: SELLER.title,
  p_reason: 'the CA said so',
  p_env: 'TEST',
  ...over,
});

const planArgs = (over: Record<string, unknown> = {}) => ({
  p_code: 'basic',
  p_name: 'Basic',
  p_months: 12,
  p_seat_price_paise: 30_000,
  p_active: true,
  p_reason: 'new price list',
  p_env: 'TEST',
  ...over,
});

let abc: { org: string; code: string };

describe('settings and plans', () => {
  it('nothing is raised until the seller\'s details are complete', async () => {
    abc = await billedSchool(db, ops, 'ABC');
    await expect(raise(aal2(ops), abc.org, 10_000)).rejects.toThrow(/set the seller's details in Billing settings first/);
    expect((await one<{ n: number }>(`select count(*)::int as n from billing.invoice`)).n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int as n from billing.number_counter`)).n).toBe(0);
  });

  it('only the owner, with a fresh code, sets the seller\'s details', async () => {
    await expect(rpc(db, aal2(ops), 'billing_settings_set', settingsArgs())).rejects.toThrow(/not allowed/);
    await expect(rpc(db, aal2(owner), 'billing_settings_set', settingsArgs())).rejects.toThrow(
      /confirm with your authenticator code first/,
    );
    await rpc(db, fresh(owner), 'billing_settings_set', settingsArgs());
    const s = await rpc<Record<string, unknown>>(db, aal2(finance), 'billing_settings', {});
    expect(s).toMatchObject({
      legalName: SELLER.legalName,
      gstin: SELLER.gstin,
      stateCode: '27',
      address: SELLER.address,
      sacCode: SELLER.sac,
      gstRateBp: 1800,
      title: 'Tax invoice',
      ready: true,
    });
    const audit = await one<{ n: number }>(
      `select count(*)::int as n from admin.audit_event where action = 'billing-settings-set' and actor = $1`,
      [owner.id],
    );
    expect(audit.n).toBe(1);
  });

  it('the seller\'s GSTIN must start with its state code, and there is no GST without a GSTIN', async () => {
    await expect(
      rpc(db, fresh(owner), 'billing_settings_set', settingsArgs({ p_gstin: '29AAAAA0000A1Z5' })),
    ).rejects.toThrow(/the GSTIN's first two digits are its state code/);
    await expect(rpc(db, fresh(owner), 'billing_settings_set', settingsArgs({ p_gstin: null }))).rejects.toThrow(
      /without a GSTIN the GST rate is 0/,
    );
    await expect(rpc(db, fresh(owner), 'billing_settings_set', settingsArgs({ p_gst_rate_bp: 2900 }))).rejects.toThrow(
      /a GST rate is 0 to 2800 basis points/,
    );
  });

  it('a plan has a lower-case code that is not pilot, 1 to 36 months, and a price in paise', async () => {
    await expect(rpc(db, fresh(owner), 'billing_plan_set', planArgs({ p_code: 'pilot' }))).rejects.toThrow(
      /pilot is a trial, not a plan that is sold/,
    );
    await rpc(db, fresh(owner), 'billing_plan_set', planArgs({ p_code: ' Standard ', p_name: 'Standard', p_seat_price_paise: 50_000 }));
    const plans = await rpc<{ code: string; seatPricePaise: number }[]>(db, aal2(finance), 'billing_plans', {});
    expect(plans.map((p) => p.code)).toContain('standard');
    expect(plans.find((p) => p.code === 'standard')?.seatPricePaise).toBe(50_000);
    await expect(rpc(db, fresh(owner), 'billing_plan_set', planArgs({ p_months: 0 }))).rejects.toThrow(/1 to 36 months/);
    await expect(rpc(db, fresh(owner), 'billing_plan_set', planArgs({ p_seat_price_paise: -1 }))).rejects.toThrow(
      /a price is 0 or more paise/,
    );
    await expect(rpc(db, fresh(ops), 'billing_plan_set', planArgs())).rejects.toThrow(/not allowed/);
  });
});

const accountArgs = (org: string, over: Record<string, unknown> = {}) => ({
  p_org: org,
  p_legal_name: 'Some Trust',
  p_gstin: null,
  p_state: '27',
  p_address: 'Somewhere',
  p_contact_name: 'Someone',
  p_contact_email: null,
  p_contact_phone: null,
  p_reason: 'set the account',
  p_env: 'TEST',
  ...over,
});

describe('accounts', () => {
  it('ops set a school\'s billing account; finance, safety and a child cannot', async () => {
    await rpc(db, aal2(ops), 'billing_account_set', accountArgs(abc.org, { p_legal_name: 'ABC Education Trust' }));
    const row = await one<{ legal_name: string }>(`select legal_name from billing.account where org_id = $1`, [abc.org]);
    expect(row.legal_name).toBe('ABC Education Trust');
    for (const claims of [aal2(finance), aal2(safety), { sub: child, aal: 'aal2' as const, is_anonymous: true }]) {
      await expect(rpc(db, claims, 'billing_account_set', accountArgs(abc.org))).rejects.toThrow(/not allowed/);
    }
    // Put the contact back for the rest of the file.
    await rpc(db, aal2(ops), 'billing_account_set', accountArgs(abc.org, {
      p_legal_name: 'ABC Education Trust',
      p_contact_name: CONTACT.name,
      p_contact_email: CONTACT.email,
      p_contact_phone: CONTACT.phone,
    }));
  });

  it('a contact phone is 10 digits starting 6 to 9 and an email has an @; a school GSTIN matches its state', async () => {
    await expect(rpc(db, aal2(ops), 'billing_account_set', accountArgs(abc.org, { p_contact_phone: '12345' }))).rejects.toThrow(
      /a phone is 10 digits/,
    );
    await expect(rpc(db, aal2(ops), 'billing_account_set', accountArgs(abc.org, { p_contact_email: 'x' }))).rejects.toThrow(
      /that is not an email address/,
    );
    await expect(
      rpc(db, aal2(ops), 'billing_account_set', accountArgs(abc.org, { p_gstin: '29ABCDE1234F1Z5', p_state: '27' })),
    ).rejects.toThrow(/the GSTIN's first two digits are its state code/);
  });
});

describe('raising', () => {
  let firstInvoice: string;

  it('a subscription invoice is seats times price, with CGST and SGST inside one state', async () => {
    const s = await subscribe(db, ops, abc.org, 'standard', 40, '2026-04-01');
    const inv = await invoiceRow(s.invoiceId);
    firstInvoice = s.invoiceId;
    const fy = await fyNow();
    expect(s.number).toBe(`QRIE/${fy}/0001`);
    expect(inv).toMatchObject({
      number: `QRIE/${fy}/0001`,
      seq: 1,
      kind: 'subscription',
      quantity: 40,
      unit_paise: '50000',
      taxable_paise: '2000000',
      cgst_paise: '180000',
      sgst_paise: '180000',
      igst_paise: '0',
      total_paise: '2360000',
    });
    expect(inv.description).toContain('Standard');
    expect(inv.description).toContain('40 seats');
    expect(inv.description).toContain('01 Apr 2026');
    expect(inv.description).toContain('31 Mar 2027');
    const sub = await one<{ ends_on: string }>(
      `select to_char(ends_on, 'YYYY-MM-DD') as ends_on from billing.subscription where id = $1`,
      [s.subscriptionId],
    );
    expect(sub.ends_on).toBe('2027-03-31');
    const due = await one<{ ok: boolean }>(`select due_on = issued_on + 15 as ok from billing.invoice where id = $1`, [s.invoiceId]);
    expect(due.ok).toBe(true);
  });

  it('across states it is IGST', async () => {
    const kar = await billedSchool(db, ops, 'KAR', { state: '29' });
    const s = await subscribe(db, ops, kar.org, 'standard', 40, '2026-04-01');
    expect(await invoiceRow(s.invoiceId)).toMatchObject({ igst_paise: '360000', cgst_paise: '0', sgst_paise: '0', total_paise: '2360000' });
  });

  it('numbers run 0001, 0002 and on, with none repeated or skipped, under twenty raises at once', async () => {
    const made = await Promise.all(Array.from({ length: 20 }, (_, i) => raise(aal2(ops), abc.org, 1000 + i)));
    expect(new Set(made.map((m) => m.number)).size).toBe(20);
    const { rows } = await db.query<{ seq: number; number: string }>(`select seq, number from billing.invoice order by seq`);
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
    expect(new Set(rows.map((r) => r.number)).size).toBe(rows.length);
  });

  it('a raise that fails leaves no gap', async () => {
    const before = await one<{ n: number }>(`select max(seq)::int as n from billing.invoice`);
    await expect(
      asClaims(db, aal2(ops), async (tx) => {
        await tx.query(
          `select admin.billing_invoice_raise(p_org => $1, p_description => 'doomed', p_amount_paise => 500,
                                               p_due_days => 15, p_reason => 'test raise', p_env => 'TEST')`,
          [abc.org],
        );
        throw new Error('the transaction fails after the raise');
      }),
    ).rejects.toThrow(/fails after the raise/);
    const next = await raise(aal2(ops), abc.org, 700);
    expect((await invoiceRow(next.invoiceId)).seq).toBe(before.n + 1);
  });

  it('the financial year turns on 1 April in India', async () => {
    const r = await one<Record<string, string>>(
      `select billing.fy_of('2026-04-01') as a, billing.fy_of('2026-03-31') as b,
              billing.fy_of(('2026-03-31T19:00:00Z'::timestamptz at time zone 'Asia/Kolkata')::date) as c,
              billing.format_number('invoice', '26-27', 7) as d,
              billing.format_number('credit_note', '26-27', 1) as e`,
    );
    expect(r).toEqual({ a: '26-27', b: '25-26', c: '26-27', d: 'QRIE/26-27/0007', e: 'QRCN/26-27/0001' });
    await expect(db.query(`select billing.format_number('invoice', '26-27', 100000)`)).rejects.toThrow(
      /the invoice series is full for this year/,
    );
  });

  it('a school cannot be sold two subscriptions for the same days', async () => {
    await expect(subscribe(db, ops, abc.org, 'standard', 10, '2026-10-01')).rejects.toThrow(
      /this school already has a subscription for part of that time/,
    );
  });

  it('an ad hoc invoice has one line and takes the next number in the same series', async () => {
    const before = await one<{ n: number }>(`select max(seq)::int as n from billing.invoice`);
    const made = await raise(aal2(ops), abc.org, 250_000, 'Printed workbooks');
    const inv = await invoiceRow(made.invoiceId);
    expect(inv).toMatchObject({ kind: 'other', quantity: 1, unit_paise: '250000', taxable_paise: '250000', seq: before.n + 1 });
    expect(made.number).toBe(`QRIE/${await fyNow()}/${String(before.n + 1).padStart(4, '0')}`);
  });

  it('an issued invoice is never edited or deleted, even by hand, and a hand edit elsewhere is logged', async () => {
    const unmanaged = async () =>
      (await one<{ n: number }>(`select count(*)::int as n from admin.audit_event where action = 'unmanaged-change'`)).n;
    expect(await unmanaged()).toBe(0);
    await expect(db.query(`update billing.invoice set total_paise = 1 where id = $1`, [firstInvoice])).rejects.toThrow(
      /an issued invoice is not edited/,
    );
    await expect(db.query(`delete from billing.invoice where id = $1`, [firstInvoice])).rejects.toThrow(
      /billing records are never deleted/,
    );
    await db.query(`update billing.plan set name = 'Standard plan' where code = 'standard'`);
    const { rows } = await db.query<{ target_kind: string }>(
      `select target_kind from admin.audit_event where action = 'unmanaged-change'`,
    );
    expect(rows.map((r) => r.target_kind)).toEqual(['plan']);
  });
});

describe('reading', () => {
  it('the invoice list carries no contact phone, email or name', async () => {
    const list = await rpc<unknown[]>(db, aal2(finance), 'billing_invoices', {});
    expect(list.length).toBeGreaterThan(20);
    const text = JSON.stringify(list);
    for (const secret of [CONTACT.phone, CONTACT.email, CONTACT.name]) expect(text).not.toContain(secret);
    const detail = await rpc<Record<string, unknown>>(db, aal2(finance), 'billing_invoice', {
      p_invoice: (list[0] as { id: string }).id,
    });
    expect(detail).toHaveProperty('number');
    const unpaid = await rpc<{ status: string }[]>(db, aal2(ops), 'billing_invoices', { p_status: 'unpaid' });
    expect(unpaid.every((r) => r.status === 'unpaid')).toBe(true);
  });

  it('a child, an aal1 owner and safety are refused every billing read', async () => {
    const someInvoice = (await one<{ id: string }>(`select id from billing.invoice limit 1`)).id;
    const reads: [string, Record<string, unknown>][] = [
      ['billing_settings', {}],
      ['billing_plans', {}],
      ['billing_invoices', {}],
      ['billing_invoice', { p_invoice: someInvoice }],
      ['billing_subscriptions', {}],
    ];
    const refused: JwtClaims[] = [{ sub: child, aal: 'aal2', is_anonymous: true }, { sub: owner.id, aal: 'aal1' }, aal2(safety)];
    for (const claims of refused) {
      for (const [fn, args] of reads) {
        await expect(rpc(db, claims, fn, args)).rejects.toThrow(/not allowed/);
      }
    }
    const subs = await rpc<{ schoolCode: string }[]>(db, aal2(finance), 'billing_subscriptions', { p_org: abc.org });
    expect(subs.map((s) => s.schoolCode)).toEqual(['ABC']);
  });
});
