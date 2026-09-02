import { computeStreak, progressStore } from '../stores/progress';
import { profileStore } from '../stores/profile';
import { scheduleStore } from '../stores/schedule';
import { isDueNow, reminderText } from './studySchedule';
import { askForNativeNotifications, syncNativeReminders } from './nativeReminders';
import { isNative } from './platform';
import { subjectNeedingAttention, subjectProgress } from './subjectProgress';
import { fetchCatalog, subjectsAvailable } from './content';

/**
 * DELIVERING THE NUDGE.
 *
 * The decision of WHETHER to nudge lives in studySchedule.ts, pure and
 * tested. This is only the delivery, and it is deliberately thin because
 * delivery is the part that changes: a browser has the Notification API, a
 * phone will have Capacitor's local notifications — which need no server, no
 * FCM project and no network, because the device holds the schedule itself.
 *
 * TWO RULES THIS OBEYS.
 *
 * Permission is never asked for on startup. A notification prompt on first
 * open is the fastest way to be denied forever, and on iOS a denial is
 * painful to undo. It is asked for at the moment the student sets a reminder,
 * where the request has an obvious reason attached.
 *
 * And nothing fires twice in a day. A student who leaves the tab open, or
 * opens the app four times in an evening, is one person having one evening.
 */

const LAST_FIRED = 'ai-tutor:reminded-on';

const today = (now: Date): string =>
  `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

const firedToday = (now: Date): boolean => {
  try {
    return localStorage.getItem(LAST_FIRED) === today(now);
  } catch {
    // No storage means we cannot promise once-a-day, and a reminder every
    // open would be worse than none.
    return true;
  }
};

const markFired = (now: Date): void => {
  try {
    localStorage.setItem(LAST_FIRED, today(now));
  } catch {
    // Nothing to do: the guard above already fails closed.
  }
};

/**
 * Asked at the moment a reminder is set, never on startup.
 *
 * Two mechanisms behind one question. In a browser it is the Notification
 * API, which can only reach somebody with the tab open — the one person who
 * does not need reminding. On a phone it is the OS, which fires with the app
 * closed and no network, and that is the whole point of Phase 2 being here.
 */
export async function askForNotifications(): Promise<boolean> {
  if (isNative()) return askForNativeNotifications();
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export const notificationsAllowed = (): boolean =>
  typeof Notification !== 'undefined' && Notification.permission === 'granted';

/**
 * Keep the phone's own schedule in step with the student's.
 *
 * Subscribed rather than called from each setter, so a reminder set in
 * onboarding, changed in settings, or arriving from another device through
 * sync all reach the phone by the same path. Fired once at startup too,
 * because a student who signed in on a new phone has a schedule the phone has
 * never been told about.
 */
export function watchScheduleForNative(): () => void {
  if (!isNative()) return () => undefined;
  void syncNativeReminders(scheduleStore.get());
  return scheduleStore.subscribe(() => {
    void syncNativeReminders(scheduleStore.get());
  });
}

/**
 * Nudge if this is the moment. Returns what was shown, for the in-app banner
 * to use when a notification could not be.
 */
export async function nudgeIfDue(now: Date = new Date()): Promise<{
  title: string;
  body: string;
} | null> {
  // On a phone the OS already holds this schedule and will fire whether the
  // app is open or not. Running the in-app nudge too would be the same
  // reminder twice, and the second one arrives in the app they are already in.
  if (isNative()) return null;

  const schedule = scheduleStore.get();
  const progress = progressStore.get();

  const finishes = Object.values(progress.lessons)
    .map((l) => l.completedAt)
    .filter((at): at is string => typeof at === 'string');
  const lastStudied =
    finishes.length > 0 ? new Date(finishes.reduce((a, b) => (a > b ? a : b))) : null;

  if (!isDueNow(schedule, now, lastStudied)) return null;
  if (firedToday(now)) return null;

  // Which subject is being quietly dropped — the reason to track several in
  // the first place. A failure here must not cost the reminder.
  let subject: string | null = null;
  try {
    const profile = profileStore.get();
    const catalog = await fetchCatalog();
    subject = subjectNeedingAttention(
      subjectProgress({
        catalog: catalog.filter((e) => e.class === (profile.klass ?? e.class)),
        progress,
        chosen: profile.subjects,
        offered: profile.klass === null ? [] : subjectsAvailable(profile.klass),
      }),
    );
  } catch {
    subject = null;
  }

  const message = reminderText(computeStreak(progress), subject);
  markFired(now);

  if (notificationsAllowed()) {
    try {
      new Notification(message.title, { body: message.body, tag: 'ai-tutor-study' });
    } catch {
      // Some browsers refuse the constructor outside a service worker; the
      // caller still gets the message for the in-app banner.
    }
  }
  return message;
}
