import { createLocalStore } from './localStore';
import { profileStore, type StudentProfile } from './profile';

export interface Settings {
  /** 6..12, or null until onboarding picks one. */
  klass: number | null;
}

export const settingsStore = createLocalStore<Settings>('ai-tutor:settings', { klass: null });

export const isOnboarded = (s: Settings): boolean => s.klass !== null;

/**
 * WHICH CLASS THE STUDENT IS IN, decided once.
 *
 * Both stores hold it. Settings wins when they disagree, because every path
 * that has ever set a class writes it — onboarding, Profile, Settings — while
 * the profile copy is only written by the newer ones, so the profile copy is
 * the one that can be stale and never the other way round.
 *
 * That rule was correct and written down in Settings.tsx, and then copied by
 * hand into seven call sites. Seven copies of a precedence rule is seven places
 * for it to be got backwards after a merge, and the symptom would be a student
 * quietly taught the wrong year — which nothing would throw on.
 *
 * Two stores because sync carries them separately and either can arrive first
 * on a second device; collapsing them into one is a migration, and this is the
 * part of that migration that is free.
 */
export const klassOf = (settings: Settings, profile: StudentProfile): number | null =>
  settings.klass ?? profile.klass;

/** The same rule, for code that is not inside a React render. */
export const currentKlass = (): number | null => klassOf(settingsStore.get(), profileStore.get());
