import { describe, expect, it } from 'vitest';
import { AdminError, decideGate, idleExpired, IDLE_LIMIT_MINUTES, staffFromError } from '../src/index.ts';

describe('which screen a visitor may see', () => {
  it.each([
    [{ signedIn: false, aal: null, hasVerifiedFactor: false, staff: 'unknown' }, 'signed-out'],
    [{ signedIn: true, aal: 'aal1', hasVerifiedFactor: false, staff: 'unknown' }, 'enrol-factor'],
    [{ signedIn: true, aal: 'aal1', hasVerifiedFactor: true, staff: 'unknown' }, 'verify-factor'],
    [{ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, staff: 'unknown' }, 'checking'],
    [{ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, staff: 'no' }, 'not-staff'],
    [{ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, staff: 'yes' }, 'ready'],
    [{ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, staff: 'error' }, 'unavailable'],
  ] as const)('%j is %s', (input, gate) => {
    expect(decideGate({ ...input })).toBe(gate);
  });

  it('never calls an aal1 session ready or not-staff, even when the database would say staff', () => {
    expect(decideGate({ signedIn: true, aal: 'aal1', hasVerifiedFactor: true, staff: 'yes' })).toBe('verify-factor');
    expect(decideGate({ signedIn: true, aal: null, hasVerifiedFactor: false, staff: 'yes' })).toBe('enrol-factor');
  });

  it('keeps an open console open when one staff check fails for a reason other than a refusal', () => {
    expect(decideGate({ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, staff: 'error', previous: 'ready' })).toBe('ready');
  });

  it('closes an open console at once when the database says the person is no longer staff', () => {
    expect(decideGate({ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, staff: 'no', previous: 'ready' })).toBe('not-staff');
  });
});

describe('what a failed staff check means', () => {
  it('a refusal means not staff', () => {
    expect(staffFromError(new AdminError('You do not have access to this.', 'not-allowed'))).toBe('no');
  });

  it('anything else (a network failure, an unexposed schema) is an error, never "not staff"', () => {
    expect(staffFromError(new TypeError('Failed to fetch'))).toBe('error');
    expect(staffFromError(new AdminError('The schema must be one of the following: public, lms', 'other'))).toBe('error');
    expect(staffFromError('timeout')).toBe('error');
  });
});

describe('the idle sign-out', () => {
  const minute = 60_000;
  it('fires at the limit and not before', () => {
    expect(idleExpired(0, IDLE_LIMIT_MINUTES * minute - 1)).toBe(false);
    expect(idleExpired(0, IDLE_LIMIT_MINUTES * minute)).toBe(true);
  });
  it('can be given a different limit', () => {
    expect(idleExpired(0, 5 * minute, 5)).toBe(true);
    expect(idleExpired(0, 4 * minute, 5)).toBe(false);
  });
});
