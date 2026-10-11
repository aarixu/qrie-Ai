import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../ui/Icon';
import { Bloub } from '../../bloub/Bloub';
import { subjectsAvailable } from '../../lib/content';
import { MAX_NAME_CHARS } from '../../lib/student';
import { profileStore } from '../../stores/profile';
import { settingsStore } from '../../stores/settings';
import { markConsented, type TutorLanguage } from '../../lib/workspace';
import { LANGUAGE_ANSWER_NOTE, LANGUAGE_PROMISE_NOTE, LANGUAGE_QUESTION } from '../Onboarding';
import {
  requestOtp,
  submitEnrolment,
  toE164,
  type EnrolResult,
  type OtpResult,
} from '../../lib/enroll';

/**
 * THE FRONT DOOR: THE ENROLMENT THE WHOLE D2C FUNNEL ARRIVES THROUGH.
 *
 * Four jobs in one flow — the contest entry, the student's account, the DPDP
 * verifiable-parental-consent artifact, and the moment the app stops being a
 * trial. packages/relay/src/enroll.ts is the contract it speaks; lib/enroll.ts
 * is the only thing here that knows an HTTP status exists.
 *
 * ONE QUESTION PER SCREEN, like onboarding. A wall of fields looks shorter
 * and feels longer, and a flow abandoned halfway has still banked the answers
 * behind it.
 *
 * EXACTLY WHAT THE RELAY ACCEPTS AND NOTHING MORE. The steps below ARE the
 * field list: student name, class, subjects, an optional school and city, the
 * parent's name and phone, consent, and the code. There is no email, no
 * second phone, no date of birth. Every extra field is a data-protection
 * liability on a form filled in by children, with no use in MVP-1 — if you
 * find yourself adding one, stop.
 *
 * WHO WRITES THE PROFILE. The relay validates the student's name, class and
 * subjects and then keeps NONE of them (see the docblock in enroll.ts): the
 * only row it writes is the consent. So a contest enrolment that never runs
 * app code produces a consent row and no profile at all — the casualty that
 * docblock names. This screen IS app code, so on success it writes the
 * profile itself, from the same answers it just sent.
 */

export const ENROL_STEPS = [
  'student',
  'class',
  'subjects',
  'language',
  'school',
  'parent',
  'consent',
  'otp',
] as const;
export type EnrolStep = (typeof ENROL_STEPS)[number];

const CLASSES = [6, 7, 8, 9, 10, 11, 12];

/**
 * WHAT A CLASS WITH NOTHING AUTHORED YET MAY ANSWER WITH.
 *
 * packages/syllabus/data holds classes 6-11, so subjectsAvailable(12) is an
 * empty list — and the relay requires 1 to 10 subjects
 * (packages/relay/src/enroll.ts:415-421). Offering a Class 12 student no chips
 * and letting them walk on sent `subjects: []` into a 400 that arrives AFTER
 * the SMS, on the code screen, worded as 'subjects is 1 to 10 short names': a
 * permanent dead end on the front door, for the segment with the most intent,
 * presented to a parent as a wrong code.
 *
 * So an unauthored class is offered the ordinary NCERT list and picks from it.
 * The answer is the student's own — never a placeholder posted on their
 * behalf — and the copy on that step says plainly that the lessons are still
 * being written. What the relay stores is a subject a student chose; what we
 * still owe them is the lesson, which is a content job, not an enrolment one.
 */
const NCERT_SENIOR = ['Physics', 'Chemistry', 'Mathematics', 'Biology'];
const NCERT_JUNIOR = ['Mathematics', 'Science'];

export function subjectsFor(klass: number): string[] {
  const authored = subjectsAvailable(klass);
  if (authored.length > 0) return authored;
  return klass >= 11 ? [...NCERT_SENIOR] : [...NCERT_JUNIOR];
}

/** The one primary-action recipe, verbatim from the rest of the app. */
const PRIMARY =
  'w-full bg-primary text-on-primary font-label-md text-label-md px-6 py-4 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all disabled:opacity-40 disabled:active:translate-y-0';

const FIELD =
  'w-full min-h-[56px] px-5 rounded-2xl border-2 border-surface-variant bg-surface-container-lowest font-headline-md text-[20px] text-on-surface outline-none focus:border-primary transition-colors';

