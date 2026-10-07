import { describe, expect, it } from 'vitest';
import { canAddTeachers, canGivePin, canSetFlag } from '../src/lib/roles.ts';

/**
 * Which buttons a role sees, where the database refuses by more than the role.
 * Written first. The database refuses anyway (admin.api_gate, admin.flag_set);
 * these keep a button that would be refused off the screen.
 */

describe('who sees which button', () => {
  it("a new PIN for a teacher or a school admin is the owner's; ops give students and parents one (R22)", () => {
    for (const kind of ['student', 'parent']) {
      expect(canGivePin('owner', kind), kind).toBe(true);
      expect(canGivePin('ops', kind), kind).toBe(true);
    }
    for (const kind of ['teacher', 'admin']) {
      expect(canGivePin('owner', kind), kind).toBe(true);
      expect(canGivePin('ops', kind), kind).toBe(false);
    }
    expect(canGivePin('safety', 'student')).toBe(false);
  });

  it('only the owner adds a teachers sheet (R22)', () => {
    expect(canAddTeachers('owner')).toBe(true);
    expect(canAddTeachers('ops')).toBe(false);
    expect(canAddTeachers('safety')).toBe(false);
  });

  it('ops may switch the tutor off but only the owner turns it back on (spec section 3); other switches are owner and ops', () => {
    expect(canSetFlag('ops', 'tutor.enabled', false)).toBe(true);
    expect(canSetFlag('ops', 'tutor.enabled', true)).toBe(false);
    expect(canSetFlag('owner', 'tutor.enabled', true)).toBe(true);
    expect(canSetFlag('ops', 'banner.message', 'Classes pause 6 to 7 pm')).toBe(true);
    expect(canSetFlag('ops', 'contest.entries_open', true)).toBe(true);
    expect(canSetFlag('safety', 'tutor.enabled', false)).toBe(false);
  });
});
