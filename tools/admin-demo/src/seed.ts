import { randomBytes } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { SELLER } from '../../../supabase/tests/billing-fixtures.ts';
import { keepFlag, report } from '../../../supabase/tests/safety-fixtures.ts';
import type { Seeded } from '../../lms-demo/src/seed.ts';
import type { DemoAuth } from './auth.ts';
import type { DemoFunctions } from './functions.ts';
import { rpcValue, type Caller } from './rest.ts';

/**
 * WHAT THE LOCAL DEMO HOLDS BESIDE THE DEMO SCHOOL, made through the real
 * functions wherever they exist, by the people who would make it:
 *
 *   environment  DEMO, set as the bootstrap sets it (admin.set_environment).
 *   staff        the owner, made as tools/admin-bootstrap makes one (an account
 *                marked provisioned_by = 'staff', then admin.bootstrap_owner), with
 *                an authenticator already set up. Safety: invited by the owner
 *                (admin.staff_invite), authenticator set up, switched on
 *                (admin.staff_set). Ops: invited only, no authenticator: they set
 *                one up at their first sign-in and the owner then switches them on
 *                (the real order). Finance: put on the list directly, as the
 *                tests' makeFinance does, active with no authenticator yet: at the
 *                first sign-in the console makes them set one up.
 *   a 2nd school Sunrise Public School, made with admin.school_create and its
 *                people added through admin-api's import as the owner, a pilot
 *                licence; no activity yet.
 *   billing      seller details (the tests' made-up SELLER), a Standard plan, the
 *                demo school's billing account and a year's subscription. Its
 *                invoice is then dated back (issued 20 days ago, due 5 days ago),
 *                as the tests date one back, and a part payment by bank transfer
 *                is recorded by hand, so it is partly paid and overdue: the health
 *                card's Payment signal is amber. A second invoice is raised, due
 *                in 15 days. The billing states are then computed once
 *                (admin.billing_compute_states, nightly on the hosted project).
 *   safety       three children's reports (one 'unsafe') kept through
 *                public.keep_student_report and a distress flag through
 *                public.keep_safety_event, as the relay keeps them (the tests'
 *                report and keepFlag); a prepared class waiting for review, a
 *                prepared_class row and its manifest in the classes bucket,
 *                written as the tests' classRow writes one.
 *   charts       admin.metric_nightly once, as the service role (pg_cron runs it
 *                nightly on the hosted project), then the owner's recompute of
 *                the last 30 days.
 *   switches     a banner, set by the owner.
 *   the alarm    a random token set with the service role (admin.alert_token_set),
 *                never shown, and one read of public.alert_snapshot with it as a
 *                signed-out caller, as the outside checker reads it:
 *                the Alarm checker tile shows that read, and grows stale, because
 *                no checker runs here and nothing is sent anywhere.
 *
 * Every name, address and number below is made up for this demo.
 */

/** TEST VALUE: the one password every demo staff account has. Local demo only; listed in the README. */
export const DEMO_PASSWORD = 'qrie-local-demo';

export const DEMO_STAFF = {
  owner: { email: 'owner@qrie-demo.example', name: 'Aarav', role: 'owner' },
  ops: { email: 'ops@qrie-demo.example', name: 'Kabir Malhotra', role: 'ops' },
  safety: { email: 'safety@qrie-demo.example', name: 'Sneha Iyer', role: 'safety' },
  finance: { email: 'finance@qrie-demo.example', name: 'Farah Khan', role: 'finance' },
} as const;

export const DEMO_ENV = 'DEMO';
export const SECOND_SCHOOL = { code: 'SUNRISE', name: 'Sunrise Public School' };

const SUNRISE_STUDENTS = `Class,Section,Roll No.,Student Name
7,A,1,Aditi Rao
7,A,2,Arjun Mehta
7,A,3,Diya Kapoor
7,A,4,Ishaan Bose
7,A,5,Kavya Pillai
7,A,6,Krish Agarwal
7,A,7,Meera Joshi
7,A,8,Neel Banerjee
7,A,9,Riya Saxena
7,A,10,Sahil Chauhan
7,A,11,Tara Reddy
7,A,12,Vivaan Shetty
`;
const SUNRISE_TEACHERS = `Teacher Name,Role,Classes and Subjects
Deepa Menon,teacher,7A Mathematics; 7A Science
Ravi Kulkarni,admin,
`;

export interface DemoSeedSummary {
  ownerId: string;
  staff: Record<keyof typeof DEMO_STAFF, string>;
  schools: string[];
  reports: number;
  metricRows: number;
}

