import { describe, expect, it } from 'vitest';
import { decideGate, idleExpired, IDLE_LIMIT_MINUTES } from '../src/index.ts';

describe('which screen a visitor may see', () => {
  it.each([
    [{ signedIn: false, aal: null, hasVerifiedFactor: false, isStaff: null }, 'signed-out'],
    [{ signedIn: true, aal: 'aal1', hasVerifiedFactor: false, isStaff: null }, 'enrol-factor'],
    [{ signedIn: true, aal: 'aal1', hasVerifiedFactor: true, isStaff: null }, 'verify-factor'],
    [{ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, isStaff: null }, 'checking'],
    [{ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, isStaff: false }, 'not-staff'],
    [{ signedIn: true, aal: 'aal2', hasVerifiedFactor: true, isStaff: true }, 'ready'],
  ] as const)('%j is %s', (input, gate) => {
    expect(decideGate({ ...input })).toBe(gate);
  });

  it('never calls an aal1 session ready or not-staff, even when the database would say staff', () => {
    expect(decideGate({ signedIn: true, aal: 'aal1', hasVerifiedFactor: true, isStaff: true })).toBe('verify-factor');
    expect(decideGate({ signedIn: true, aal: null, hasVerifiedFactor: false, isStaff: true })).toBe('enrol-factor');
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
