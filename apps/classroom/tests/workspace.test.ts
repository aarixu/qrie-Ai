import { beforeEach, describe, expect, it } from 'vitest';
import { profileStore, type StudentProfile } from '../src/stores/profile';
import {
  DEFAULT_WORKSPACE,
  TRIAL_HOME,
  TRIAL_KEY,
  WORKSPACE_ROW_KEY,
  beginTrial,
  endTrial,
  isTrialPath,
  isTrialSession,
  markConsented,
  mayPersist,
  readWorkspace,
  setEntryPath,
  setTutorLanguage,
} from '../src/lib/workspace';

/**
 * THE ONE SHAPE BOTH ENTRY PATHS WRITE.
 *
 * Two doors lead into this app — the contest form and a student who just
 * opens it — and until now they agreed on nothing. The workspace is what they
 * both write, and it is carried INSIDE the existing profile row rather than a
 * table or a store of its own, so it syncs on the back of a row that already
 * syncs and costs nothing extra to keep.
 *
 * The two things this file exists to hold still:
 *   - the tutor language is 'en' | 'hi-en', those exact spellings, and it is
 *     the TUTOR's voice, never the app's chrome;
 *   - a trial session is session-scoped and leaves no trace in the synced row.
 */

const EMPTY: StudentProfile = {
  name: null,
  klass: null,
  subjects: [],
  diagnostic: null,
  diagnosedAt: null,
};

beforeEach(() => {
  endTrial();
  localStorage.clear();
  sessionStorage.clear();
  profileStore.set({ ...EMPTY });
});

describe('the workspace, read back', () => {
  it('gives an English tutor and the self-serve door when the row has never carried one', () => {
    expect(readWorkspace()).toEqual(DEFAULT_WORKSPACE);
    expect(readWorkspace().tutorLanguage).toBe('en');
    expect(readWorkspace().entry).toBe('self_serve');
    expect(readWorkspace().consent).toBeNull();
  });

  it('keeps only the two tutor languages the shipped code spells', () => {
    setTutorLanguage('hi-en');
    expect(readWorkspace().tutorLanguage).toBe('hi-en');

    // A row that came back from the cloud carrying something else — an older
    // build, a hand edit — must not put an unspeakable language into a class.
    profileStore.update((p) => ({
      ...(p as StudentProfile & Record<string, unknown>),
      [WORKSPACE_ROW_KEY]: { version: 1, entry: 'self_serve', tutorLanguage: 'hi', consent: null },
    }));
    expect(readWorkspace().tutorLanguage).toBe('en');
  });

  it('remembers which door the student came through', () => {
    setEntryPath('school');
    expect(readWorkspace().entry).toBe('school');
  });
});

describe('where the workspace is stored', () => {
  it('lives in the profile row, not in a store of its own', () => {
    setTutorLanguage('hi-en');
    const row = JSON.parse(localStorage.getItem('ai-tutor:profile') ?? 'null');
    expect(row?.[WORKSPACE_ROW_KEY]?.tutorLanguage).toBe('hi-en');
    // No second key: a new store key is a new student_state row, and the
    // brief asked for the row that already exists.
    const keys = Object.keys(localStorage).filter((k) => k.includes('workspace'));
    expect(keys).toEqual([]);
  });

  it('does not disturb the name, class or subjects already in the row', () => {
    profileStore.set({ ...EMPTY, name: 'Aarav', klass: 9, subjects: ['Science'] });
    setTutorLanguage('hi-en');
    const p = profileStore.get();
    expect(p.name).toBe('Aarav');
    expect(p.klass).toBe(9);
    expect(p.subjects).toEqual(['Science']);
  });
});

describe('a trial session', () => {
  it('is session-scoped and leaves nothing in the row that syncs', () => {
    beginTrial();
    expect(isTrialSession()).toBe(true);
    expect(sessionStorage.getItem(TRIAL_KEY)).not.toBeNull();
    expect(localStorage.getItem(TRIAL_KEY)).toBeNull();
    expect(localStorage.getItem('ai-tutor:profile') ?? '').not.toContain('trial');
  });

  it('may not persist anything while it is open', () => {
    beginTrial();
    expect(mayPersist()).toBe(false);
  });

  it('is over the moment a consent row exists, and persistence resumes', () => {
    beginTrial();
    markConsented('contest');
    expect(isTrialSession()).toBe(false);
    expect(mayPersist()).toBe(true);
    expect(readWorkspace().consent?.source).toBe('contest');
    expect(Date.parse(readWorkspace().consent?.at ?? '')).not.toBeNaN();
  });

  /**
   * THE CASE THE PREDICATE EXISTS FOR: a device that has already enrolled
   * somebody. A shared contest kiosk, or a family phone — the consent in the
   * profile row belongs to the FIRST child; the second one opening a fresh tab
   * and tapping "try" is a pre-consent minor, and the app must treat them as
   * one.
   */
  it('does not let an earlier student’s consent unlock a new trial on the same device', () => {
    beginTrial();
    markConsented('contest');
    sessionStorage.clear(); // a new tab: the trial mark goes, the consent stays
    beginTrial();
    expect(mayPersist()).toBe(false);
  });

  it('is the ONLY thing that withholds persistence — an ordinary session writes', () => {
    // Said out loud because the opposite reading would stop every student who
    // has not been through the contest door from keeping any work at all.
    expect(mayPersist()).toBe(true);
  });
});

describe('where a trial may go', () => {
  /**
   * THE PREDICATE THE GATE AND THE TRIAL SCREEN SHARE. It exists because an
   * allow-list on the screen alone governed only the first hop: the catalogue
   * then offered a chapter with no authored lesson, and one tap went to
   * /class/<topic> — a live preparation, about Rs 30 against a visitor with no
   * parent and no phone — while /settings wrote and synced a preference for
   * the same pre-consent minor.
   */
  it('lets a trial reach the catalogue and an already-prepared lesson', () => {
    expect(isTrialPath(TRIAL_HOME)).toBe(true);
    expect(isTrialPath('/lesson/class10-blood')).toBe(true);
    // The catalogue's only route into a lesson, so a trial confined without
    // it would be confined to a screen whose every tap bounced.
    expect(isTrialPath('/chapter/class10-science/blood')).toBe(true);
    expect(isTrialPath('/try')).toBe(true);
    expect(isTrialPath('/enrol')).toBe(true);
  });

  it('refuses the paths that spend money or write about a child', () => {
    expect(isTrialPath('/class/class10-science-blood')).toBe(false);
    expect(isTrialPath('/settings')).toBe(false);
    expect(isTrialPath('/diagnostic')).toBe(false);
    expect(isTrialPath('/progress')).toBe(false);
    expect(isTrialPath('/onboarding')).toBe(false);
    expect(isTrialPath('/')).toBe(false);
  });

  it('is not fooled by a lesson-shaped path with something after it', () => {
    expect(isTrialPath('/lesson/abc/../class/x')).toBe(false);
    expect(isTrialPath('/lesson/abc/extra')).toBe(false);
  });
});
