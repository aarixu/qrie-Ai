import { describe, expect, it } from 'vitest';
import { addDays, academicYear, istStamp, istTime, istToday } from '../src/lib/time.ts';

/** Days and times as India reads them, on the schools pages. Written first. */

describe('India time', () => {
  it("istToday is India's date, which turns at 18:30 UTC", () => {
    expect(istToday(new Date('2026-10-07T18:29:00Z'))).toBe('2026-10-07');
    expect(istToday(new Date('2026-10-07T18:30:00Z'))).toBe('2026-10-08');
  });

  it('istTime shows a moment in India, with the day and a 24-hour time', () => {
    const t = istTime('2026-10-07T08:35:00Z');
    expect(t).toMatch(/7/);
    expect(t).toMatch(/Oct/);
    expect(t).toMatch(/14:05/);
  });

  it('addDays moves a date across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('academicYear is April to March, named like 2026-27', () => {
    expect(academicYear('2026-10-07')).toEqual({ label: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31' });
    expect(academicYear('2027-02-10')).toEqual({ label: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31' });
    expect(academicYear('2099-04-01')).toEqual({ label: '2099-00', startsOn: '2099-04-01', endsOn: '2100-03-31' });
  });

  it("istStamp is India's date and time to the second, in an order that sorts", () => {
    expect(istStamp('2026-10-07T08:35:09.123456+00:00')).toBe('2026-10-07 14:05:09');
    expect(istStamp('2026-10-07T18:30:00Z')).toBe('2026-10-08 00:00:00');
  });
});
