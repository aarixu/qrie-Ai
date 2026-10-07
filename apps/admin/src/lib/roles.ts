import type { Me } from '@ai-tutor/admin-client';

/**
 * Which buttons a role sees. The database refuses anyway (each admin function
 * checks the role itself); this only keeps buttons that would be refused off
 * the screen.
 */
export const canOperate = (role: Me['role']): boolean => role === 'owner' || role === 'ops';
export const isOwner = (role: Me['role']): boolean => role === 'owner';
