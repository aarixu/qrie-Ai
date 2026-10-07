/**
 * The staff roles, the only list of them in the console (seam S6). The
 * database keeps its own list in platform_staff's check constraint and refuses
 * any other role; billing (plan 3) adds 'finance' to both when it is merged.
 */
export const STAFF_ROLES = ['owner', 'ops', 'safety'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
