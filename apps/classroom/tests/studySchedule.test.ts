import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  formatMinute,
  isDueNow,
  nextReminder,
  reminderText,
  type StudySchedule,
} from '../src/lib/studySchedule';

/**
 * The wrong answer here is invisible — a reminder an hour late looks exactly
 * like one that worked — so the arithmetic is tested rather than eyeballed.
 *
 * All dates are local, because a student's evening is local and a schedule
 * that drifts with the timezone is a schedule that fires at 3am.
 */

const at = (iso: string) => new Date(iso);
/** 2026-09-02 is a Wednesday. */
const WED_2PM = at('2026-09-02T14:00:00');
const WED_6PM = at('2026-09-02T18:00:00');
const SAT_2PM = at('2026-09-05T14:00:00');

const weekdaysAt5: StudySchedule = { days: [1, 2, 3, 4, 5], minute: 17 * 60, enabled: true };

describe('when the next reminder is', () => {
  it('is today when today is a study day and the time has not passed', () => {
    const next = nextReminder(weekdaysAt5, WED_2PM)!;
    expect(next.getDate()).toBe(2);
    expect(next.getHours()).toBe(17);
  });

  it('skips today once its time has gone, rather than firing late', () => {
    const next = nextReminder(weekdaysAt5, WED_6PM)!;
    expect(next.getDate()).toBe(3);
  });

  it('jumps the weekend to the next chosen day', () => {
    const next = nextReminder(weekdaysAt5, SAT_2PM)!;
    // Saturday and Sunday are not study days, so Monday the 7th.
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(7);
  });

  it('is nothing at all when reminders are off, or no day was chosen', () => {
    expect(nextReminder({ ...weekdaysAt5, enabled: false }, WED_2PM)).toBeNull();
    expect(nextReminder({ ...weekdaysAt5, days: [] }, WED_2PM)).toBeNull();
  });
});

describe('whether to nudge right now', () => {
  it('nudges after the time on a study day they have not studied', () => {
    expect(isDueNow(weekdaysAt5, WED_6PM, null)).toBe(true);
  });

  it('stays quiet before the time', () => {
    expect(isDueNow(weekdaysAt5, WED_2PM, null)).toBe(false);
  });

  it('stays quiet on a day they did not choose', () => {
    expect(isDueNow(weekdaysAt5, at('2026-09-05T18:00:00'), null)).toBe(false);
  });

  it('never tells a student to study while they are studying', () => {
    // Finished a lesson this morning: the day is done, whatever the clock says.
    expect(isDueNow(weekdaysAt5, WED_6PM, at('2026-09-02T09:00:00'))).toBe(false);
  });

  it('nudges again the next day, even though yesterday was studied', () => {
    expect(isDueNow(weekdaysAt5, at('2026-09-03T18:00:00'), at('2026-09-02T09:00:00'))).toBe(true);
  });

  it('stays quiet when they turned reminders off', () => {
    expect(isDueNow({ ...weekdaysAt5, enabled: false }, WED_6PM, null)).toBe(false);
  });
});

describe('what it says', () => {
  it('names the streak they built, once there is one to name', () => {
    expect(reminderText(5, null).title).toContain('5-day streak');
  });

  it('does not invent a streak out of one day', () => {
    expect(reminderText(1, null).title).toBe('Time to study');
  });

  it('names the subject being dropped when there is one', () => {
    expect(reminderText(0, 'Mathematics').body).toContain('Mathematics');
  });

  it('never scolds', () => {
    const words = [reminderText(0, null), reminderText(9, 'Science')]
      .flatMap((m) => [m.title, m.body])
      .join(' ')
      .toLowerCase();
    expect(words).not.toMatch(/don't lose|you failed|missed|should have|behind/);
  });
});

describe('reading a time back', () => {
  it('reads the way a student reads a clock', () => {
    expect(formatMinute(17 * 60)).toBe('5:00 pm');
    expect(formatMinute(9 * 60 + 30)).toBe('9:30 am');
    expect(formatMinute(0)).toBe('12:00 am');
    expect(formatMinute(12 * 60)).toBe('12:00 pm');
  });
});

describe('the default', () => {
  it('is school days at five, not every day', () => {
    // A reminder on a Sunday morning is the one that gets notifications
    // turned off for good.
    expect(DEFAULT_SCHEDULE.days).toEqual([1, 2, 3, 4, 5]);
    expect(formatMinute(DEFAULT_SCHEDULE.minute)).toBe('5:00 pm');
  });
});
