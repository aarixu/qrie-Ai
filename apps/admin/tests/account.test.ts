import { describe, expect, it } from 'vitest';
import { newPasswordProblem } from '../src/lib/account.ts';
import { isUserRef } from '../src/lib/users-view.ts';

/** Your own password, and the user reference door 2 searches by. Written first. */

describe('your account', () => {
  it('a new password needs 12 characters and the same twice', () => {
    expect(newPasswordProblem('short', 'short')).toBe('Use at least 12 characters.');
    expect(newPasswordProblem('long enough pass', 'long enough pas')).toBe('The two passwords are not the same.');
    expect(newPasswordProblem('long enough pass', 'long enough pass')).toBeNull();
  });
});

describe('door 2', () => {
  it("a user reference is 8 to 36 of the ID's hex digits and dashes, in any case (as admin.direct_user_find asks)", () => {
    expect(isUserRef('1a2b3c4d')).toBe(true);
    expect(isUserRef(' 1A2B3C4D-5E6F ')).toBe(true);
    expect(isUserRef('1a2b3c4')).toBe(false);
    expect(isUserRef('1a2b3c4z')).toBe(false);
    expect(isUserRef('00000000-0000-4000-8000-0000000000011')).toBe(false);
  });
});
