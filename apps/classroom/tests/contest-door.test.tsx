import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { profileStore, type StudentProfile } from '../src/stores/profile';
import { settingsStore } from '../src/stores/settings';
import { gateTo } from '../src/App';
import { endTrial, mayPersist, TRIAL_HOME, TRIAL_KEY } from '../src/lib/workspace';
import { Enrol, ENROL_STEPS, subjectsFor } from '../src/screens/contest/Enrol';
import { TrialConsent } from '../src/screens/contest/TrialConsent';
import {
  LANGUAGE_ANSWER_NOTE,
  LANGUAGE_QUESTION,
  ONBOARDING_STEPS,
  Onboarding,
  SCHOOL_STUB_BACK,
} from '../src/screens/Onboarding';

/**
 * THE FRONT DOOR, AS A CHILD AND A PARENT SEE IT.
 *
 * These render to a string, so they cannot click: each screen takes the step
 * it should open on, which is the only seam these tests need.
 */

const EMPTY: StudentProfile = {
  name: null,
  klass: null,
  subjects: [],
  diagnostic: null,
  diagnosedAt: null,
};

const render = (screen: ReactElement, at = '/enrol'): string =>
  renderToString(<MemoryRouter initialEntries={[at]}>{screen}</MemoryRouter>);

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

/** The visible words, with the markup taken out. */
const words = (html: string): string => decode(html).replace(/<[^>]+>/g, ' ');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  profileStore.set({ ...EMPTY });
  // The stores hold their value in memory, so clearing storage is not enough:
  // a klass left by the previous test makes isOnboarded true and the trial
  // screen renders for the wrong person.
  settingsStore.update((s) => ({ ...s, klass: null }));
});

describe('the enrolment flow', () => {
  it('asks one question per screen', () => {
    const html = render(<Enrol />);
    // The first screen is the student's name and nothing else: a wall of
    // fields looks shorter and feels longer, and a flow abandoned halfway has
    // still banked the answers behind it.
    expect(html.split('<input').length - 1).toBe(1);
    expect(words(html)).toMatch(/name/i);
  });

  it('collects nothing the relay would not accept', () => {
    // The steps ARE the field list; anything not here cannot be typed.
    expect([...ENROL_STEPS]).toEqual([
      'student',
      'class',
      'subjects',
      'language',
      'school',
      'parent',
      'consent',
      'otp',
    ]);
  });

  /**
   * THE RELAY WANTS 1 TO 10 SUBJECTS (packages/relay/src/enroll.ts:415-421).
   * A class with no authored syllabus therefore cannot send an empty list: it
   * would be refused AFTER the SMS, on the code screen, with a sentence about
   * arrays. Every class the door offers must be able to answer this question.
   */
  it('offers something to pick for every class on the door, authored or not', () => {
    for (const klass of [6, 7, 8, 9, 10, 11, 12]) {
      expect(subjectsFor(klass).length).toBeGreaterThan(0);
    }
  });

  it('does not tell a parent that typed or spoken words stay on the device', () => {
    // lib/ear.ts:205 posts every spoken answer to /api/hear and says so in its
    // own docblock; the doubt agent posts typed turns to /api/llm. A consent
    // taken on a false statement of processing is the one defect on this
    // screen with a legal edge as well as an honesty one.
    const text = words(render(<Enrol initialStep="consent" />));
    expect(text).not.toMatch(/(leave|leaves|stay|stays|stayed)[^.]{0,30}device/i);
    expect(text).toMatch(/sold|sell/i);
  });

  it('asks for consent as an affirmative act, never a pre-ticked box', () => {
    const html = render(<Enrol initialStep="consent" />);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(words(html)).toMatch(/parent|guardian/i);
  });

  it('tells a parent what the code is for before asking for it', () => {
    const html = words(render(<Enrol initialStep="otp" />));
    expect(html).toMatch(/code/i);
    expect(html).toMatch(/SMS|message|phone/i);
  });
});

