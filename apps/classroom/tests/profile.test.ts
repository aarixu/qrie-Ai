import { beforeEach, describe, expect, it } from 'vitest';
import type { DiagnosticResult } from '@ai-tutor/knowledge-graph';
import {
  hasDiagnostic,
  hasProfile,
  profileStore,
  saveDiagnostic,
  type StudentProfile,
} from '../src/stores/profile';
import { SYLLABI, subjectsAvailable } from '../src/lib/content';

/**
 * The store key is a persistence contract — changing it orphans every existing
 * student's profile — so the round-trip test names it explicitly rather than
 * reading it back through the same store that wrote it.
 */
const KEY = 'ai-tutor:profile';

const EMPTY: StudentProfile = {
  name: null,
  klass: null,
  subjects: [],
  diagnostic: null,
  diagnosedAt: null,
};

const FILLED: StudentProfile = {
  name: 'Aarav',
  klass: 10,
  subjects: ['Science'],
  diagnostic: null,
  diagnosedAt: null,
};

// The store memoises its first read, so clearing storage alone would leave the
// previous test's value in the cache. Writing the empty profile resets both.
beforeEach(() => {
  localStorage.clear();
  profileStore.set(EMPTY);
});

describe('profileStore', () => {
  it('starts empty, and an empty profile is not a finished one', () => {
    expect(profileStore.get()).toEqual(EMPTY);
    expect(hasProfile(profileStore.get())).toBe(false);
    expect(hasDiagnostic(profileStore.get())).toBe(false);
  });

  it('round-trips the whole profile through storage', () => {
    profileStore.set(FILLED);

    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(FILLED);
    expect(profileStore.get()).toEqual(FILLED);
  });

  it('notifies subscribers when the profile changes', () => {
    let calls = 0;
    const off = profileStore.subscribe(() => {
      calls += 1;
    });
    profileStore.update((p) => ({ ...p, name: 'Aarav' }));
    off();
    profileStore.update((p) => ({ ...p, klass: 8 }));

    expect(calls).toBe(1);
    expect(profileStore.get().klass).toBe(8);
  });
});

describe('hasProfile', () => {
  it('needs a name, a class and at least one subject', () => {
    expect(hasProfile(FILLED)).toBe(true);
  });

  it('is false when any one of the three is missing', () => {
    expect(hasProfile({ ...FILLED, name: null })).toBe(false);
    expect(hasProfile({ ...FILLED, klass: null })).toBe(false);
    expect(hasProfile({ ...FILLED, subjects: [] })).toBe(false);
  });

  it('does not accept a blank name', () => {
    // A name of spaces would pass a length check and then render as nothing.
    expect(hasProfile({ ...FILLED, name: '' })).toBe(false);
    expect(hasProfile({ ...FILLED, name: '   ' })).toBe(false);
  });

  it('does not need the diagnostic — placement is optional', () => {
    expect(hasProfile(FILLED)).toBe(true);
    expect(hasDiagnostic(FILLED)).toBe(false);
  });
});

describe('saveDiagnostic', () => {
  const result: DiagnosticResult = { mastery: { 'a-node': 0.2 }, gaps: [], plan: [], answers: [] };

  it('stores the result and stamps when it was taken', () => {
    const before = Date.now();
    saveDiagnostic(result);
    const p = profileStore.get();

    expect(p.diagnostic).toEqual(result);
    expect(hasDiagnostic(p)).toBe(true);
    expect(Date.parse(p.diagnosedAt as string)).toBeGreaterThanOrEqual(before);
  });

  it('keeps the rest of the profile intact and survives a reload', () => {
    profileStore.set(FILLED);
    saveDiagnostic(result);

    const persisted = JSON.parse(localStorage.getItem(KEY) as string) as StudentProfile;
    expect(persisted.name).toBe('Aarav');
    expect(persisted.klass).toBe(10);
    expect(persisted.diagnostic).toEqual(result);
  });

  it('replaces an earlier result rather than accumulating', () => {
    saveDiagnostic(result);
    const second: DiagnosticResult = { ...result, mastery: { 'a-node': 0.9 } };
    saveDiagnostic(second);

    expect(profileStore.get().diagnostic).toEqual(second);
  });
});

describe('subjectsAvailable (the honest subject list)', () => {
  it('offers only subjects that have an authored syllabus', () => {
    // Classes 6-10: the general-science stream, exactly as authored.
    for (let klass = 6; klass <= 10; klass += 1) {
      expect(subjectsAvailable(klass), `class ${klass}`).toEqual(['Mathematics', 'Science']);
    }
    // Class 11 splits into the separate sciences that exist so far.
    expect(subjectsAvailable(11)).toEqual(['Biology', 'Chemistry', 'Mathematics']);
  });

  it('returns an empty list, not a wishlist, for a class with nothing authored yet', () => {
    // No class 12 syllabus exists. A subject chip with nothing behind it is a
    // promise the first tap breaks - the list must say so.
    expect(subjectsAvailable(12)).toEqual([]);
  });

  it('never names a subject with zero chapters behind it', () => {
    for (let klass = 6; klass <= 12; klass += 1) {
      for (const subject of subjectsAvailable(klass)) {
        const syllabus = SYLLABI.find((s) => s.klass === klass && s.subject === subject);
        expect(syllabus, `${subject} class ${klass}`).toBeDefined();
        expect(syllabus!.chapters.length).toBeGreaterThan(0);
      }
    }
  });
});
