import type { PGlite } from '@electric-sql/pglite';
import { createUser, type JwtClaims } from './harness.ts';

export type StaffRole = 'owner' | 'ops' | 'safety';

export interface Staff {
  id: string;
  role: StaffRole;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** An amr list whose authenticator code was verified just now. */
export const freshAmr = () => [{ method: 'totp', timestamp: nowSeconds() }];

/** One verified an hour ago: aal2, but too old for a guarded action. */
export const staleAmr = () => [{ method: 'totp', timestamp: nowSeconds() - 3600 }];

/**
 * A staff member the way the bootstrap and the staff screen make one: an auth
 * user marked provisioned_by = 'staff' (so no solo organisation) with a row in
 * platform_staff. Inserted as the database owner, as a migration would.
 */
export async function makeStaff(db: PGlite, role: StaffRole, name = `${role} person`): Promise<Staff> {
  const id = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
  await db.query(`insert into admin.platform_staff (user_id, role, display_name) values ($1, $2, $3)`, [id, role, name]);
  return { id, role };
}

/** aal2 with an old factor: enough for every ordinary call, not for a guarded one. */
export const aal2 = (who: { id: string }, over: Partial<JwtClaims> = {}): JwtClaims => ({
  sub: who.id,
  aal: 'aal2',
  amr: staleAmr(),
  ...over,
});

/** aal2 with a factor verified just now: what a guarded call needs. */
export const fresh = (who: { id: string }): JwtClaims => aal2(who, { amr: freshAmr() });

/** A child's anonymous session: the same `authenticated` role staff hold. */
export async function anonymousChild(db: PGlite): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`insert into auth.users (is_anonymous) values (true) returning id`);
  return rows[0].id;
}

export async function setEnvironment(db: PGlite, env = 'TEST'): Promise<void> {
  await db.query(`select admin.set_environment($1)`, [env]);
}
