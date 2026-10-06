import { AdminError } from './errors.ts';

/**
 * WHICH SCREEN A VISITOR MAY SEE. One pure decision, so the order of the checks
 * is tested and not scattered through the UI.
 *
 * Everybody, staff or not, is walked through the second factor first, and only
 * then asked the database whether they are staff: a stranger who signs in learns
 * nothing about who is on the list.
 *
 * A staff check that fails for any reason other than a refusal (a dropped
 * connection, a timeout, a schema not exposed yet) is 'unavailable', never
 * 'not-staff': an owner must not be told "no access" by a network blip. A console
 * that is already open stays open through such a failure, because the moment the
 * network is struggling is the moment somebody may need the stop button. A
 * refusal ('no') always closes it, at once.
 */
export type Gate = 'signed-out' | 'enrol-factor' | 'verify-factor' | 'checking' | 'not-staff' | 'unavailable' | 'ready';

/** What asking admin.me() told us: not asked yet, staff, refused, or failed for another reason. */
export type StaffAnswer = 'unknown' | 'yes' | 'no' | 'error';

export interface GateInput {
  signedIn: boolean;
  /** The session's assurance level; null when unknown. */
  aal: 'aal1' | 'aal2' | null;
  hasVerifiedFactor: boolean;
  staff: StaffAnswer;
  /** The screen shown before this check, if any. */
  previous?: Gate;
}

export function decideGate(i: GateInput): Gate {
  if (!i.signedIn) return 'signed-out';
  if (i.aal === 'aal2') {
    switch (i.staff) {
      case 'unknown':
        return 'checking';
      case 'yes':
        return 'ready';
      case 'no':
        return 'not-staff';
      case 'error':
        return i.previous === 'ready' ? 'ready' : 'unavailable';
    }
  }
  return i.hasVerifiedFactor ? 'verify-factor' : 'enrol-factor';
}

/** Only the database's refusal means "not staff"; any other failure is an error. */
export function staffFromError(e: unknown): StaffAnswer {
  return e instanceof AdminError && e.code === 'not-allowed' ? 'no' : 'error';
}

/** The panel signs a person out after this long without a click or a key. */
export const IDLE_LIMIT_MINUTES = 15;

export function idleExpired(lastActivityMs: number, nowMs: number, limitMinutes = IDLE_LIMIT_MINUTES): boolean {
  return nowMs - lastActivityMs >= limitMinutes * 60_000;
}
