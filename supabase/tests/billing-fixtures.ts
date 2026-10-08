import type { PGlite } from '@electric-sql/pglite';
import { fresh } from './admin-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { asClaims, asService, createUser, type JwtClaims } from './harness.ts';

/** A finance member, made as makeStaff makes the others (admin-fixtures.ts), with the role plan 3 adds. */
export async function makeFinance(db: PGlite, name = 'finance person'): Promise<{ id: string; role: 'finance' }> {
  const id = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
  await db.query(`insert into admin.platform_staff (user_id, role, display_name) values ($1, 'finance', $2)`, [id, name]);
  return { id, role: 'finance' };
}

/**
 * Calls admin.<fn> with named arguments as the given claims, the way the
 * console's transport does: an argument called p_value travels as jsonb.
 */
export async function rpc<T>(db: PGlite, claims: JwtClaims, fn: string, args: Record<string, unknown>): Promise<T> {
  const names = Object.keys(args).filter((k) => args[k] !== undefined);
  return asClaims(db, claims, async (tx) => {
    const { rows } = await tx.query<{ v: T }>(
      `select admin.${fn}(${names.map((n, i) => `${n} => $${i + 1}${n === 'p_value' ? '::jsonb' : ''}`).join(', ')}) as v`,
      names.map((n) => (n === 'p_value' ? JSON.stringify(args[n]) : args[n])),
    );
    return rows[0].v;
  });
}

/** Calls admin.<fn> with named arguments as the service role, the way the two Edge Functions do. */
export async function serviceRpc<T>(db: PGlite, fn: string, args: Record<string, unknown>): Promise<T> {
  const names = Object.keys(args).filter((k) => args[k] !== undefined);
  return asService(db, async (tx) => {
    const { rows } = await tx.query<{ v: T }>(
      `select admin.${fn}(${names.map((n, i) => `${n} => $${i + 1}${n === 'p_value' ? '::jsonb' : ''}`).join(', ')}) as v`,
      names.map((n) => (n === 'p_value' ? JSON.stringify(args[n]) : args[n])),
    );
    return rows[0].v;
  });
}

/** The seller's details the tests use. Test values only: the real ones are the CA's (Aarav's steps). */
export const SELLER = {
  legalName: 'Qrie Learning Private Limited',
  gstin: '27AAAAA0000A1Z5',
  state: '27',
  address: 'Pune, Maharashtra',
  sac: '999293',
  rateBp: 1800,
  title: 'Tax invoice',
} as const;

/** Sets the seller's details as the owner with a fresh code, so invoices can be raised. */
export async function readySeller(db: PGlite, owner: { id: string }): Promise<void> {
  await rpc(db, fresh(owner), 'billing_settings_set', {
    p_legal_name: SELLER.legalName,
    p_gstin: SELLER.gstin,
    p_state: SELLER.state,
    p_address: SELLER.address,
    p_sac: SELLER.sac,
    p_gst_rate_bp: SELLER.rateBp,
    p_title: SELLER.title,
    p_reason: 'test seller',
    p_env: 'TEST',
  });
}

/** Puts a plan on sale as the owner with a fresh code. */
export async function readyPlan(
  db: PGlite,
  owner: { id: string },
  code = 'standard',
  months = 12,
  seatPricePaise = 50_000,
): Promise<void> {
  await rpc(db, fresh(owner), 'billing_plan_set', {
    p_code: code,
    p_name: code === 'standard' ? 'Standard' : code,
    p_months: months,
    p_seat_price_paise: seatPricePaise,
    p_active: true,
    p_reason: 'test plan',
    p_env: 'TEST',
  });
}

/** The billing contact every billed school in the tests has unless told otherwise. */
export const CONTACT = { name: 'Meera Rao', email: 'accounts@school.example', phone: '9876543210' } as const;

/** A school (fixtures.ts buildSchool) with a billing account set by `who` (owner or ops). */
export async function billedSchool(
  db: PGlite,
  who: { id: string },
  code: string,
  over: Partial<{ state: string; gstin: string | null; phone: string | null; email: string | null }> = {},
): Promise<{ org: string; code: string }> {
  const school = await buildSchool(db, code);
  await rpc(db, fresh(who), 'billing_account_set', {
    p_org: school.org,
    p_legal_name: `${code} Education Trust`,
    p_gstin: over.gstin === undefined ? null : over.gstin,
    p_state: over.state ?? '27',
    p_address: `1 School Road, ${code} Town`,
    p_contact_name: CONTACT.name,
    p_contact_email: over.email === undefined ? CONTACT.email : over.email,
    p_contact_phone: over.phone === undefined ? CONTACT.phone : over.phone,
    p_reason: 'test account',
    p_env: 'TEST',
  });
  return { org: school.org, code };
}

/** Sells `seats` of `plan` from `startsOn` and returns the subscription and its invoice. */
export async function subscribe(
  db: PGlite,
  who: { id: string },
  org: string,
  plan: string,
  seats: number,
  startsOn: string,
  dueDays = 15,
): Promise<{ subscriptionId: string; invoiceId: string; number: string }> {
  return rpc(db, fresh(who), 'billing_subscription_create', {
    p_org: org,
    p_plan: plan,
    p_seats: seats,
    p_starts_on: startsOn,
    p_due_days: dueDays,
    p_reason: 'test subscription',
    p_env: 'TEST',
  });
}
