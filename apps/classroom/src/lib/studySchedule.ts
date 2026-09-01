/**
 * WHEN THEY MEANT TO STUDY, AND WHETHER THEY DID.
 *
 * The whole retention design rests on streaks and achievements, and there was
 * no way to bring anybody back — nothing asked when a student studies, and
 * nothing ever reminded them. A streak nobody is reminded of is a streak that
 * breaks on the first busy evening.
 *
 * Everything here is pure: days, a time of day, and a clock passed in. That
 * matters more than usual because the wrong answer is invisible — a reminder
 * scheduled an hour late looks exactly like a reminder that worked, and only
 * a test can tell them apart.
 *
 * DELIVERY IS DELIBERATELY NOT HERE. On a phone these become Capacitor local
 * notifications, which need no server, no FCM project and no network — the
 * device holds the schedule. In a browser they are the Notification API. Both
 * ask this module the same question: when next, and has today been missed.
 */

/** 0 = Sunday, matching Date#getDay, so no translation layer can drift. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface StudySchedule {
  /** Days they chose. Empty means no reminders at all — a real choice. */
  days: readonly Weekday[];
  /** Minutes after midnight, local. 17 * 60 = five in the evening. */
  minute: number;
  /** Off without losing the schedule, for a student who wants a quiet week. */
  enabled: boolean;
}

export const DEFAULT_SCHEDULE: StudySchedule = {
  // School days. Chosen rather than "every day" because a reminder that
  // arrives on a Sunday morning is the one that gets notifications turned off.
  days: [1, 2, 3, 4, 5],
  minute: 17 * 60,
  enabled: true,
};

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "5:00 pm" — the way a student reads a time, not the way a machine stores it. */
export function formatMinute(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

const atMinute = (day: Date, minute: number): Date => {
  const out = new Date(day);
  out.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return out;
};

/**
 * The next moment a reminder should fire, or null.
 *
 * Today counts only if its time has not already passed — a reminder fired the
 * moment the app opens, for a slot two hours gone, is noise that teaches the
 * student to dismiss the next one.
 */
export function nextReminder(schedule: StudySchedule, now: Date): Date | null {
  if (!schedule.enabled || schedule.days.length === 0) return null;

  for (let ahead = 0; ahead < 8; ahead += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() + ahead);
    if (!schedule.days.includes(day.getDay() as Weekday)) continue;

    const when = atMinute(day, schedule.minute);
    if (when > now) return when;
  }
  return null;
}

/**
 * Should we nudge them right now?
 *
 * True only when today is one of their days, the time has come, and they have
 * not already studied today. The last clause is the one that matters: nothing
 * is more likely to get an app muted than being told to study by an app you
 * are studying in.
 */
export function isDueNow(
  schedule: StudySchedule,
  now: Date,
  lastStudied: Date | null,
): boolean {
  if (!schedule.enabled || schedule.days.length === 0) return false;
  if (!schedule.days.includes(now.getDay() as Weekday)) return false;
  if (now < atMinute(now, schedule.minute)) return false;

  if (lastStudied === null) return true;
  const sameDay =
    lastStudied.getFullYear() === now.getFullYear() &&
    lastStudied.getMonth() === now.getMonth() &&
    lastStudied.getDate() === now.getDate();
  return !sameDay;
}

/**
 * What the reminder says.
 *
 * Written here rather than at the delivery point so both a phone notification
 * and an in-app nudge say the same thing, and so the wording is reviewable in
 * one place. Never guilt: a streak is something they built, and the message
 * names it rather than scolding them for risking it.
 */
export function reminderText(streak: number, subject: string | null): { title: string; body: string } {
  const title = streak >= 2 ? `Keep your ${streak}-day streak` : 'Time to study';
  const body = subject
    ? `${subject} is the one you have not touched in a while. One class is enough.`
    : 'One class is enough for today.';
  return { title, body };
}
