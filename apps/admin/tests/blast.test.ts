import { describe, expect, it } from 'vitest';
import { blastAddExisting, blastCeiling, blastLicence, blastOffboard, blastPause, blastResetPin, blastSchoolSwitch } from '../src/lib/blast.ts';

/** What a write will do, said before it is confirmed. Written first. */

describe('blast-radius lines', () => {
  it('the licence line names the school, the plan, the seats and the last day, and warns when fewer seats than are in use', () => {
    expect(blastLicence('DPS1', 'standard', 300, '2027-03-31', 120)).toBe(
      "DPS1's licence becomes standard, 300 seats, until 2027-03-31. The school admin sees it at once.",
    );
    expect(blastLicence('DPS1', 'pilot', 100, '2027-03-31', 120)).toBe(
      "DPS1's licence becomes pilot, 100 seats, until 2027-03-31. The school admin sees it at once." +
        ' 120 seats are in use: the school cannot add students until some leave.',
    );
  });

  it('offboarding says what really happens today: a mark, the switch off, no app reads it yet, the school admin can still add people, nothing deleted', () => {
    const off = blastOffboard('KV22', true);
    expect(off).toBe(
      'KV22 is marked offboarded and its tutor switch is set off. Qrie staff cannot add people to it, but its school admin still can' +
        ' in the teacher app, and no app reads the tutor switch yet (plan 4), so the tutor keeps working there until then.' +
        ' Nothing is deleted: homework, marks and sign-ins stay.',
    );
    expect(off).not.toMatch(/tutor pauses|no one can be added/);
    expect(blastOffboard('KV22', false)).toBe('KV22 is no longer marked offboarded. Its tutor switch stays off until the owner turns it on.');
  });

  it('the tutor switch for one school says no app reads it yet, in both directions', () => {
    expect(blastPause('KV22', false)).toBe(
      "KV22's tutor switch is set off. No app reads this switch yet (plan 4), so the tutor keeps working at KV22 until then.",
    );
    expect(blastPause('KV22', true)).toBe("KV22's tutor switch is set on. No app reads this switch yet (plan 4).");
    expect(blastSchoolSwitch('KV22')).toBe('Saved for KV22. No app reads this switch yet (plan 4).');
  });

  it('a new PIN says the old one stops at once and to ask the school admin first', () => {
    const line = blastResetPin('KV22', 'KV22-8A-5');
    expect(line).toContain('KV22-8A-5');
    expect(line).toMatch(/stops working at once/);
    expect(line).toMatch(/signed out everywhere/);
    expect(line).toMatch(/school admin first/);
  });

  it("a ceiling raise says when it goes back by itself; a cut to or below today's spend says the tutor takes no new work and must be stopped first", () => {
    expect(blastCeiling(80000, 50000, 1000)).toBe(
      'Up to 80000 units today. It goes back to 50000 units just after midnight UTC (05:35 in India) by itself.',
    );
    expect(blastCeiling(90000, 80000, 1000, 50000)).toMatch(/goes back to 50000 units/);
    expect(blastCeiling(40000, 50000, 1000)).toBe('The ceiling becomes 40000 units.');
    const cut = blastCeiling(2000, 50000, 3000);
    expect(cut).toMatch(/^The ceiling becomes 2000 units\./);
    expect(cut).toMatch(/already 3000 units/);
    expect(cut).toMatch(/takes no new work/);
    expect(cut).toMatch(/stop the tutor first/);
  });

  it('adding an account already made for staff says it joins the list switched off until it is turned on', () => {
    expect(blastAddExisting('Meena', 'safety')).toBe(
      'Meena joins the staff list as safety, switched off. Turn them on after they have set up an authenticator and you have spoken to them.',
    );
  });
});
