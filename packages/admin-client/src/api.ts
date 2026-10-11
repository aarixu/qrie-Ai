import { toAdminError } from './errors.ts';
import type { AdminTransport } from './transport.ts';

export interface Me {
  userId: string;
  role: 'owner' | 'ops' | 'safety' | 'finance';
  displayName: string;
  environment: string;
}

export interface RelayStatus {
  halted: boolean;
  haltedReason: string | null;
  haltedAt: string | null;
  ceilingUnits: number;
  unitsToday: number;
  maxConcurrentPreps: number;
  studentsNow: number;
  utcDay: string;
  capOverride: { previousUnits: number; revertOn: string } | null;
}

/** The stop's state alone (admin.stop_status, 0064): the one status read every staff role may make, finance included. */
export interface StopStatus {
  halted: boolean;
  haltedReason: string | null;
  haltedAt: string | null;
}

export interface Today {
  environment: string;
  generatedAt: string;
  relay: { halted: boolean; haltedReason: string | null; ceilingUnits: number; unitsToday: number; studentsNow: number };
  reports: { newCount: number; unsafeNew: number; oldestNewMinutes: number };
  classes: { pendingCount: number; oldestPendingHours: number };
  contest: { entriesToday: number; dailyCap: number; entriesOpen: boolean };
  schools: { code: string; name: string; plan: string | null; seats: number | null; seatsUsed: number; daysLeft: number | null }[];
  prices: { modelPriceRows: number };
  alarm: { lastCheckMinutesAgo: number | null };
  capture: { distress: string; lastPurge: string };
}

export interface FlagRow {
  key: string;
  kind: 'bool' | 'text' | 'tone' | 'version' | 'count';
  description: string;
  guarded: boolean;
  schoolScoped: boolean;
  safeDefault: unknown;
  scope: 'global' | 'school' | null;
  scopeId: string | null;
  value: unknown;
  updatedAt: string | null;
}

export interface StaffRow {
  userId: string;
  role: 'owner' | 'ops' | 'safety';
  displayName: string;
  active: boolean;
  createdAt: string;
  deactivatedAt: string | null;
}

export interface FlagSetInput {
  key: string;
  scope: 'global' | 'school';
  scopeId?: string;
  value: unknown;
  reason: string;
  env: string;
}

/** Clears one school's own value of a school-scoped switch (admin.flag_clear, 0075): the school follows the platform's value again. */
export interface FlagClearInput {
  key: string;
  scopeId: string;
  reason: string;
  env: string;
}

export interface StaffSetInput {
  userId: string;
  role: Me['role'];
  displayName: string;
  active: boolean;
  reason: string;
  /** The environment this console was built for (plan 1's M2). */
  env: string;
}

export interface AdminClient {
  me(): Promise<Me>;
  relayStatus(): Promise<RelayStatus>;
  stopStatus(): Promise<StopStatus>;
  setHalt(halted: boolean, reason: string, env: string): Promise<void>;
  setCaps(units: number, reason: string, env: string): Promise<void>;
  today(): Promise<Today>;
  flagList(): Promise<FlagRow[]>;
  flagSet(input: FlagSetInput): Promise<void>;
  flagClear(input: FlagClearInput): Promise<void>;
  staffList(): Promise<StaffRow[]>;
  staffSet(input: StaffSetInput): Promise<void>;
}

const str = (v: unknown): string => String(v);
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : str(v));

/** Every call's failure is sorted into an AdminError, so a screen branches on `code`. */
export function createAdminClient(t: AdminTransport): AdminClient {
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (e) {
      throw toAdminError(e);
    }
  };
  return {
    me: () => guard(async () => (await t.value('me')) as Me),
    relayStatus: () => guard(async () => (await t.value('relay_status')) as RelayStatus),
    stopStatus: () => guard(async () => (await t.value('stop_status')) as StopStatus),
    async setHalt(halted, reason, env) {
      await guard(() => t.value('set_halt', { p_halted: halted, p_reason: reason, p_env: env }));
    },
    async setCaps(units, reason, env) {
      await guard(() => t.value('set_caps', { p_units: units, p_reason: reason, p_env: env }));
    },
    today: () => guard(async () => (await t.value('today')) as Today),
    flagList: () =>
      guard(async () =>
        (await t.rows('flag_list')).map((r) => ({
          key: str(r.key),
          kind: r.kind as FlagRow['kind'],
          description: str(r.description),
          guarded: Boolean(r.guarded),
          schoolScoped: Boolean(r.school_scoped),
          safeDefault: r.safe_default,
          scope: (r.scope as FlagRow['scope']) ?? null,
          scopeId: r.scope_id === null || r.scope_id === undefined ? null : str(r.scope_id),
          value: r.value ?? null,
          updatedAt: iso(r.updated_at),
        })),
      ),
    async flagSet(i) {
      await guard(() =>
        t.value('flag_set', {
          p_key: i.key,
          p_scope: i.scope,
          p_scope_id: i.scopeId ?? '',
          p_value: i.value,
          p_reason: i.reason,
          p_env: i.env,
        }),
      );
    },
    async flagClear(i) {
      await guard(() => t.value('flag_clear', { p_key: i.key, p_scope_id: i.scopeId, p_reason: i.reason, p_env: i.env }));
    },
    staffList: () =>
      guard(async () =>
        (await t.rows('staff_list')).map((r) => ({
          userId: str(r.user_id),
          role: r.role as StaffRow['role'],
          displayName: str(r.display_name),
          active: Boolean(r.active),
          createdAt: str(r.created_at),
          deactivatedAt: iso(r.deactivated_at),
        })),
      ),
    async staffSet(i) {
      await guard(() =>
        t.value('staff_set', {
          p_user: i.userId,
          p_role: i.role,
          p_name: i.displayName,
          p_active: i.active,
          p_reason: i.reason,
          p_env: i.env,
        }),
      );
    },
  };
}
