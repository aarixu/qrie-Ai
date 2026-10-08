import type { AdminApiCaller } from './admin-api.ts';
import { day, guard, num, str, strOrNull } from './read.ts';
import type { Write } from './schools.ts';
import type { AdminTransport } from './transport.ts';

/**
 * Staff and the audit log (migration 0054), for the owner. An invitation
 * makes a sign-in, which needs the service role, so it goes through the
 * admin-api edge function; adding an account that already exists (made for
 * staff, never added) is admin.staff_invite directly. Which roles exist is the
 * database's own rule, so a role here is plain text.
 */

export type StaffStatus = 'active' | 'invited' | 'off' | 'account-only';
export type FactorState = 'verified' | 'none' | 'not-captured';

export interface RosterRow {
  userId: string;
  email: string | null;
  /** null for an account made for staff and never added. */
  role: string | null;
  displayName: string | null;
  status: StaffStatus;
  factor: FactorState;
  createdAt: string;
  deactivatedAt: string | null;
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  targetKind: string;
  targetId: string;
  reason: string;
  details: Record<string, unknown>;
  environment: string;
}

/** Each part left out is not filtered on; days are India's (YYYY-MM-DD). */
export interface AuditFilter {
  actor?: string;
  /** The start of an action name, such as 'school-' or 'flag-set'. */
  action?: string;
  from?: string;
  to?: string;
  /** Only entries older than this id: the next page. */
  before?: number;
  limit?: number;
}

/** The temporary password is shown once, to the owner who invited; Qrie keeps no copy. */
export interface Invitation {
  userId: string;
  email: string;
  temporaryPassword: string;
}

export interface StaffClient {
  roster(): Promise<RosterRow[]>;
  invite(i: { email: string; displayName: string; role: string } & Write): Promise<Invitation>;
  addExisting(i: { userId: string; role: string; displayName: string } & Write): Promise<void>;
  auditList(filter: AuditFilter): Promise<AuditRow[]>;
}

export function createStaffClient(t: AdminTransport, api: AdminApiCaller): StaffClient {
  return {
    roster: () =>
      guard(async () =>
        (await t.rows('staff_roster')).map((r) => ({
          userId: str(r.user_id),
          email: strOrNull(r.email),
          role: strOrNull(r.role),
          displayName: strOrNull(r.display_name),
          status: r.status as StaffStatus,
          factor: r.factor as FactorState,
          createdAt: str(r.created_at),
          deactivatedAt: strOrNull(r.deactivated_at),
        })),
      ),
    invite: (i) =>
      guard(
        async () =>
          (await api.post('staff-invite', {
            email: i.email,
            displayName: i.displayName,
            role: i.role,
            reason: i.reason,
            env: i.env,
          })) as Invitation,
      ),
    async addExisting(i) {
      await guard(() =>
        t.value('staff_invite', { p_user: i.userId, p_role: i.role, p_name: i.displayName, p_reason: i.reason, p_env: i.env }),
      );
    },
    auditList: (f) =>
      guard(async () =>
        (
          await t.rows('audit_list', {
            p_actor: f.actor,
            p_action: f.action,
            p_from: f.from === undefined ? undefined : day(f.from),
            p_to: f.to === undefined ? undefined : day(f.to),
            p_before: f.before,
            p_limit: f.limit,
          })
        ).map((r) => ({
          id: num(r.id),
          at: str(r.at),
          actor: strOrNull(r.actor),
          actorName: str(r.actor_name),
          actorRole: str(r.actor_role),
          action: str(r.action),
          targetKind: str(r.target_kind),
          targetId: str(r.target_id),
          reason: str(r.reason),
          details: (r.details ?? {}) as Record<string, unknown>,
          environment: str(r.environment),
        })),
      ),
  };
}
