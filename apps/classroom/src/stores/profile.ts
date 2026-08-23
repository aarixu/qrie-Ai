import type { DiagnosticResult } from '@ai-tutor/knowledge-graph';
import { createLocalStore } from './localStore';

/**
 * Who the student is, and what the placement test found out about them.
 *
 * Kept apart from `settings` on purpose: settings is the app's own preferences
 * and is read by screens that predate the Learning Outcome Map, while this is
 * the student's identity and their diagnostic result. Merging the two would
 * make every one of those screens depend on the diagnostic types.
 */
export interface StudentProfile {
  name: string | null;
  /** 6..12, or null until onboarding picks one. */
  klass: number | null;
  /** Subjects the student chose to study. Scopes the diagnostic and the plan. */
  subjects: string[];
  /** The last placement result, or null if the test has never been taken. */
  diagnostic: DiagnosticResult | null;
  /** ISO date-time the diagnostic above was produced. */
  diagnosedAt: string | null;
}

/**
 * NCERT subject lists. Classes 6-10 share the general-science stream; 11-12
 * split it into the separate sciences, which is the real break point in the
 * curriculum and the reason this is a table rather than one list.
 *
 * Each class gets its own copy so a caller that sorts or filters in place
 * cannot reach across into another class's list.
 */
const UPPER_PRIMARY_AND_SECONDARY = ['Science', 'Mathematics', 'Social Science', 'English', 'Hindi'];
const SENIOR_SECONDARY = ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'English'];

export const SUBJECTS_BY_CLASS: Record<number, string[]> = {
  6: [...UPPER_PRIMARY_AND_SECONDARY],
  7: [...UPPER_PRIMARY_AND_SECONDARY],
  8: [...UPPER_PRIMARY_AND_SECONDARY],
  9: [...UPPER_PRIMARY_AND_SECONDARY],
  10: [...UPPER_PRIMARY_AND_SECONDARY],
  11: [...SENIOR_SECONDARY],
  12: [...SENIOR_SECONDARY],
};

const EMPTY_PROFILE: StudentProfile = {
  name: null,
  klass: null,
  subjects: [],
  diagnostic: null,
  diagnosedAt: null,
};

export const profileStore = createLocalStore<StudentProfile>('ai-tutor:profile', EMPTY_PROFILE);

/** Onboarding is finished once we know who they are, their class, and what they study. */
export const hasProfile = (p: StudentProfile): boolean =>
  p.name !== null && p.name.trim() !== '' && p.klass !== null && p.subjects.length > 0;

export const hasDiagnostic = (p: StudentProfile): boolean => p.diagnostic !== null;

/**
 * Store a finished placement result. The timestamp is written here rather than
 * by the caller so "when was this student last placed" always means the same
 * thing — it is what decides when a re-test is due.
 */
export function saveDiagnostic(result: DiagnosticResult): void {
  profileStore.update((p) => ({
    ...p,
    diagnostic: result,
    diagnosedAt: new Date().toISOString(),
  }));
}
