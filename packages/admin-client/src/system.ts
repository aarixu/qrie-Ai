import { guard } from './read.ts';
import type { Write } from './schools.ts';
import type { AdminTransport } from './transport.ts';

/**
 * The System page (migration 0055): the platform's own health as one call,
 * and the date of the last restore drill. What the database cannot see reads
 * 'not-captured' (Cashfree: captured false), never zero.
 */

export interface JobRun {
  name: string;
  schedule: string;
  active: boolean;
  /** pg_cron's status text, 'never-run', or 'not-captured'. */
  lastStatus: string;
  lastStartedAt: string | null;
  lastEndedAt: string | null;
}

export interface SystemHealth {
  environment: string;
  generatedAt: string;
  relay: { halted: boolean; haltedReason: string | null; events5m: number; failures5m: number };
  jobs: JobRun[];
  /** tokenMisses1h: wrong tokens given to the alarm or the audit copy in the last hour (0075). */
  alarm: { lastCheckMinutesAgo: number | null; tokenMisses1h: number };
  auditCopy: { lastCheckMinutesAgo: number | null };
  /** The highest applied migration, or 'not-captured'. */
  migrations: { level: string };
  restoreDrill: { on: string | null; daysAgo: number | null };
  /** head: the first 12 hex characters of the newest chain hash. */
  auditChain: { entries: number; intact: boolean; firstBreakSeq: number | null; unchained: number; head: string | null };
  cashfree: {
    captured: boolean;
    lastWebhookMinutesAgo: number | null;
    signatureFailures24h: number | null;
    unprocessed: number | null;
    reconciledMinutesAgo: number | null;
  };
}

export interface SystemClient {
  health(): Promise<SystemHealth>;
  setRestoreDrill(i: { on: string } & Write): Promise<void>;
}

export function createSystemClient(t: AdminTransport): SystemClient {
  return {
    health: () => guard(async () => (await t.value('system_health')) as SystemHealth),
    async setRestoreDrill(i) {
      await guard(() => t.value('restore_drill_set', { p_on: i.on, p_reason: i.reason, p_env: i.env }));
    },
  };
}
