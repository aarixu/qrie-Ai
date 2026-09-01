import { createLocalStore } from './localStore';
import { DEFAULT_SCHEDULE, type StudySchedule } from '../lib/studySchedule';

/**
 * When the student meant to study.
 *
 * Its own store rather than a field on settings, for the reason settings and
 * profile were split: this is read by the reminder machinery and by
 * onboarding, and putting it on settings would make every screen that reads a
 * class depend on the schedule types too.
 *
 * It syncs with everything else — createLocalStore registers it — so a
 * student who sets a reminder on their phone has it on a laptop as well.
 */
export const scheduleStore = createLocalStore<StudySchedule>(
  'ai-tutor:schedule',
  DEFAULT_SCHEDULE,
);

/** Turn reminders off without forgetting when they wanted them. */
export const setRemindersEnabled = (enabled: boolean): void =>
  scheduleStore.update((s) => ({ ...s, enabled }));

export const setStudyDays = (days: StudySchedule['days']): void =>
  scheduleStore.update((s) => ({ ...s, days }));

export const setStudyMinute = (minute: number): void =>
  scheduleStore.update((s) => ({ ...s, minute }));
