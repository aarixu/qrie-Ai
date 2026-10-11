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

/**
 * Whatever makes money flow again is the owner's (spec section 3): turning the
 * tutor back on (admin.flag_set refuses ops, 0053) and turning class
 * preparation back on, tutor.only_prepared off (0075).
 */
const ownersValue = (key: string, value: unknown): boolean =>
  (key === 'tutor.enabled' && value === true) || (key === 'tutor.only_prepared' && value === false);

export const canSetFlag = (role: Me['role'], key: string, value: unknown): boolean =>
  ownersValue(key, value) ? isOwner(role) : canOperate(role);

/**
 * What the Switches page shows in place of a control: null where the database
 * would take a change (admin.flag_set is owner and ops, 0053), else the
 * reason. A switch has one direction only the owner may take (ownersValue);
 * for ops it reads as a sentence when that is the only change left.
 */
export function flagControl(role: Me['role'], key: string, kind: string, current: unknown): string | null {
  if (!canOperate(role)) return 'Owner and ops only.';
  if (kind !== 'bool') return null;
  const next = current !== true;
  if (canSetFlag(role, key, next)) return null;
  return next ? 'Off. The owner turns it on.' : 'On. The owner turns it off.';
}

/**
 * Clearing a school's own value (admin.flag_clear, 0075) is judged as setting
 * the school to the value it then follows: `own` is its value now, `follows`
 * the platform's (or the safe default).
 */
export const canClearFlag = (role: Me['role'], key: string, own: unknown, follows: unknown): boolean =>
  ownersValue(key, follows) && own !== follows ? isOwner(role) : canOperate(role);
