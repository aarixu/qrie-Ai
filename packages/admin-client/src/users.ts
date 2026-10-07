import type { AdminApiCaller } from './admin-api.ts';
import { guard } from './read.ts';
import type { Write } from './schools.ts';
import type { AdminTransport } from './transport.ts';

/**
 * The second door (migration 0054): users who came on their own, not through
 * a school. Counted, found by at least the first 8 characters of their user
 * ID, and shown as a card with no name, phone or address. A block is recorded
 * by the database, then applied to the sign-in by the admin-api edge function.
 */

export interface DirectSummary {
  total: number;
  anonymous: number;
  permanent: number;
  createdLast7Days: number;
  activeLast7Days: number;
  withContestEntry: number;
  withConsent: number;
  blocked: number;
}

export interface DirectUser {
  userId: string;
  /** The first 8 characters of the user ID. */
  ref: string;
  createdOn: string;
  anonymous: boolean;
  lastActiveOn: string | null;
  sessions: number;
  schoolCode: string | null;
  contestEntry: boolean;
  consent: boolean;
  blocked: boolean;
}

export interface UsersClient {
  summary(): Promise<DirectSummary>;
  find(ref: string): Promise<DirectUser[]>;
  user(userId: string): Promise<DirectUser>;
  setBlocked(i: { userId: string; blocked: boolean } & Write): Promise<{ userId: string; blocked: boolean }>;
}

export function createUsersClient(t: AdminTransport, api: AdminApiCaller): UsersClient {
  return {
    summary: () => guard(async () => (await t.value('direct_users_summary')) as DirectSummary),
    find: (ref) => guard(async () => ((await t.value('direct_user_find', { p_ref: ref })) ?? []) as DirectUser[]),
    user: (userId) => guard(async () => (await t.value('direct_user', { p_user: userId })) as DirectUser),
    setBlocked: (i) =>
      guard(
        async () =>
          (await api.post('user-block', { userId: i.userId, blocked: i.blocked, reason: i.reason, env: i.env })) as {
            userId: string;
            blocked: boolean;
          },
      ),
  };
}
