import { LocalNotifications } from '@capacitor/local-notifications';
import type { StudySchedule, Weekday } from './studySchedule';
import { isNative } from './platform';

/**
 * THE REMINDER THE PHONE KEEPS, NOT US.
 *
 * The whole retention design rests on a student coming back, and until now
 * nothing brought anybody back: the browser can only nudge somebody who has
 * the tab open, which is the one person who does not need reminding.
 *
 * This needs no server, no FCM project, no APNs certificate and no network —
 * the phone holds the schedule and fires it on its own, in flight mode, with
 * the app closed. That is not a lesser version of push; for "study at seven on
 * weekdays" it is the RIGHT mechanism, and push is what you reach for when
 * something outside the phone has news. Nothing here does yet.
 *
 * WHAT IT CANNOT DO, said out loud. A notification scheduled on Sunday for
 * next Thursday cannot know Thursday's streak — so it does not claim one.
 * `reminderText` still writes the personalised line for the in-app nudge,
 * where the numbers are real. A notification that said "your 6-day streak is
 * waiting" to somebody who broke it on Tuesday would teach them the app does
 * not know them, which is worse than a plain sentence.
 */

/**
 * One notification id per weekday, fixed.
 *
 * Fixed rather than generated so re-scheduling REPLACES rather than
 * accumulates: a student who edits their days four times should end with four
 * notifications at most, not sixteen.
 */
const ID_BASE = 4200;
const idFor = (day: Weekday): number => ID_BASE + day;
const ALL_IDS = [0, 1, 2, 3, 4, 5, 6].map((d) => idFor(d as Weekday));

/**
 * Capacitor counts weekdays from 1 with Sunday first; JavaScript counts from
 * 0 with Sunday first. One line, in one place, rather than an off-by-one that
 * only shows up as a notification on the wrong day.
 */
const toCapacitorWeekday = (day: Weekday): number => day + 1;

/** What a scheduled reminder says. Deliberately free of any number. */
const TEXT = {
  title: 'Time to study',
  body: 'Your class is ready when you are — even ten minutes counts.',
};

/**
 * Ask, at the moment the student sets a reminder.
 *
 * Never on startup: a notification prompt on first open is the fastest way to
 * be denied forever, and on iOS a denial is painful to undo. Here the request
 * has an obvious reason attached — they have just chosen a time.
 */
export async function askForNativeNotifications(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const now = await LocalNotifications.checkPermissions();
    if (now.display === 'granted') return true;
    if (now.display === 'denied') return false;
    return (await LocalNotifications.requestPermissions()).display === 'granted';
  } catch {
    return false;
  }
}

/**
 * Put the schedule on the phone, replacing whatever was there.
 *
 * Cancel-then-schedule rather than diffing: the set is at most seven entries,
 * and a diff is a second model of the same thing that can disagree with it.
 *
 * Silent about failure on purpose. A reminder that could not be set is a
 * missed nudge; an exception here would be a crash on a settings screen.
 */
export async function syncNativeReminders(schedule: StudySchedule): Promise<void> {
  if (!isNative()) return;

  try {
    await LocalNotifications.cancel({ notifications: ALL_IDS.map((id) => ({ id })) });
  } catch {
    // Nothing was scheduled, which is the state we wanted anyway.
  }

  if (!schedule.enabled || schedule.days.length === 0) return;
  if (!(await askForNativeNotifications())) return;

  const hour = Math.floor(schedule.minute / 60);
  const minute = schedule.minute % 60;

  try {
    await LocalNotifications.schedule({
      notifications: schedule.days.map((day) => ({
        id: idFor(day),
        title: TEXT.title,
        body: TEXT.body,
        schedule: {
          // `on` without a year or month repeats: every week, that weekday,
          // that time. One entry per day rather than seven one-off dates that
          // would run out after a week.
          on: { weekday: toCapacitorWeekday(day), hour, minute },
          // Android otherwise holds it until the phone wakes, which for a
          // student who studies at seven and picks the phone up at ten is a
          // reminder three hours after the thing it was reminding them of.
          allowWhileIdle: true,
        },
      })),
    });
  } catch {
    // Permission revoked between the check and the call, or a platform that
    // refuses exact alarms. The in-app nudge still runs.
  }
}

/** Take them all off. For sign-out, and for turning reminders off. */
export async function clearNativeReminders(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: ALL_IDS.map((id) => ({ id })) });
  } catch {
    // Already gone.
  }
}
