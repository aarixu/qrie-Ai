import { describe, expect, it } from 'vitest';
import { canAddTeachers, canClearFlag, canGivePin, canSetFlag, flagControl } from '../src/lib/roles.ts';

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

  it("switching class preparation back on (tutor.only_prepared off) is the owner's; switching it on is owner and ops (0075)", () => {
    expect(canSetFlag('ops', 'tutor.only_prepared', true)).toBe(true);
    expect(canSetFlag('ops', 'tutor.only_prepared', false)).toBe(false);
    expect(canSetFlag('owner', 'tutor.only_prepared', false)).toBe(true);
  });

  it('the Switches page shows a control only where the database would take the change, and says why not elsewhere', () => {
    expect(flagControl('owner', 'tutor.enabled', 'bool', false)).toBeNull();
    expect(flagControl('owner', 'tutor.only_prepared', 'bool', true)).toBeNull();
    expect(flagControl('ops', 'tutor.enabled', 'bool', true)).toBeNull();
    expect(flagControl('ops', 'tutor.enabled', 'bool', false)).toBe('Off. The owner turns it on.');
    expect(flagControl('ops', 'tutor.only_prepared', 'bool', false)).toBeNull();
    expect(flagControl('ops', 'tutor.only_prepared', 'bool', true)).toBe('On. The owner turns it off.');
    expect(flagControl('ops', 'tutor.compose_live_classes', 'bool', false)).toBeNull();
    expect(flagControl('ops', 'banner.message', 'text', '')).toBeNull();
    for (const role of ['safety', 'finance'] as const) {
      expect(flagControl(role, 'banner.message', 'text', ''), role).toBe('Owner and ops only.');
      expect(flagControl(role, 'tutor.enabled', 'bool', true), role).toBe('Owner and ops only.');
      expect(flagControl(role, 'tutor.compose_live_classes', 'bool', false), role).toBe('Owner and ops only.');
    }
  });

  it("clearing a school's own tutor switch is judged as setting it to the value it then follows (admin.flag_clear, 0075)", () => {
    // Its own off, the platform on: clearing turns the school back on, the owner's.
    expect(canClearFlag('ops', 'tutor.enabled', false, true)).toBe(false);
    expect(canClearFlag('owner', 'tutor.enabled', false, true)).toBe(true);
    // Its own on, the platform off: clearing stops the school, which ops may do.
    expect(canClearFlag('ops', 'tutor.enabled', true, false)).toBe(true);
    expect(canClearFlag('ops', 'tutor.enabled', true, true)).toBe(true);
    expect(canClearFlag('ops', 'tutor.enabled', false, false)).toBe(true);
    expect(canClearFlag('safety', 'tutor.enabled', true, false)).toBe(false);
    expect(canClearFlag('finance', 'tutor.enabled', true, false)).toBe(false);
  });
});