export async function seedAdminDemo(
  db: PGlite,
  auth: DemoAuth,
  functions: DemoFunctions,
  school: Seeded,
): Promise<DemoSeedSummary> {
  const service: Caller = { role: 'service_role' };
  const call = <T = unknown>(caller: Caller, fn: string, args: Record<string, unknown> = {}) =>
    rpcValue<T>(db, { schema: 'admin', fn, args, caller });
  const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
  const today = (await one<{ d: string }>(`select lms.india_today()::text as d`)).d;
  const day = (offset: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  // ---- The owner, as tools/admin-bootstrap provisions one ------------------
  await call(service, 'set_environment', { p_env: DEMO_ENV });
  const ownerId = await auth.createStaffAccount(DEMO_STAFF.owner.email, DEMO_PASSWORD);
  await call(service, 'bootstrap_owner', { p_user: ownerId, p_name: DEMO_STAFF.owner.name });
  await auth.addVerifiedFactor(ownerId, 'Qrie control');
  // Signed in with a code verified just now, as the owner would be.
  const ownerSession = await auth.sessionFor(ownerId, 'aal2');
  const ownerToken = ownerSession.access_token;
  const verified = auth.verifyAccessToken(ownerToken);
  if (!verified.ok) throw new Error('the demo could not read its own token');
  const owner: Caller = { role: 'authenticated', claims: verified.claims };
  const env = { p_env: DEMO_ENV };

  // ---- The rest of the staff ----------------------------------------------
  const safetyId = await auth.createStaffAccount(DEMO_STAFF.safety.email, DEMO_PASSWORD);
  await call(owner, 'staff_invite', { p_user: safetyId, p_role: 'safety', p_name: DEMO_STAFF.safety.name, p_reason: 'safety reviewer for the demo', ...env });
  await auth.addVerifiedFactor(safetyId, 'Qrie control');
  await call(owner, 'staff_set', { p_user: safetyId, p_role: 'safety', p_name: DEMO_STAFF.safety.name, p_active: true, p_reason: 'authenticator set up', ...env });

  const opsId = await auth.createStaffAccount(DEMO_STAFF.ops.email, DEMO_PASSWORD);
  await call(owner, 'staff_invite', { p_user: opsId, p_role: 'ops', p_name: DEMO_STAFF.ops.name, p_reason: 'operations for the demo', ...env });

  const financeId = await auth.createStaffAccount(DEMO_STAFF.finance.email, DEMO_PASSWORD);
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('admin.session', 'on', true)`);
    await tx.query(`insert into admin.platform_staff (user_id, role, display_name, created_by) values ($1, 'finance', $2, $3)`, [
      financeId,
      DEMO_STAFF.finance.name,
      ownerId,
    ]);
  });

  // ---- The demo school's page: a contact, a note, its privacy decision ------
  const demoCode = 'DEMO';
  await call(owner, 'school_contact_set', {
    p_code: demoCode, p_id: null, p_name: 'Anita Desai', p_role: 'Principal', p_phone: '+919800000001',
    p_email: 'principal@demo-school.example', p_reason: 'first call', ...env,
  });
  await call(owner, 'school_note_add', {
    p_code: demoCode, p_kind: 'call',
    p_body: 'Spoke to the principal: teachers like the homework reports; they want marks on report cards before the term ends.',
    p_reason: 'call log', ...env,
  });
  await call(owner, 'school_privacy_set', {
    p_code: demoCode, p_fiduciary: 'school', p_recipient: 'school-and-parent', p_basis: 'made up for the demo', p_reason: 'demo decision', ...env,
  });

  // ---- A second school, through the real calls ----------------------------
  await call(owner, 'school_create', {
    p_code: SECOND_SCHOOL.code, p_name: SECOND_SCHOOL.name, p_board: 'CBSE', p_year_label: '2026-27',
    p_starts_on: '2026-04-01', p_ends_on: '2027-03-31', p_reason: 'signed up for a pilot', ...env,
  });
  const imported = await functions.adminApi({
    method: 'POST',
    path: '/functions/v1/admin-api/import',
    authorization: `Bearer ${ownerToken}`,
    body: { code: SECOND_SCHOOL.code, students: SUNRISE_STUDENTS, teachers: SUNRISE_TEACHERS, commit: true, acceptWarnings: true, reason: 'first sheets from the school', env: DEMO_ENV },
  });
  if (imported.status !== 200) throw new Error(`the second school's import failed: ${JSON.stringify(imported.body)}`);
  await call(owner, 'school_set_licence', { p_code: SECOND_SCHOOL.code, p_plan: 'pilot', p_seats: 20, p_until: day(60), p_reason: 'pilot term', ...env });

  // ---- Billing --------------------------------------------------------------
  await call(owner, 'billing_settings_set', {
    p_legal_name: SELLER.legalName, p_gstin: SELLER.gstin, p_state: SELLER.state, p_address: SELLER.address,
    p_sac: SELLER.sac, p_gst_rate_bp: SELLER.rateBp, p_title: SELLER.title, p_reason: 'seller details (made up)', ...env,
  });
  await call(owner, 'billing_plan_set', {
    p_code: 'standard', p_name: 'Standard', p_months: 12, p_seat_price_paise: 50_000, p_active: true, p_reason: 'first plan', ...env,
  });
  await call(owner, 'billing_account_set', {
    p_org: school.orgId, p_legal_name: 'Qrie Demo School Education Trust', p_gstin: null, p_state: '27',
    p_address: '12 Demo Road, Pune, Maharashtra', p_contact_name: 'Anita Desai', p_contact_email: 'accounts@demo-school.example',
    p_contact_phone: '9800000001', p_reason: 'billing details from the school', ...env,
  });
  const sub = await call<{ invoiceId: string }>(owner, 'billing_subscription_create', {
    p_org: school.orgId, p_plan: 'standard', p_seats: 90, p_starts_on: day(-20), p_due_days: 15, p_reason: 'annual subscription', ...env,
  });
  // Dated back as the tests date an invoice back: as the database owner, with
  // the invoice guard's trigger off for this one statement.
  await db.transaction(async (tx) => {
    await tx.exec(`set local session_replication_role = replica`);
    await tx.query(`update billing.invoice set issued_on = $2::date, due_on = $3::date where id = $1`, [sub.invoiceId, day(-20), day(-5)]);
  });
  await call(owner, 'billing_payment_record', {
    p_invoice: sub.invoiceId, p_source: 'bank_transfer', p_amount_paise: 1_500_000, p_received_on: day(-3),
    p_reference: 'UTR-DEMO-000123', p_reason: 'first instalment arrived', ...env,
  });
  await call(owner, 'billing_invoice_raise', {
    p_org: school.orgId, p_description: 'Teacher training workshop (one day)', p_amount_paise: 1_200_000, p_due_days: 15,
    p_reason: 'workshop booked by the school', ...env,
  });
  await call(service, 'billing_compute_states');

  // ---- Safety ---------------------------------------------------------------
  const students = school.logins.filter((l) => l.kind === 'student');
  const [s1, s2, s3, s4] = [students[3], students[17], students[40], students[55]].map((s) => s ?? students[0]);
  await report(db, s1.userId, { kind: 'unsafe', note: 'The tutor said I could try the candle experiment at home by myself.', lessonId: 'science-8-combustion', receivedMinutesAgo: 95 });
  await report(db, s2.userId, { kind: 'wrong', note: 'It said 3/4 is smaller than 2/3.', lessonId: 'maths-7-fractions', receivedMinutesAgo: 30 });
  await report(db, s3.userId, { kind: 'other', note: 'The voice was too fast in the second part.', lessonId: 'science-6-plants', receivedMinutesAgo: 60 * 26 });
  await keepFlag(db, s4.userId, { direction: 'from-student', at: new Date(Date.now() - 50 * 60_000).toISOString() });
  // A class the tutor prepared, waiting for review: its row and its manifest, as the tests' classRow writes them.
  await db.query(
    `insert into public.prepared_class (id, topic_ref, title, subtitle, klass, subject, review_status)
     values ('cbse-10-science-reflex-actions', 'cbse-10-science/control-and-coordination/reflex-actions', 'Reflex Actions',
             'Why your hand moves before you feel the heat', 10, 'science', 'pending')`,
  );
  await db.query(`insert into storage.objects (bucket_id, name) values ('classes', 'cbse-10-science-reflex-actions/manifest.json')`);

  // ---- Switches ---------------------------------------------------------------
  await call(owner, 'flag_set', {
    p_key: 'banner.message', p_scope: 'global', p_scope_id: '', p_value: 'Half-yearly exams next week: homework deadlines move to Friday.',
    p_reason: 'exam week notice', ...env,
  });

  // ---- Charts -----------------------------------------------------------------
  await call(service, 'metric_nightly');
  const recomputed = await call<{ rows: number }>(owner, 'metric_recompute', {
    p_from: day(-30), p_to: day(-1), p_reason: 'fill the charts for the demo', ...env,
  });

  // ---- The alarm ------------------------------------------------------------------
  const alarmToken = randomBytes(32).toString('base64url');
  await call(service, 'alert_token_set', { p_token: alarmToken });
  await rpcValue(db, { schema: 'public', fn: 'alert_snapshot', args: { p_token: alarmToken }, caller: { role: 'anon' } });

  return {
    ownerId,
    staff: { owner: ownerId, ops: opsId, safety: safetyId, finance: financeId },
    schools: [demoCode, SECOND_SCHOOL.code],
    reports: 3,
    metricRows: recomputed.rows,
  };
}
