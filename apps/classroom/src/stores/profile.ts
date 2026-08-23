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
