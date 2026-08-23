import { createLocalStore } from './localStore';

/**
 * The lessons a student saved to come back to. One flag and a timestamp, and
 * deliberately nothing else: folders, tags and colours all have no consumer
 * today, and every one of them is a migration the day it does get one.
 *
 * Uncapped, unlike the doubt log — a saved lesson is one row per lesson, so the
 * catalogue itself is the bound. A cap here would silently drop a lesson the
 * student chose to keep.
 */
export interface Bookmark {
  lessonId: string;
  at: string; // ISO
}

export const bookmarksStore = createLocalStore<Bookmark[]>('ai-tutor:bookmarks', []);

/** Saves an unsaved lesson, unsaves a saved one. Never two rows for one lesson. */
export function toggleBookmark(lessonId: string): void {
  bookmarksStore.update((saved) =>
    saved.some((b) => b.lessonId === lessonId)
      ? saved.filter((b) => b.lessonId !== lessonId)
      : [...saved, { lessonId, at: new Date().toISOString() }],
  );
}

export const isBookmarked = (saved: readonly Bookmark[], lessonId: string): boolean =>
  saved.some((b) => b.lessonId === lessonId);