/**
 * The campaign this enrolment came from, or nothing at all.
 *
 * TRIMMED AND BOUNDED IN ONE PLACE, because two things read it and they must
 * not disagree. `/enrol?c=` — a blank campaign, which a marketing template
 * emits without noticing — used to make the app write a consent mark saying
 * 'contest' while the relay, which drops blank optionals, recorded
 * 'self_serve': one consent, two provenances, and the app reasons from the
 * local one. The relay also refuses a code over 40 characters
 * (enroll.ts:446-448) with a 400 that reaches a parent as "your code is
 * wrong", so a long UTM-style value would kill every enrolment from that link
 * with nobody able to guess why. The label is caller-asserted and worth
 * nothing; the enrolment is worth everything, so an unusable label is dropped
 * rather than sent.
 */
function campaignOf(asked: string | null): string | undefined {
  const c = (asked ?? '').trim();
  return c === '' || c.length > 40 ? undefined : c;
}

/** A refusal, in the words the relay or the client chose. Never a code. */
function Refusal({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="alert"
      className="mt-4 rounded-xl bg-error-container text-on-error-container px-4 py-3 font-body-md text-body-md flex gap-2"
    >
      <Icon name="error" className="text-[20px] shrink-0 mt-0.5" />
      <span>{message}</span>
    </p>
  );
}

