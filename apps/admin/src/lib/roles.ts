import type { Me } from '@ai-tutor/admin-client';

/**
 * Which buttons a role sees. The database refuses anyway (each admin function
 * checks the role itself); this only keeps buttons that would be refused off
 * the screen.
 */
export const canOperate = (role: Me['role']): boolean => role === 'owner' || role === 'ops';
export const isOwner = (role: Me['role']): boolean => role === 'owner';

/**
 * A teacher's or a school admin's sign-in opens other people's children's
 * work, which ops may not see (spec section 3): admin.api_gate lets only the
 * owner give one a new PIN or add a teachers sheet (R22).
 */
export const canGivePin = (role: Me['role'], kind: string): boolean =>
  isOwner(role) || (role === 'ops' && kind !== 'teacher' && kind !== 'admin');
export const canAddTeachers = (role: Me['role']): boolean => isOwner(role);

/** Turning the tutor back on is the owner's (spec section 3); admin.flag_set refuses ops (0053). */
export const canSetFlag = (role: Me['role'], key: string, value: unknown): boolean =>
  key === 'tutor.enabled' && value === true ? isOwner(role) : canOperate(role);
