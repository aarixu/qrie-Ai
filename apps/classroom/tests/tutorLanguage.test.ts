import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE CHILD WAS ASKED, AND NOW THE ANSWER IS READ.
 *
 * Onboarding asks which language the tutor should speak, stores it, and until
 * this test existed nothing ever read it back — a grep for `tutorLanguage()`
 * found the setters, the tests, and no consumer. The screen carried a comment
 * saying exactly that, in capitals, which is the app writing down a promise it
 * was not keeping.
 *
 * This is the wire, asserted where it is real: the OPTION prepareClass is
 * actually handed. Asserting anywhere else would pass on a build where
 * `tutorLanguage()` is called and its answer dropped on the floor.
 */

const prepared = vi.hoisted(() => ({
  fn: vi.fn(async () => ({
    lesson: { id: 'x', title: 'T', beats: [], elements: [] },
    assets: {},
    report: { topic: 'T', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [] },
  })),
}));

vi.mock('@ai-tutor/class-prep', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, prepareClass: prepared.fn };
});

// No network, no relay, no model. A real planner call costs real rupees.
vi.mock('../src/lib/browserLlm', () => ({
  createBrowserLlm: () => ({ complete: async () => '{}' }),
}));
vi.mock('../src/lib/browserImage', () => ({
  createBrowserImageArtist: () => ({ draw: async () => null }),
  createBrowserVision: () => ({ look: async () => '{}' }),
}));
vi.mock('../src/lib/relay', () => ({ relayFetch: async () => new Response('{}') }));

import { LANGUAGE_PROMISE_NOTE } from '../src/screens/Onboarding';
import { prepareLiveClass } from '../src/lib/liveClass';
import { setTutorLanguage } from '../src/lib/workspace';
import { profileStore, type StudentProfile } from '../src/stores/profile';

/**
 * WHY CLEARING STORAGE IS NOT ENOUGH, and it is not a detail.
 *
 * The workspace lives inside the profile row, and `createLocalStore` keeps an
 * in-memory `cache` that `localStorage.clear()` cannot reach — `read()` hands
 * back the cache whenever it is non-null (src/stores/localStore.ts:114-123).
 * So without this reset a test that sets Hinglish leaks it into every test
 * that runs after it, and the assertion that an un-onboarded child gets
 * ENGLISH — the default this whole product is built on — passes only because
 * of the order the file happens to run in. Proved rather than assumed: with
 * --sequence.shuffle.tests=true this file failed on seed 1 with "expected
 * 'hi-en' to be 'en'". tests/workspace.test.ts:42-46 resets the store for
 * exactly this reason.
 */
const EMPTY: StudentProfile = {
  name: null,
  klass: null,
  subjects: [],
  diagnostic: null,
  diagnosedAt: null,
};

const ask = { topic: 'The Heart', klass: 10, minutes: 3 };

const languageGiven = (): unknown => {
  const last = prepared.fn.mock.calls.at(-1) as unknown[] | undefined;
  if (!last) throw new Error('prepareClass was never called');
  return (last[0] as { language?: unknown }).language;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  profileStore.set({ ...EMPTY });
  prepared.fn.mockClear();
});

describe('the tutor language reaches the preparation', () => {
  it('is English for a student who never answered, which is the stored default', async () => {
    await prepareLiveClass(ask, () => {});
    expect(languageGiven()).toBe('en');
  });

  it('is Hinglish for the student who chose Hinglish', async () => {
    setTutorLanguage('hi-en');
    await prepareLiveClass(ask, () => {});
    expect(languageGiven()).toBe('hi-en');
  });

  it('follows the choice when it changes, rather than one read at start-up', async () => {
    setTutorLanguage('hi-en');
    await prepareLiveClass(ask, () => {});
    expect(languageGiven()).toBe('hi-en');
    setTutorLanguage('en');
    await prepareLiveClass(ask, () => {});
    expect(languageGiven()).toBe('en');
  });

  it('lets a caller ask for a register outright, over the stored one', async () => {
    // NO CALLER PASSES THIS YET. The parameter exists so that a preparation
    // which is not one student's can say so outright — the difference between
    // "no opinion" and "English, please" is one a defaulted argument cannot
    // express. Asserted now because the offline prep scripts and the canvas
    // lab are where it is going, and an untested escape hatch is one that
    // stops working the first time somebody reaches for it.
    setTutorLanguage('hi-en');
    await prepareLiveClass({ ...ask, language: 'en' }, () => {});
    expect(languageGiven()).toBe('en');
  });
});

/**
 * WHAT THE SCREEN PROMISES A CHILD, held to what the code actually does.
 *
 * The paragraph beside the picker is the whole of JOB 2's answer — a Hinglish
 * student is told, before they choose, that the already-written classes stay
 * English. It is exported for two reasons: so this can assert on the words
 * rather than on a snapshot of JSX, and so the contest door can show the SAME
 * paragraph instead of keeping its own copy that drifts. screens/contest/
 * Enrol.tsx imports and renders it, alongside LANGUAGE_QUESTION and
 * LANGUAGE_ANSWER_NOTE, so the two doors cannot promise different things.
 */
describe('the language paragraph promises only what the code does', () => {
  it('promises a LANGUAGE and not a voice, because the voice is not chosen here', () => {
    // Nothing in this phase picks the speaker. The streaming voice is fixed at
    // src/lib/lessonVoice.ts:48 (TUTOR_VOICE), the browser fallback asks for
    // lang 'en-IN' at lessonVoice.ts:79,155, and the relay's own docblock says
    // choosing among its Hindi speakers is a decision nobody has made
    // (packages/relay/src/relays.ts:177-181). A child reads "voice" as what
    // they HEAR, so the word may not appear in a promise about the words.
    expect(LANGUAGE_PROMISE_NOTE).not.toMatch(/voice/i);
  });

  it('tells a child the already-written classes stay English', () => {
    // All fifteen committed lessons carry language "en" and nothing translates
    // them at runtime, so a Hinglish student meets English classes. Saying so
    // at the moment of choosing is the alternative to spending about Rs 30 a
    // topic re-preparing them per student.
    expect(LANGUAGE_PROMISE_NOTE).toMatch(/English/);
    expect(LANGUAGE_PROMISE_NOTE).toMatch(/already written|written so far/i);
  });
});

describe('the screen no longer says nothing reads it', () => {
  /**
   * A COMMENT THAT IS FALSE IN THE FLATTERING DIRECTION IS THE OTHER HALF OF
   * THIS JOB.
   *
   * Onboarding's language step carried "NOTHING READS IT YET" beside a grep
   * that was true when it was written. The moment the wire above lands it is
   * false, and this repo has failed phases for exactly that. Read from source
   * because there is nothing rendered to assert on — a comment is invisible to
   * the DOM, which is precisely why it can rot unnoticed.
   */
  const onboarding = fs.readFileSync(
    path.resolve(__dirname, '../src/screens/Onboarding.tsx'),
    'utf8',
  );

  it('does not claim the answer is unread', () => {
    expect(onboarding).not.toContain('NOTHING READS IT YET');
    expect(onboarding).not.toMatch(/nothing reads (the|this) (choice|answer)/i);
  });

  it('does not tell a child the voice is something that WILL happen later', () => {
    // "This is the voice I will teach you in" was honest while the thread was
    // missing and is an understatement now.
    expect(onboarding).not.toContain('the voice I will teach you in');
  });
});
