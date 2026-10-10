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
      'admin.api_gate',
      'admin.audit_list',
      'admin.billing_account_set',
      'admin.billing_accounts',
      'admin.billing_grace_set',
      'admin.billing_invoice',
      'admin.billing_invoice_raise',
      'admin.billing_invoice_void',
      'admin.billing_invoices',
      'admin.billing_link_prepare',
      'admin.billing_overview',
      'admin.billing_payment_record',
      'admin.billing_payment_reverse',
      'admin.billing_payments',
      'admin.billing_plan_set',
      'admin.billing_plans',
      'admin.billing_refund_prepare',
      'admin.billing_school',
      'admin.billing_settings',
      'admin.billing_settings_set',
      'admin.billing_subscription_create',
      'admin.billing_subscriptions',
      'admin.billing_webhook_log',
      'admin.case_close',
      'admin.case_context',
      'admin.case_detail',
      'admin.case_open',
      'admin.case_report',
      'admin.cases',
      'admin.class_detail',
      'admin.class_publish',
      'admin.class_remove_prepare',
      'admin.classes',
      'admin.contest_purge_set',
      'admin.direct_user',
      'admin.direct_user_block',
      'admin.direct_user_find',
      'admin.direct_users_summary',
      'admin.erasure_intake',
      'admin.erasure_prepare',
      'admin.erasure_refuse',
      'admin.erasure_request',
      'admin.erasure_requests',
      'admin.erasure_verify',
      'admin.flag_list',
      'admin.flag_set',
      'admin.me',
      'admin.metric_recompute',
      'admin.metric_series',
      'admin.money_view',
      'admin.read_log_list',
      'admin.relay_status',
      'admin.report_mark',
      'admin.restore_drill_set',
      'admin.retention_truth',
      'admin.safety_capture_set',
      'admin.safety_overview',
      'admin.safety_reports',
      'admin.school_activity',
      'admin.school_contact_remove',
      'admin.school_contact_set',
      'admin.school_create',
      'admin.school_detail',
      'admin.school_export',
      'admin.school_health',
      'admin.school_index',
      'admin.school_list',
      'admin.school_note_add',
      'admin.school_notes',
      'admin.school_offboard',
      'admin.school_people',
      'admin.school_person',
      'admin.school_person_disable',
      'admin.school_privacy_list',
      'admin.school_privacy_set',
      'admin.school_quiet_set',
      'admin.school_set_licence',
      'admin.school_weekly',
      'admin.set_caps',
      'admin.set_halt',
      'admin.staff_invite',
      'admin.staff_list',
      'admin.staff_roster',
      'admin.staff_set',
      'admin.stop_status',
      'admin.system_health',
      'admin.today',
    ]);
  });

  it('keeps the service-role tools to the service role', async () => {
    const service = await callableBy('service_role');
    expect(service).toEqual(
      expect.arrayContaining([
        'admin.alert_token_set',
        'admin.billing_compute_states',
        'admin.billing_link_created',
        'admin.billing_link_failed',
        'admin.billing_link_observed',
        'admin.billing_reconcile_done',
        'admin.billing_reconcile_due',
        'admin.billing_refund_result',
        'admin.billing_signature_failed',
        'admin.billing_webhook_ingest',
        'admin.bootstrap_owner',
        'admin.bootstrap_status',
        'admin.class_files_removed',
        'admin.erasure_complete',
        'admin.metric_nightly',
        'admin.privacy_daily',
        'admin.revert_caps',
        'admin.set_environment',
      ]),
    );
    const signedIn = await callableBy('authenticated');
    for (const fn of [
      'admin.alert_token_set',
      'admin.billing_compute_states',
      'admin.billing_link_created',
      'admin.billing_link_failed',
      'admin.billing_link_observed',
      'admin.billing_reconcile_done',
      'admin.billing_reconcile_due',
      'admin.billing_refund_result',
      'admin.billing_signature_failed',
      'admin.billing_webhook_ingest',
      'admin.bootstrap_owner',
      'admin.bootstrap_status',
      'admin.class_files_removed',
      'admin.erasure_complete',
      'admin.metric_nightly',
      'admin.privacy_daily',
      'admin.revert_caps',
      'admin.set_environment',
    ]) {
      expect(signedIn).not.toContain(fn);
    }
  });

  it('keeps the internals of plans 5 and 6 and the flag door away from browsers', async () => {
    const executable = async (role: string, schema: string, name: string) =>
      (
        await db.query<{ ok: boolean }>(
          `select bool_or(has_function_privilege($1, p.oid, 'execute')) as ok
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = $2 and p.proname = $3`,
          [role, schema, name],
        )
      ).rows[0].ok;
    for (const [schema, name] of [
      ['admin', 'distress_capture'],
      ['admin', 'privacy_import_refusal'],
      ['admin', 'reads_today'],
      ['admin', 'class_cost_for'],
      ['admin', 'erasure_counts'],
      ['admin', 'scrub_login'],
      ['admin', 'activity_lines_naming'],
      ['admin', 'erasure_row'],
      ['admin', 'contest_purge_due'],
      ['admin', 'ist_start'],
      ['admin', 'chart_roles'],
      ['admin', 'signins_readable'],
      ['admin', 'metric_json'],
      ['admin', 'metric_compute'],
      ['admin', 'ceiling_on'],
      ['admin', 'metric_family_tutor'],
      ['admin', 'metric_family_spend'],
      ['admin', 'metric_family_relay'],
      ['admin', 'metric_family_calls'],
      ['admin', 'metric_family_money'],
      ['admin', 'metric_family_webhooks'],
      ['admin', 'metric_family_schools'],
      ['public', 'keep_safety_event'],
    ]) {
      expect(await executable('authenticated', schema, name), `${schema}.${name}`).toBe(false);
      expect(await executable('anon', schema, name), `${schema}.${name}`).toBe(false);
    }
    expect(await executable('anon', 'lms', 'report_problem')).toBe(false);
    expect(await executable('authenticated', 'lms', 'report_problem')).toBe(true);
  });

  it('exposes only three functions to the public schema for the apps and the outside checkers', async () => {
    const { rows } = await db.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('app_config', 'alert_snapshot', 'audit_head', 'my_app_config')
          and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(rows.map((r) => r.fn)).toEqual(['alert_snapshot', 'app_config', 'audit_head', 'my_app_config']);
  });
});
