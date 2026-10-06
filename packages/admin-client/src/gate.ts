/**
 * WHICH SCREEN A VISITOR MAY SEE. One pure decision, so the order of the checks
 * is tested and not scattered through the UI.
 *
 * Everybody, staff or not, is walked through the second factor first, and only
 * then asked the database whether they are staff: a stranger who signs in learns
 * nothing about who is on the list.
 */
export type Gate = 'signed-out' | 'enrol-factor' | 'verify-factor' | 'checking' | 'not-staff' | 'ready';

export interface GateInput {
  signedIn: boolean;
  /** The session's assurance level; null when unknown. */
  aal: 'aal1' | 'aal2' | null;
  hasVerifiedFactor: boolean;
  /** The answer of admin.me(): true if it returned, false if it refused, null while unasked. */
  isStaff: boolean | null;
}

export function decideGate(i: GateInput): Gate {
  if (!i.signedIn) return 'signed-out';
  if (i.aal === 'aal2') {
    if (i.isStaff === null) return 'checking';
    return i.isStaff ? 'ready' : 'not-staff';
  }
  return i.hasVerifiedFactor ? 'verify-factor' : 'enrol-factor';
}

/** The panel signs a person out after this long without a click or a key. */
export const IDLE_LIMIT_MINUTES = 15;

export function idleExpired(lastActivityMs: number, nowMs: number, limitMinutes = IDLE_LIMIT_MINUTES): boolean {
  return nowMs - lastActivityMs >= limitMinutes * 60_000;
}