export function Enrol({ initialStep = 'student' }: { initialStep?: EnrolStep }) {
  const [params] = useSearchParams();
  /**
   * `?c=<campaign>` is the contest this enrolment came from, and it is what
   * makes consent_record.source say 'contest'. CALLER-ASSERTED: the relay
   * checks no contest list, so this is a label, never evidence.
   */
  const contestCode = campaignOf(params.get('c'));

  const [step, setStep] = useState<EnrolStep>(initialStep);
  const [studentName, setStudentName] = useState('');
  const [klass, setKlass] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [schoolName, setSchoolName] = useState('');
  const [city, setCity] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [otp, setOtp] = useState('');
  const [tutorLanguage, setTutorLanguageChoice] = useState<TutorLanguage>('en');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const index = ENROL_STEPS.indexOf(step);
  const available = klass !== null ? subjectsFor(klass) : [];
  const authored = klass !== null && subjectsAvailable(klass).length > 0;
  const phone = toE164(parentPhone);

  const back = () => {
    setRefusal(null);
    setStep(ENROL_STEPS[Math.max(0, index - 1)]);
  };

  const chooseClass = (next: number) => {
    setKlass(next);
    // Subjects are per class, so a class change cannot keep the old
    // selection. Default to everything AUTHORED: opting out is easier than
    // opting in — but a class with nothing written yet starts empty, because
    // there the list is a question and not a confirmation.
    setSubjects(subjectsAvailable(next));
    setStep('subjects');
  };

  const toggleSubject = (subject: string) =>
    setSubjects((current) =>
      current.includes(subject) ? current.filter((s) => s !== subject) : [...current, subject],
    );

  /** Ask for the code, and only move on if one actually went out. */
  const sendCode = async (): Promise<void> => {
    if (phone === null) {
      setRefusal('That does not look like a mobile number. Please check it.');
      return;
    }
    setBusy(true);
    setRefusal(null);
    const out: OtpResult = await requestOtp(phone);
    setBusy(false);
    if (!out.ok) {
      setRefusal(out.message);
      /**
       * A REFUSAL IS NOT ALWAYS A REASON TO WITHHOLD THE INPUT. The send gate
       * is three per phone per ten minutes and a code lives ten minutes
       * (relay enroll.ts:130,136), so a parent who reloaded the page or came
       * back later was locked out of typing a code sitting on their phone,
       * for exactly as long as that code was good for. Advancing sends no
       * SMS — the relay verifies whatever is typed — and the wait sentence is
       * still on the screen above the box.
       */
      if (out.refusal.kind === 'rate-limited' || out.refusal.kind === 'gate-down') {
        setStep('otp');
      }
      return;
    }
    setStep('otp');
  };

  /**
   * Verify, record the consent, write the profile, and GO WHERE THE SERVER
   * SAYS. `next` is server-decided on purpose; a full navigation is used
   * rather than a router push because the relay answers a site path
   * ('/app/…'), not a route inside this bundle.
   */
  const finish = async (): Promise<void> => {
    if (klass === null || phone === null) return;
    setBusy(true);
    setRefusal(null);
    const out: EnrolResult = await submitEnrolment({
      studentName,
      klass,
      board: 'ncert',
      subjects,
      schoolName,
      city,
      parentName,
      parentPhone: phone,
      otp,
      contestCode,
    });
    setBusy(false);
    if (!out.ok) {
      setRefusal(out.message);
      return;
    }

    /**
     * THE CONSENT MARK IS WRITTEN FIRST, AND THE ORDER IS THE POINT.
     *
     * markConsented is the only thing that calls endTrial. A student who
     * enrolled from inside a trial is still in one at this instant, so every
     * write ahead of it happens while mayPersist() is false — and the first
     * handed-off guard that lands on the profile store or on sync would
     * discard the enrolment's OWN row. That failure is invisible: the relay
     * accepted, the consent row exists in Postgres, the student is navigated
     * away, and the device has nothing. It is exactly the casualty
     * packages/relay/src/enroll.ts:55-58 names, arriving by a second route.
     *
     * The entry path and the tutor language ride in the same call rather than
     * following it, so the row this screen syncs is stamped once.
     *
     * The tutor language has to be written here at all because the contest
     * door is the whole D2C funnel and would otherwise be silently English:
     * settingsStore.update below makes isOnboarded true (stores/settings.ts:11),
     * so the Gate never sends this student to /onboarding, the language
     * question there is unreachable for them for good, and there is no
     * setting that asks it later.
     */
    markConsented(contestCode !== undefined ? 'contest' : 'self_serve', {
      entry: 'self_serve',
      tutorLanguage,
    });

    profileStore.update((p) => ({
      ...p,
      name: studentName.trim(),
      klass,
      subjects,
    }));
    // settingsStore still drives screens that predate the profile store.
    settingsStore.update((s) => ({ ...s, klass }));

    window.location.assign(out.next);
  };

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md flex flex-col">
      <header className="flex items-center gap-3 px-margin-mobile pt-6 pb-2 w-full max-w-[520px] mx-auto">
        <button
          onClick={back}
          disabled={index === 0}
          aria-label="Back"
          className="w-10 h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-0"
        >
          <Icon name="arrow_back" />
        </button>
        <div className="flex-1 flex gap-1.5">
          {ENROL_STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full transition-colors ${
                i <= index ? 'bg-primary' : 'bg-surface-variant'
              }`}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 grid place-items-center px-margin-mobile pb-10">
        <div className="w-full max-w-[440px]">
          {step === 'student' && (
            <div className="text-center">
              {/* Her shape, not the avatar: it is switched off (src/avatar/README.md). */}
              <div className="grid place-items-center mb-5" aria-hidden>
                <Bloub mode="idle" size={104} />
              </div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                What is the student's name?
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                Just their first name is enough.
              </p>
              {/* Forty, the same cap as the onboarding door (lib/student.ts),
                  held in the handler too: maxLength stops typing, not a paste
                  or an autofill. The class planner is not told the name, so
                  this no longer promises to use it in class. */}
              <input
                value={studentName}
                onChange={(e) => setStudentName(e.target.value.slice(0, MAX_NAME_CHARS))}
                placeholder="First name"
                aria-label="Student's first name"
                maxLength={MAX_NAME_CHARS}
                className={`${FIELD} text-center`}
              />
              <button
                onClick={() => setStep('class')}
                disabled={studentName.trim().length === 0}
                className={`mt-stack-md ${PRIMARY}`}
              >
                Continue
              </button>
            </div>
          )}

          {step === 'class' && (
            <div className="text-center">
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                Which class?
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                Classes match the level. This can be changed later.
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {CLASSES.map((k) => (
                  <button
                    key={k}
                    onClick={() => chooseClass(k)}
                    className={`rounded-[20px] py-5 shadow-sm border-2 transition-all flex flex-col items-center hover:scale-[1.03] ${
                      klass === k
                        ? 'bg-primary-fixed border-primary'
                        : 'bg-surface-container-lowest border-transparent hover:border-primary-fixed-dim'
                    }`}
                  >
                    <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">
                      Class
                    </span>
                    <span className="font-headline-lg text-[30px] leading-9 text-primary">{k}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'subjects' && (
            <div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2 text-center">
                Which subjects?
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md text-center">
                {/* Only what exists for that class is offered. A chip with
                    nothing behind it is a promise the first tap breaks. */}
                {authored
                  ? 'Pick at least one. More subjects are on their way.'
                  : `Lessons for Class ${klass} are still being written. Pick what you study, and we will tell you the moment they are ready.`}
              </p>
              <div className="flex flex-wrap gap-3 justify-center">
                {available.map((subject) => {
                  const on = subjects.includes(subject);
                  return (
                    <button
                      key={subject}
                      onClick={() => toggleSubject(subject)}
                      aria-pressed={on}
                      className={`flex items-center gap-2 px-5 py-3 rounded-full border-2 font-label-md text-label-md transition-colors ${
                        on
                          ? 'bg-primary-fixed border-primary text-on-primary-fixed-variant'
                          : 'bg-surface-container-lowest border-surface-variant text-on-surface-variant'
                      }`}
                    >
                      {on && <Icon name="check" className="text-[18px]" />}
                      {subject}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setStep('language')}
                // The relay wants 1 to 10 subjects, so an empty selection
                // cannot go — for ANY class, including one with nothing
                // authored, which is why subjectsFor always offers a list.
                disabled={subjects.length === 0}
                className={`mt-stack-lg ${PRIMARY}`}
              >
                Continue
              </button>
            </div>
          )}

          {step === 'language' && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-primary-fixed grid place-items-center mx-auto mb-5">
                <Icon name="translate" className="text-[38px] text-on-primary-fixed" />
              </div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                {LANGUAGE_QUESTION}
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                {/* THE SAME SENTENCE AS ONBOARDING'S, BECAUSE IT IS THE SAME
                    PROMISE and two copies of a promise are two things to keep
                    true. This door had its own wording, and it went stale the
                    moment lib/liveClass.ts started reading the answer: it still
                    said "nothing reads the answer yet" and put the whole thing
                    in the future tense. It also said VOICE, which onboarding
                    deliberately does not — a child reads voice as what they
                    HEAR, and the speaker is still en-IN whichever language is
                    picked. LANGUAGE_PROMISE_NOTE is exported for exactly this. */}
                {LANGUAGE_PROMISE_NOTE} {LANGUAGE_ANSWER_NOTE}
              </p>
              <div className="flex flex-col gap-3">
                {(
                  [
                    { value: 'en', title: 'English', said: '"Let us look at the heart."' },
                    { value: 'hi-en', title: 'Hinglish', said: '"Chalo, heart ko dekhte hain."' },
                  ] as const
                ).map((option) => {
                  const on = tutorLanguage === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setTutorLanguageChoice(option.value)}
                      aria-pressed={on}
                      className={`rounded-[20px] p-5 shadow-sm border-2 transition-all text-left ${
                        on
                          ? 'bg-primary-fixed border-primary'
                          : 'bg-surface-container-lowest border-transparent hover:border-primary-fixed-dim'
                      }`}
                    >
                      <span className="block font-label-md text-label-md text-on-surface">
                        {option.title}
                      </span>
                      <span className="block font-label-md text-label-md text-on-surface-variant">
                        {option.said}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setStep('school')} className={`mt-stack-lg ${PRIMARY}`}>
                Continue
              </button>
            </div>
          )}

          {step === 'school' && (
            <div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2 text-center">
                School and city?
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md text-center">
                Both are optional. They only help us know which schools our students come from.
              </p>
              <input
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="School name"
                aria-label="School name"
                maxLength={120}
                className={FIELD}
              />
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                aria-label="City"
                maxLength={120}
                className={`${FIELD} mt-3`}
              />
              <button onClick={() => setStep('parent')} className={`mt-stack-md ${PRIMARY}`}>
                Continue
              </button>
            </div>
          )}

          {step === 'parent' && (
            <div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2 text-center">
                A parent's name and phone
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md text-center">
                We send one code to this phone to check a parent is really here. It is the
                number we would use to reach you about your child.
              </p>
              <input
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                placeholder="Parent's name"
                aria-label="Parent's name"
                maxLength={80}
                className={FIELD}
              />
              <input
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                placeholder="Mobile number"
                aria-label="Parent's mobile number"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                className={`${FIELD} mt-3`}
              />
              <button
                onClick={() => {
                  setRefusal(null);
                  setStep('consent');
                }}
                disabled={parentName.trim().length === 0 || phone === null}
                className={`mt-stack-md ${PRIMARY}`}
              >
                Continue
              </button>
              {parentPhone.trim() !== '' && phone === null && (
                <p className="mt-3 font-label-md text-label-md text-on-surface-variant text-center">
                  Enter the ten digits of a mobile that can receive an SMS.
                </p>
              )}
            </div>
          )}

          {step === 'consent' && (
            <div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2 text-center">
                A parent has to agree
              </h1>
              <div className="rounded-2xl bg-surface-container-lowest border-2 border-surface-variant p-5 font-body-md text-body-md text-on-surface-variant flex flex-col gap-3">
                <p>
                  {/* What is agreed to, in the words of the thing that is
                      actually kept: the consent row, the profile, and the
                      work the student does once they are enrolled. */}
                  You are agreeing that {studentName.trim() || 'this student'} may learn here,
                  and that we may keep their class, their answers and their progress so the
                  teaching can follow where they are.
                </p>
                <p>
                  {/* WHAT ACTUALLY HAPPENS TO THE CHILD'S WORDS. lib/ear.ts postAnswer
                      posts every spoken answer to our relay to be transcribed —
                      that file's own docblock says "the relay hears
                      everything" — and a typed doubt goes the same way to be
                      answered. The relay does not do either itself: wherever
                      it has a Google service account, packages/relay/src/
                      handler.ts sends /api/hear and /api/llm to Vertex. This
                      used to say the words went to nobody else, which was
                      false from the day Vertex went live. A consent taken on
                      a false account of the processing is not a consent, so
                      this says what happens rather than what would be
                      reassuring; /privacy lists every service by name. */}
                  We keep your name and this phone number so we can reach you about your child.
                  What {studentName.trim() || 'the student'} says or types in class is sent to
                  us, and from us to Google's AI service, which turns speech into text and
                  helps the tutor reply. We do not sell it, nobody else is given it, and we do
                  not use it to work out who they are.
                </p>
                <p>
                  {/* NOT VERIFIED that there is a way to ask: this repo has no
                      grievance address anywhere, which PRD 3 and PRD 6 both
                      record as the same zero-hit grep. So this names the only
                      channel that exists today — the person who enrolled
                      them — rather than a form that was never built. */}
                  You can ask us to delete all of it, at any time — tell whoever gave you this
                  link, and we will.
                </p>
              </div>

              {/* An affirmative act, never a pre-ticked box: the relay refuses
                  anything but the literal true, and a default-on tick would
                  be a consent nobody gave. */}
              <label className="flex gap-3 items-start mt-stack-md cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="w-6 h-6 mt-0.5 accent-primary shrink-0"
                />
                <span className="font-body-md text-body-md text-on-surface">
                  I am {studentName.trim() ? `${studentName.trim()}'s` : 'this student’s'} parent
                  or guardian, and I agree.
                </span>
              </label>

              <button
                onClick={() => void sendCode()}
                disabled={!consent || busy}
                className={`mt-stack-md ${PRIMARY}`}
              >
                {busy ? 'Sending the code…' : 'Send the code'}
              </button>
              <Refusal message={refusal} />
            </div>
          )}

          {step === 'otp' && (
            <div className="text-center">
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                Type the code
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                {/* Not "six digits": six is what the development provider
                    sends, while the relay accepts four to eight so a vendor
                    can send another length (enroll.ts:443). */}
                We sent an SMS to {phone ?? 'that phone'}. Type the code it carries — it stops
                working after ten minutes.
              </p>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="------"
                aria-label="The code from the SMS"
                inputMode="numeric"
                autoComplete="one-time-code"
                className={`${FIELD} text-center tracking-[0.4em]`}
              />
              <button
                onClick={() => void finish()}
                disabled={otp.trim().length < 4 || busy}
                className={`mt-stack-md ${PRIMARY}`}
              >
                {busy ? 'Checking…' : 'Finish enrolling'}
              </button>
              <button
                onClick={() => void sendCode()}
                disabled={busy}
                className="w-full mt-3 py-3 font-label-md text-label-md text-on-surface-variant underline underline-offset-2"
              >
                Send another code
              </button>
              <Refusal message={refusal} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
