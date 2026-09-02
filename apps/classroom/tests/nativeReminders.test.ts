import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE REMINDER THE PHONE KEEPS.
 *
 * The whole retention design rests on somebody coming back, and the browser
 * can only nudge a student who has the tab open — the one person who does not
 * need reminding. These are the two things that have to be right for the OS
 * version: it must land on the day the student picked, and setting it four
 * times must not leave four reminders.
 */

const scheduled: unknown[] = [];
const cancelled: unknown[] = [];
let permission = 'granted';

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: permission }),
    requestPermissions: async () => ({ display: permission }),
    schedule: async (opts: { notifications: unknown[] }) => {
      scheduled.push(...opts.notifications);
    },
    cancel: async (opts: { notifications: unknown[] }) => {
      cancelled.push(...opts.notifications);
    },
  },
}));

let native = true;
vi.mock('../src/lib/platform', () => ({
  isNative: () => native,
  platform: () => (native ? 'android' : 'web'),
}));

const { syncNativeReminders, clearNativeReminders, askForNativeNotifications } = await import(
  '../src/lib/nativeReminders'
);

beforeEach(() => {
  scheduled.length = 0;
  cancelled.length = 0;
  permission = 'granted';
  native = true;
});

afterEach(() => {
  native = true;
});

/** 7:30 pm on Monday, Wednesday, Friday. */
const schedule = {
  enabled: true,
  days: [1, 3, 5] as const,
  minute: 19 * 60 + 30,
};

describe('putting the schedule on the phone', () => {
  it('schedules one repeating notification per chosen day', async () => {
    await syncNativeReminders({ ...schedule, days: [...schedule.days] });

    expect(scheduled).toHaveLength(3);
  });

  it('lands on the days the student picked', async () => {
    // Capacitor counts weekdays from 1 with Sunday first; JavaScript counts
    // from 0. An off-by-one here is a reminder on the wrong day, every week,
    // and nothing else in the app would show it.
    await syncNativeReminders({ ...schedule, days: [...schedule.days] });

    const weekdays = scheduled.map((n) => (n as { schedule: { on: { weekday: number } } }).schedule.on.weekday);
    expect(weekdays).toEqual([2, 4, 6]); // Mon, Wed, Fri
  });

  it('lands at the time they picked', async () => {
    await syncNativeReminders({ ...schedule, days: [1] });

    const on = (scheduled[0] as { schedule: { on: { hour: number; minute: number } } }).schedule.on;
    expect(on).toMatchObject({ hour: 19, minute: 30 });
  });

  it('repeats, rather than firing once and running out', async () => {
    // `on` with no year or month is what makes it weekly. A concrete date
    // would give the student one reminder and then silence.
    await syncNativeReminders({ ...schedule, days: [1] });

    const on = (scheduled[0] as { schedule: { on: Record<string, unknown> } }).schedule.on;
    expect(on.year).toBeUndefined();
    expect(on.month).toBeUndefined();
  });

  it('cancels everything before scheduling, so editing does not accumulate', async () => {
    await syncNativeReminders({ ...schedule, days: [1, 3, 5] });
    scheduled.length = 0;
    cancelled.length = 0;

    await syncNativeReminders({ ...schedule, days: [2] });

    // All seven ids are cleared, not just the ones we set last time — a
    // student who edits their days four times should end with one set.
    expect(cancelled).toHaveLength(7);
    expect(scheduled).toHaveLength(1);
  });

  it('uses the same id for the same weekday every time', async () => {
    await syncNativeReminders({ ...schedule, days: [3] });
    const first = (scheduled[0] as { id: number }).id;
    scheduled.length = 0;

    await syncNativeReminders({ ...schedule, days: [3] });

    expect((scheduled[0] as { id: number }).id).toBe(first);
  });

  it('claims no streak it cannot know', async () => {
    // A notification scheduled on Sunday for Thursday cannot know Thursday's
    // streak. Saying "your 6-day streak is waiting" to somebody who broke it
    // on Tuesday teaches them the app does not know them.
    await syncNativeReminders({ ...schedule, days: [1] });

    const text = JSON.stringify(scheduled[0]);
    expect(text).not.toMatch(/streak|\bday\b\s*\d|\d+\s*day/i);
  });

  it('wakes the phone, rather than waiting for it', async () => {
    // Without this Android holds the notification until the device next
    // wakes, which for a student who studies at seven is a reminder at ten.
    await syncNativeReminders({ ...schedule, days: [1] });

    expect((scheduled[0] as { schedule: { allowWhileIdle: boolean } }).schedule.allowWhileIdle).toBe(
      true,
    );
  });
});

describe('when there is nothing to schedule', () => {
  it('clears them when reminders are switched off', async () => {
    await syncNativeReminders({ ...schedule, days: [1], enabled: false });

    expect(cancelled).toHaveLength(7);
    expect(scheduled).toEqual([]);
  });

  it('clears them when no day is chosen', async () => {
    await syncNativeReminders({ ...schedule, days: [] });

    expect(scheduled).toEqual([]);
  });

  it('schedules nothing when the student said no to notifications', async () => {
    permission = 'denied';

    await syncNativeReminders({ ...schedule, days: [1] });

    expect(scheduled).toEqual([]);
  });

  it('does nothing at all in a browser', async () => {
    native = false;

    await syncNativeReminders({ ...schedule, days: [1] });
    await clearNativeReminders();

    expect(scheduled).toEqual([]);
    expect(cancelled).toEqual([]);
    expect(await askForNativeNotifications()).toBe(false);
  });
});
