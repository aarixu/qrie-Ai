import { describe, expect, it } from 'vitest';
import { blastCeiling, blastLicence, blastOffboard, blastResetPin } from '../src/lib/blast.ts';

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

  it('offboarding says the tutor pauses and nothing is deleted; bringing back says the tutor stays paused', () => {
    const off = blastOffboard('KV22', true);
    expect(off).toContain('KV22');
    expect(off).toMatch(/tutor pauses/);
    expect(off).toMatch(/Nothing is deleted/);
    const back = blastOffboard('KV22', false);
    expect(back).toContain('KV22');
    expect(back).toMatch(/tutor switch stays off/);
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
});