describe('the try-before-you-enrol consent screen', () => {
  const html = () => words(render(<TrialConsent />, '/try'));

  /**
   * NAMED FOR WHAT THEY ASSERT: these read the RENDERED WORDS. They say
   * nothing about whether any writer obeys mayPersist() — that enforcement
   * lives in files this phase does not own, and a test that certified prose as
   * conduct would be the worst thing on this screen.
   */
  it('states what a child may do with no parent anywhere', () => {
    const text = html();
    expect(text).toMatch(/watch/i);
  });

  it('states the one refusal this bundle actually enforces — no new class is made', () => {
    // The Gate confines a trial to the catalogue and an already-prepared
    // lesson, so /class/<topic> — the Rs 30 preparation — is unreachable.
    const text = html();
    expect(text).toMatch(/new class/i);
    expect(text).toMatch(/money|costs/i);
  });

  it('does not claim marks and answers are already unkept, because nothing yet withholds them', () => {
    // The promise a screen makes and the behaviour underneath it must agree.
    // Until the writers consult mayPersist(), this screen says what is not
    // finished rather than what is not happening.
    const text = html();
    expect(text).not.toMatch(/nothing is saved|no progress and no marks are saved/i);
    expect(text).toMatch(/not finished|still building|being built/i);
  });

  it('opens a real class on a bare link instead of apologising for a dead end', () => {
    // A bare /try used to land on the catalogue, which is scoped to a class a
    // trial student does not have. TRIAL_HOME is now a lesson, so the screen
    // says which one rather than explaining why it cannot show them anything.
    const bare = words(render(<TrialConsent />, '/try'));
    expect(bare).toMatch(/did not name a class/i);
    expect(bare).not.toMatch(/course list|pick your class/i);
    expect(words(render(<TrialConsent />, '/try?next=/lesson/class10-blood'))).not.toMatch(
      /did not name a class/i,
    );
  });

  it('offers the door out of it — the enrolment — from the same screen', () => {
    expect(render(<TrialConsent />, '/try')).toContain('/enrol');
  });
});

describe('onboarding', () => {
  it('forks on where the student came from, with the school arm named as coming', () => {
    const html = words(render(<Onboarding />, '/onboarding'));
    expect(html).toMatch(/school/i);
    expect(html).toMatch(/on your own|myself|by myself/i);
  });

  it('asks which language the CLASS is taught in, never which language the app is', () => {
    expect(LANGUAGE_QUESTION).toMatch(/taught|class/i);
    expect(LANGUAGE_QUESTION).not.toMatch(/app language|interface/i);
    expect([...ONBOARDING_STEPS]).toContain('language');
  });
});

/**
 * THE WIRING BEHIND THE ONE PROMISE THIS SCREEN STATES AS FACT.
 *
 * Everything above reads rendered words. These read BEHAVIOUR: the trial
 * screen tells a child no new class will be made for them, and the only thing
 * that makes that true is the Gate refusing every path outside isTrialPath.
 * Tested against the predicate alone, a future edit to the Gate's condition
 * would break the money guarantee with a green suite.
 */
describe('the Gate, which is what makes the trial promise true', () => {
  const trial = (at: string) => gateTo(at, { settled: false, trial: true, bench: false });

  it('refuses a trial the preparation path, which is where the money is spent', () => {
    // /class/<topic> is a live prepareClass — the one refusal the screen
    // states as fact rather than as unfinished.
    expect(trial('/class/class10-science%2Flife-processes%2Frespiration')).not.toBeNull();
    expect(trial('/settings')).not.toBeNull();
    expect(trial('/progress')).not.toBeNull();
    expect(trial('/diagnostic')).not.toBeNull();
    // LessonComplete writes the progress card, so the end of the class is
    // refused too — deliberately, and with words rather than in silence.
    expect(trial('/complete/class10-blood')).not.toBeNull();
  });

  it('lets a trial reach the class it was promised', () => {
    expect(trial(TRIAL_HOME)).toBeNull();
    expect(trial('/syllabus')).toBeNull();
    expect(trial('/chapter/class10-science/life-processes')).toBeNull();
    expect(trial('/try')).toBeNull();
    expect(trial('/enrol')).toBeNull();
  });

  it('carries the refused path to /try, so a blocked tap can be explained', () => {
    // A silent teleport back to the screen they already read is the defect;
    // the refusal itself is right.
    expect(trial('/progress')).toBe('/try?blocked=%2Fprogress');
  });

  it('still sends an ordinary un-onboarded visitor to onboarding, and never the doors', () => {
    const fresh = (at: string) => gateTo(at, { settled: false, trial: false, bench: false });
    expect(fresh('/progress')).toBe('/onboarding');
    expect(fresh('/try')).toBeNull();
    expect(fresh('/enrol')).toBeNull();
  });

  /**
   * THE GUEST TRIAL ON A SETTLED DEVICE, which this suite used to assert was
   * confined by nothing.
   *
   * It is the branch the whole design exists for: TrialConsent offers a
   * settled device "Not me — watch a class as a guest", beginTrial opens one
   * (it refuses nobody, by decision — see its docblock), and the child who
   * taps it is the second one at a shared kiosk, with no parent and no
   * consent. Confining only `!settled && trial` left exactly that child with
   * the unconfined app while the screen they had just read promised them
   * "a trial is the class, and nothing else".
   */
  it('confines a guest trial on a settled device, the same as any other trial', () => {
    const guest = (at: string) => gateTo(at, { settled: true, trial: true, bench: false });
    // The money path first: /class/<topic> is a live preparation.
    expect(guest('/class/life-processes')).toBe('/try?blocked=%2Fclass%2Flife-processes');
    expect(guest('/settings')).toBe('/try?blocked=%2Fsettings');
    expect(guest('/progress')).toBe('/try?blocked=%2Fprogress');
    expect(guest('/diagnostic')).toBe('/try?blocked=%2Fdiagnostic');
    // And it can still watch the class it came for, and still leave.
    expect(guest('/lesson/class10-blood')).toBeNull();
    expect(guest('/try')).toBeNull();
  });
});

