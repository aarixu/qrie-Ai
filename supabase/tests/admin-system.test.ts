// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { addHostedStandIns } from './admin-standins.ts';
import { asClaims, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * THE SYSTEM PAGE (migration 0055). Written first.
 *
 * Pins admin.system_health: the relay and its failures in five minutes, each
 * scheduled job's last run, when the alarm and the audit copy last checked,
 * the migration level, the last restore drill, the audit chain's state, and
 * Cashfree's webhook health from billing's log once that exists; and what
 * reads 'not-captured' (or captured false) where a hosted-only table is
 * missing. Also the restore drill date and who may record it.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let child: string;
beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  child = await anonymousChild(db);
});
afterAll(async () => {
  await db.close();
});

interface Job { name: string; schedule: string; active: boolean; lastStatus: string; lastStartedAt: string | null; lastEndedAt: string | null }
interface Health {
  environment: string;
  relay: { halted: boolean; haltedReason: string | null; events5m: number; failures5m: number };
  jobs: Job[];
  alarm: { lastCheckMinutesAgo: number | null };
  auditCopy: { lastCheckMinutesAgo: number | null };
  migrations: { level: string };
  restoreDrill: { on: string | null; daysAgo: number | null };
  auditChain: { entries: number; intact: boolean; firstBreakSeq: number | null; unchained: number; head: string };
  cashfree: Record<string, unknown>;
}
const health = (claims: JwtClaims = aal2(ops), d: PGlite = db) =>
  asClaims(d, claims, async (tx) => (await tx.query<{ v: Health }>(`select admin.system_health() as v`)).rows[0].v);
const TOKEN = 'c'.repeat(40);

