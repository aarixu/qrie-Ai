import { createLocalStore } from './localStore';

/**
 * The data spine's first collector. Every raised hand is logged with the beat
 * it interrupted — "which beat collects the most doubts" is exactly the signal
 * that later tells the factory which beat to regenerate. Collection starts on
 * day one, even though the analytics view arrives later.
 */
export interface DoubtEntry {
  lessonId: string;
  beatId: string;
  at: string; // ISO
}

const CAP = 500;

export const doubtLogStore = createLocalStore<DoubtEntry[]>('ai-tutor:doubts', []);

export function logDoubt(lessonId: string, beatId: string): void {
  doubtLogStore.update((log) =>
    [...log, { lessonId, beatId, at: new Date().toISOString() }].slice(-CAP),
  );
}
