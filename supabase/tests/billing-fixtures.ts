import type { PGlite } from '@electric-sql/pglite';
import { createUser } from './harness.ts';

/** A finance member, made as makeStaff makes the others (admin-fixtures.ts), with the role plan 3 adds. */
export async function makeFinance(db: PGlite, name = 'finance person'): Promise<{ id: string; role: 'finance' }> {
  const id = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
  await db.query(`insert into admin.platform_staff (user_id, role, display_name) values ($1, 'finance', $2)`, [id, name]);
  return { id, role: 'finance' };
}
