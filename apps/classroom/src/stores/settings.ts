import { createLocalStore } from './localStore';

export interface Settings {
  /** 6..12, or null until onboarding picks one. */
  klass: number | null;
}

export const settingsStore = createLocalStore<Settings>('ai-tutor:settings', { klass: null });

export const isOnboarded = (s: Settings): boolean => s.klass !== null;