describe('the System page', () => {
  it("is for staff; reads the relay and its failures in 5 minutes, and 'not-captured' where the platform tables are missing", async () => {
    await expect(health({ sub: child, aal: 'aal2' })).rejects.toThrow(/not allowed/);
    await expect(health({ sub: ops.id, aal: 'aal1' })).rejects.toThrow(/not allowed/);
    for (const status of [200, 503, 0]) {
      await db.query(`insert into public.usage_event (user_id, relay, provider, status) values ($1, 'llm', 'vertex', $2)`, [child, status]);
    }
    const h = await health(aal2(safety));
    expect(h.environment).toBe('TEST');
    expect(h.relay).toMatchObject({ halted: false, events5m: 3, failures5m: 2 });
    expect(h.jobs.length).toBeGreaterThan(0);
    expect(h.jobs.every((j) => j.lastStatus === 'not-captured')).toBe(true);
    const names = h.jobs.map((j) => j.name);
    for (const name of ['admin-revert-caps', 'lms-finalize-tests', 'purge-old-ledger']) expect(names).toContain(name);
    expect(h.migrations.level).toBe('not-captured');
    expect(h.restoreDrill.on).toBeNull();
  });

  it('reads each scheduled job\'s last run from cron.job_run_details when it exists', async () => {
    await addHostedStandIns(db);
    const jobid = (await db.query<{ jobid: number }>(`select jobid from cron.job where jobname = 'admin-revert-caps'`)).rows[0].jobid;
    await db.query(
      `insert into cron.job_run_details (jobid, status, start_time, end_time) values
         ($1, 'succeeded', '2026-10-01T10:00:00Z', '2026-10-01T10:00:01Z'),
         ($1, 'failed', '2026-10-02T10:00:00Z', '2026-10-02T10:00:02Z')`,
      [jobid],
    );
    const h = await health();
    const revert = h.jobs.find((j) => j.name === 'admin-revert-caps')!;
    expect(revert.lastStatus).toBe('failed');
    expect(new Date(revert.lastStartedAt!).toISOString()).toBe('2026-10-02T10:00:00.000Z');
    expect(h.jobs.find((j) => j.name === 'purge-old-ledger')?.lastStatus).toBe('never-run');
  });

  it('reads the migration level from supabase_migrations when it exists', async () => {
    await db.query(`insert into supabase_migrations.schema_migrations (version) values ('0051'), ('0055')`);
    expect((await health()).migrations.level).toBe('0055');
  });

  it('shows when the alarm and the audit copy last checked', async () => {
    await db.query(
      `insert into admin.setting (key, value) values ('alert_last_seen', to_jsonb((now() - interval '7 minutes')::text))
       on conflict (key) do update set value = excluded.value`,
    );
    await db.query(`select admin.alert_token_set($1)`, [TOKEN]);
    const answer = await db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      return (await tx.query<{ v: Record<string, unknown> }>(`select public.audit_head($1) as v`, [TOKEN])).rows[0].v;
    });
    expect(answer.intact).toBe(true);
    const h = await health();
    expect(h.alarm.lastCheckMinutesAgo).toBe(7);
    expect(h.auditCopy.lastCheckMinutesAgo).toBe(0);
  });

  it('a restore drill date: owner or ops, with a reason, not in the future and not over a year ago', async () => {
    const drill = (claims: JwtClaims, on: string, env = 'TEST') =>
      asClaims(db, claims, (tx) => tx.query(`select admin.restore_drill_set(${on}, 'restored into a scratch project', $1)`, [env]));
    await drill(aal2(ops), 'lms.india_today() - 3');
    const on = (await db.query<{ d: string }>(`select to_char(lms.india_today() - 3, 'YYYY-MM-DD') as d`)).rows[0].d;
    expect((await health()).restoreDrill).toEqual({ on, daysAgo: 3 });
    await expect(drill(aal2(ops), 'lms.india_today() + 1')).rejects.toThrow(/in the last year/);
    await expect(drill(aal2(ops), 'lms.india_today() - 366')).rejects.toThrow(/in the last year/);
    await expect(drill(aal2(safety), 'lms.india_today() - 3')).rejects.toThrow(/not allowed/);
    await expect(drill(aal2(ops), 'lms.india_today() - 3', 'HOSTED')).rejects.toThrow(/this console is TEST/);
    await expect(drill(aal2(owner), 'lms.india_today() - 2')).resolves.toBeDefined();
    const rows = await db.query(`select 1 from admin.audit_event where action = 'restore-drill-recorded'`);
    expect(rows.rows.length).toBe(2);
  });

  it("shows the audit chain's state", async () => {
    const h = await health();
    expect(h.auditChain.intact).toBe(true);
    expect(h.auditChain.entries).toBeGreaterThan(0);
    expect(h.auditChain.head).toMatch(/^[0-9a-f]{12}$/);
  });

  it("reads Cashfree's webhook health from billing's log once it exists, and says not captured before", async () => {
    const early = await freshDatabase({ through: '0055' });
    try {
      await setEnvironment(early);
      const boss = await makeStaff(early, 'owner', 'Aarav');
      expect((await health(aal2(boss), early)).cashfree).toEqual({
        captured: false,
        lastWebhookMinutesAgo: null,
        signatureFailures24h: null,
        unprocessed: null,
        reconciledMinutesAgo: null,
      });
      await early.exec(`
        create schema if not exists billing;
        create table billing.webhook_event (
          id bigint generated always as identity primary key,
          received_at timestamptz not null, signature_ok boolean not null, status text not null
        );
        insert into billing.webhook_event (received_at, signature_ok, status) values
          (now() - interval '30 minutes', true, 'processed'),
          (now() - interval '5 minutes', true, 'stored'),
          (now() - interval '2 hours', false, 'signature_failed'),
          (now() - interval '30 hours', false, 'signature_failed');
        insert into admin.setting (key, value) values ('billing_reconciled_at', to_jsonb((now() - interval '70 minutes')::text));
      `);
      expect((await health(aal2(boss), early)).cashfree).toEqual({
        captured: true,
        lastWebhookMinutesAgo: 5,
        signatureFailures24h: 1,
        unprocessed: 1,
        reconciledMinutesAgo: 70,
      });
    } finally {
      await early.close();
    }
  });
});
