import { describe, expect, it } from 'vitest';
import { newStaffPassword, STAFF_PASSWORD_ALPHABET } from '../src/password.ts';

/**
 * A NEW MEMBER OF STAFF'S TEMPORARY PASSWORD. Written first.
 *
 * Shown once to the owner who invited them and given over by phone, so no
 * characters that look alike; every character of the alphabet equally likely.
 */

describe('a temporary staff password', () => {
  it('20 characters from the alphabet without look-alikes', () => {
    const p = newStaffPassword();
    expect(p).toHaveLength(20);
    expect(STAFF_PASSWORD_ALPHABET).toHaveLength(57);
    for (const c of 'IOl01') expect(STAFF_PASSWORD_ALPHABET).not.toContain(c);
    for (const c of p) expect(STAFF_PASSWORD_ALPHABET).toContain(c);
  });

  it('two draws differ', () => {
    expect(newStaffPassword()).not.toBe(newStaffPassword());
  });

  it('every character of the alphabet appears over many draws, and no other', () => {
    const all = Array.from({ length: 2000 }, () => newStaffPassword()).join('');
    expect(new Set(all)).toEqual(new Set(STAFF_PASSWORD_ALPHABET));
  });
});
