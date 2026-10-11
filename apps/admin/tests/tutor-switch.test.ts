import { describe, expect, it } from 'vitest';
import { schoolTutorAction } from '../src/lib/tutor-switch.ts';

/**
 * WHAT THE SCHOOL PAGE'S TUTOR BUTTON DOES. Written first.
 *
 * A school's own tutor.enabled value wins over the platform's
 * (public.app_config). Resuming a school paused on its own clears its value
 * (admin.flag_clear, 0075), so it follows the platform's switch again; only a
 * school resumed while the platform is off keeps a value of its own, which
 * makes it ignore the platform's switch.
 */

describe("the school page's tutor button", () => {
  it('a school following the platform, which is on: switch it off with a value of its own', () => {
    expect(schoolTutorAction(undefined, true)).toEqual({ label: 'Turn the tutor switch off', write: { kind: 'set', value: false }, turnsOn: false });
  });

  it('a school paused on its own while the platform is on: resume by clearing its value (follow the platform)', () => {
    expect(schoolTutorAction(false, true)).toEqual({ label: 'Turn the tutor switch back on', write: { kind: 'clear' }, turnsOn: true });
  });

  it('a school paused while the platform is off too: turning it on needs a value of its own', () => {
    expect(schoolTutorAction(false, false)).toEqual({ label: 'Turn the tutor switch back on', write: { kind: 'set', value: true }, turnsOn: true });
    expect(schoolTutorAction(undefined, false)).toEqual({ label: 'Turn the tutor switch back on', write: { kind: 'set', value: true }, turnsOn: true });
  });

  it('a school switched on by its own value: switch it off with its own value', () => {
    expect(schoolTutorAction(true, false)).toEqual({ label: 'Turn the tutor switch off', write: { kind: 'set', value: false }, turnsOn: false });
    expect(schoolTutorAction(true, true)).toEqual({ label: 'Turn the tutor switch off', write: { kind: 'set', value: false }, turnsOn: false });
  });
});
