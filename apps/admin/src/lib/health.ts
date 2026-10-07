import type { Level, SignalKey } from '@ai-tutor/admin-client';
import type { Tone } from './tiles.ts';

/**
 * How a school's health reads on screen. The thresholds are the database's
 * (admin.school_health_for, migration 0052); this only colours and orders.
 * Grey means "cannot tell yet" and is never shown as healthy.
 */
export const LEVEL_TONE: Record<Level, Tone> = { green: 'ok', amber: 'warn', red: 'bad', grey: 'grey' };

/** Worst first: red, amber, grey ("cannot tell"), green. */
export const LEVEL_RANK: Record<Level, number> = { red: 3, amber: 2, grey: 1, green: 0 };

/** The schools list's default order: the worst health first, then by name. */
export function bySeverity(a: { healthLevel: Level; name: string }, b: { healthLevel: Level; name: string }): number {
  return LEVEL_RANK[b.healthLevel] - LEVEL_RANK[a.healthLevel] || a.name.localeCompare(b.name);
}

export const SIGNAL_TITLE: Record<SignalKey, string> = {
  licence: 'Licence',
  payment: 'Payment',
  seats: 'Seats',
  activation: 'Activation',
  teaching: 'Teaching',
  learning: 'Learning',
  attendance: 'Attendance',
  safety: 'Safety',
  lastActive: 'Last active',
};