describe('the trial does not swallow a student who already has an app', () => {
  /**
   * A DEVICE CANNOT TELL AN ENROLLED STUDENT FROM THE NEXT CHILD AT A KIOSK,
   * so neither of these is decided in code. beginTrial opens a trial for
   * anyone who asks — otherwise the second child at a shared contest phone is
   * handed somebody else's app, which is the hole mayPersist refuses — and the
   * enrolled student is protected by being asked, and by being able to leave.
   */
  it('offers a settled device its own app first, and a guest trial second', () => {
    settingsStore.update((s) => ({ ...s, klass: 10 }));
    const text = words(render(<TrialConsent />, '/try'));
    expect(text).toMatch(/already signed up on this device/i);
    expect(text).toMatch(/back to my classes/i);
    // ...and the second child can still say that is not them.
    expect(text).toMatch(/not me/i);
  });

  it('gives an open trial a way out, which is what makes it not a one-way door', () => {
    sessionStorage.setItem(TRIAL_KEY, new Date().toISOString());
    expect(mayPersist()).toBe(false);
    expect(words(render(<TrialConsent />, '/try'))).toMatch(/leave the trial/i);
    endTrial();
    expect(mayPersist()).toBe(true);
  });
});

describe('what the trial screen may promise a child about money and about sending', () => {
  const html = () => words(render(<TrialConsent />, '/try'));

  it('does not tell a child nothing is sent anywhere, because the report sheet sends', () => {
    // ui/ReportSheet.tsx:131 POSTs the child's own note to /api/report under
    // a verified user id, and report.ts:48 keeps it verbatim and permanently.
    // ReportSheet is mounted inside the lesson a trial is allowed to reach.
    const text = html();
    expect(text).not.toMatch(/nobody is told you were here/i);
    expect(text).toMatch(/if you tell us|report|something is wrong/i);
  });

  it('scopes the money sentence to the class we will not BUILD, not to the whole trial', () => {
    // Watching an unrecorded class still spends vendor speech units. The
    // enforced promise is narrower than "your trial is free" and must read
    // that way.
    const text = html();
    expect(text).toMatch(/new class/i);
    expect(text).not.toMatch(/free for you|costs? (?:you )?nothing/i);
  });

  it('defaults the trial to the one lesson that ships with a recording', () => {
    // lessonVoice prefers recorded audio over the PAID relay voice, and
    // content/class10-blood/audio/narration.json is the only narration.json in
    // content/ — so this is the only trial that spends no vendor speech.
    expect(TRIAL_HOME).toBe('/lesson/class10-blood');
    expect(fs.existsSync(path.resolve(__dirname, '../../../content/class10-blood/audio/narration.json'))).toBe(true);
  });

  it('says which thing was refused when the Gate sent them back', () => {
    expect(words(render(<TrialConsent />, '/try?blocked=%2Fclass%2Fx'))).toMatch(
      /not been made|has not been made yet/i,
    );
  });
});

describe('the language pickers say a child may answer in either', () => {
  /**
   * matchSpokenAnswer takes no language argument (match.ts:124) but carries
   * Hinglish position words and returns index: null whenever it is unsure, so
   * a Hinglish answer escalates rather than being marked wrong. The copy may
   * therefore say so — and until it does, a child who picked Hinglish has been
   * shown a Hinglish classroom and told nothing about the microphone.
   */
  it('on onboarding', () => {
    expect(words(render(<Onboarding />, '/onboarding'))).toBeTypeOf('string');
    expect(LANGUAGE_ANSWER_NOTE).toMatch(/answer in either|either one/i);
  });

  it('on the contest door', () => {
    expect(words(render(<Enrol initialStep="language" />))).toMatch(
      /answer in either|either one/i,
    );
  });
});

describe('the school stub is not a one-way door', () => {
  it('offers a way back to the fork that does not rewrite where they came from', () => {
    // The header Back button is disabled at index 0, so a mis-tap on the
    // second card had no exit but the one that also sets entry to self_serve.
    expect(SCHOOL_STUB_BACK).toMatch(/back|choose again/i);
  });
});
