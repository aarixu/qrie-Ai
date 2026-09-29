import { useState } from 'react';
import { track } from '../lib/telemetry';
import { useNavigate } from 'react-router-dom';
import { settingsStore } from '../stores/settings';
import { profileStore } from '../stores/profile';
import { subjectsAvailable } from '../lib/content';
import { capName, MAX_NAME_CHARS } from '../lib/student';
import { loadDiagnosticData } from '../lib/diagnosticData';
import { Icon } from '../ui/Icon';
import {
  DEFAULT_SCHEDULE,
  WEEKDAY_NAMES,
  formatMinute,
  type Weekday,
} from '../lib/studySchedule';
import { setRemindersEnabled, setStudyDays, setStudyMinute } from '../stores/schedule';
import { askForNotifications } from '../lib/reminders';
import { TutorTile } from '../ui/TutorTile';
import { writeWorkspace, type EntryPath, type TutorLanguage } from '../lib/workspace';
import { INTERESTS, setInterests } from '../lib/studentMemory';

const CLASSES = [6, 7, 8, 9, 10, 11, 12];

/**
 * THE FORK IS THE FIRST QUESTION, because everything after it differs.
 *
 * A self-serve student answers these questions. A school student will pick
 * themselves off a roster their school uploaded, and inherits their class,
 * their subjects and their consent from it — a different flow end to end.
 * That branch is MVP-2: the fork is here and visible so nothing has to be
 * renamed when it lands, and the school arm is a named stub rather than a
 * half-built roster.
 */
export const ONBOARDING_STEPS = [
  'door',
  'name',
  'class',
  'subjects',
  'language',
  'interests',
  'when',
  'ready',
] as const;
type Step = (typeof ONBOARDING_STEPS)[number];
const STEPS = ONBOARDING_STEPS;

/**
 * WHICH LANGUAGE THE CLASS IS TAUGHT IN — never which language the app is.
 *
 * The app chrome is English for every student. This asks about the TUTOR's
 * voice, and the wording has to carry that difference on its own, because a
 * student who reads it as an app-language switch will pick Hinglish and then
 * wonder why the buttons did not change.
 */
export const LANGUAGE_QUESTION = 'Which language should your class be taught in?';

/**
 * THE HALF OF THE LANGUAGE ANSWER A CHILD ACTS ON.
 *
 * The picker shows a Hinglish class and says nothing about the microphone, so
 * a student who chooses Hinglish has been shown 'Chalo, heart ko dekhte hain.'
 * and is left to guess whether answering that way will be marked wrong.
 *
 * It will not, and this is checked rather than assumed: matchSpokenAnswer
 * takes no language argument (packages/tutor-judge/src/match.ts:124), but its
 * POSITION table carries pehla/doosra/teesra (match.ts:110-115) and its stated
 * contract is to return index: null whenever it is not confident so the caller
 * escalates to the model. A Hinglish answer therefore fails safe — escalated,
 * not marked wrong. That is what this sentence promises and no more.
 *
 * It is deliberately still about the MICROPHONE only. Which language the tutor
 * SPEAKS is now honoured for a class prepared live — lib/liveClass.ts reads
 * the choice — and that promise is made by LANGUAGE_PROMISE_NOTE below, where
 * the committed-lessons caveat is made in the same breath. Folding the two
 * into one sentence would make a promise with its exception missing.
 *
 * Exported because both doors ask this question and neither may drift from the
 * other's promise.
 */
export const LANGUAGE_ANSWER_NOTE = 'You can answer in either one — I will understand.';

/**
 * WHAT IS TRUE TODAY, SAID TO A CHILD IN THE PRESENT TENSE ONLY WHERE IT IS
 * TRUE — and the tenses are load-bearing, not tidiness.
 *
 * "I teach in" is present because the answer is now READ: lib/liveClass.ts
 * reads tutorLanguage() per preparation and hands it to prepareClass, which
 * puts the register in the planner's prompt (HINGLISH_REGISTER) and writes it
 * onto the finished lesson.
 *
 * LANGUAGE, NEVER VOICE. Nothing here picks the speaker: lib/lessonVoice.ts:48
 * fixes the streaming voice, lines 79 and 155 ask the browser for 'en-IN', and
 * the relay's own docblock says choosing among its Hindi speakers is a
 * decision with a student in front of it and not a query parameter
 * (packages/relay/src/relays.ts:177-181). A child reads "voice" as what they
 * HEAR, so this promises the words and nothing about the sound.
 *
 * "The classes that are already written are in English" is the other half, and
 * a child is told it HERE rather than left to find it out in a class. All
 * fifteen committed lessons carry language: "en" (each content folder's
 * lesson.json) and nothing translates them at runtime: that would be a fresh
 * model call on a class already measured at Rs 9.08 of preparation spend
 * (docs/architecture/README.md:182), and the new narration would need
 * fact-reviewing all over again in the new language.
 *
 * THE ALTERNATIVE, and why it is not taken: prefer a live preparation for a
 * Hinglish student on a topic that already has an English lesson. That is the
 * planning constant every PRD budgets on — about Rs 30 a topic — spent again
 * per student rather than once, and a spend of that size is a decision
 * somebody makes, never a default a screen turns on quietly.
 *
 * NARROWER THAN IT READS, and this is the honest gap: "a class I make for you
 * while you wait" is true of a topic nobody has reached before. screens/
 * LiveClass.tsx keeps every live preparation under a unique topic_ref, so a
 * topic another student prepared minutes ago is a kept class — and it is
 * always an ENGLISH one, because save.ts refuses to keep anything else. So the
 * surprise is narrower than it first looked and it only runs one way: a
 * Hinglish student can meet an English class that somebody else's preparation
 * installed. An English student can never meet a Hinglish one.
 *
 * Exported for the same reason LANGUAGE_QUESTION is: both doors ask this
 * question and neither may drift from the other's promise —
 * screens/contest/Enrol.tsx renders this same constant rather than a copy.
 */
export const LANGUAGE_PROMISE_NOTE =
  'This is the language I teach in. When I make a class for you while you wait, it comes ' +
  'out in the language you pick here. The classes that are already written are in English, ' +
  'so those stay English — and the buttons and menus are English either way.';

/** The way back out of the school stub, kept here so the test can read it. */
export const SCHOOL_STUB_BACK = 'Go back';

/**
 * First run: which door, name, class, subjects, the tutor's language, then
 * into the placement test.
 *
 * One question per screen — a single form asking everything at once looks
 * shorter and feels longer, and a student who abandons a stepped flow has
 * already banked their name and class. Her tile above the first question is
 * the whole introduction: who is asking, without a screen spent on it.
 *
 * The subjects offered come from the syllabi that actually exist for that
 * class — never from a wishlist. A subject chip with nothing behind it is a
 * promise the first tap breaks.
 */
export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('door');
  /** Which door they said they came through. Written at the end, not here. */
  const [entry, setEntry] = useState<EntryPath>('self_serve');
  const [tutorLanguage, setTutorLanguageChoice] = useState<TutorLanguage>('en');
  /** The school arm, shown as what it is: not built yet. */
  const [showSchoolStub, setShowSchoolStub] = useState(false);
  const [days, setDays] = useState<Weekday[]>([...DEFAULT_SCHEDULE.days]);
  const [minute, setMinute] = useState(DEFAULT_SCHEDULE.minute);
  const [name, setName] = useState('');
  const [klass, setKlass] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  /** What they enjoy, from a fixed list — kept on this device for her examples (lib/studentMemory.ts). */
  const [interests, setInterestChoice] = useState<string[]>([]);

  const index = STEPS.indexOf(step);
  const available = klass !== null ? subjectsAvailable(klass) : [];
  // The placement test exists class by class; only offer what can be taken.
  const hasPlacement = klass !== null && loadDiagnosticData(klass) !== null;

  const toggleSubject = (subject: string) =>
    setSubjects((current) =>
      current.includes(subject) ? current.filter((s) => s !== subject) : [...current, subject],
    );

  const chooseClass = (next: number) => {
    setKlass(next);
    // Subjects are per class, so a class change cannot keep the old selection.
    // Default to everything: opting out is easier than opting in.
    setSubjects(subjectsAvailable(next));
    setStep('subjects');
  };

  const finish = (toDiagnostic: boolean) => {
    if (klass === null) return;
    profileStore.update((p) => ({ ...p, name: capName(name), klass, subjects }));
    /**
     * The workspace, written into the same profile row — the one shape this
     * door and the contest door both leave behind. `consent` is deliberately
     * untouched: nobody has verified a parent on this path, and writing a
     * consent mark here would be the app claiming an agreement that does not
     * exist in consent_record.
     */
    writeWorkspace({ entry, tutorLanguage });
    // settingsStore still drives screens that predate the profile store; both
    // are written so neither can go stale.
    settingsStore.update((s) => ({ ...s, klass }));
    // The number of subjects, not which — and never the name they just typed.
    track('onboarding_completed', {
      klass,
      subjects: subjects.length,
      tookPlacement: toDiagnostic,
    });
    navigate(toDiagnostic ? '/diagnostic' : '/', { replace: true });
  };

  /** The one primary-action recipe, verbatim from the rest of the app. */
  const PRIMARY =
    'w-full bg-primary text-on-primary font-label-md text-label-md px-6 py-4 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all disabled:opacity-40 disabled:active:translate-y-0';

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md flex flex-col">
      {/* Progress + back */}
      <header className="flex items-center gap-3 px-margin-mobile pt-6 pb-2 w-full max-w-[520px] mx-auto">
        <button
          onClick={() => setStep(STEPS[Math.max(0, index - 1)])}
          disabled={index === 0}
          aria-label="Back"
          className="w-10 h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-0"
        >
          <Icon name="arrow_back" />
        </button>
        <div className="flex-1 flex gap-1.5">
          {STEPS.map((s, i) => (
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
          {step === 'door' &&
            (showSchoolStub ? (
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary-fixed grid place-items-center mx-auto mb-5">
                  <Icon name="school" filled className="text-[38px] text-on-primary-fixed" />
                </div>
                <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                  Your school's classes are not here yet
                </h1>
                <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                  {/* Named as a stub rather than dressed up: a roster your
                      school uploads, which you pick yourself off, is being
                      built. Telling a student that is kinder than a sign-in
                      that never works. */}
                  When your school is set up, you will find your own name on your class list
                  and everything will already be filled in. Until then you can carry on here
                  on your own, and your school can be joined later.
                </p>
                <button
                  onClick={() => {
                    setEntry('self_serve');
                    setShowSchoolStub(false);
                    setStep('name');
                  }}
                  className={PRIMARY}
                >
                  Carry on by myself
                </button>
                {/* THE STUB WAS A ONE-WAY DOOR. The header Back button is
                    disabled at index 0, so a mis-tap on the second card had
                    exactly one exit — and that exit also rewrote `entry` to
                    'self_serve', losing the fact that they came from a school
                    for a student who never meant to say so. This one leaves
                    `entry` where it was. */}
                <button
                  onClick={() => setShowSchoolStub(false)}
                  className="w-full mt-3 py-3 font-label-md text-label-md text-on-surface-variant underline underline-offset-2"
                >
                  {SCHOOL_STUB_BACK}
                </button>
              </div>
            ) : (
              <div className="text-center">
                <div className="grid place-items-center mb-5">
                  <TutorTile mode="teaching" variant="pip" />
                </div>
                <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                  How did you get here?
                </h1>
                <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                  This only decides which questions I ask you next.
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => {
                      setEntry('self_serve');
                      setStep('name');
                    }}
                    className="rounded-[20px] p-5 shadow-sm border-2 border-transparent bg-surface-container-lowest hover:border-primary-fixed-dim transition-all flex items-center gap-4 text-left"
                  >
                    <Icon name="person" className="text-[28px] text-primary shrink-0" />
                    <span>
                      <span className="block font-label-md text-label-md text-on-surface">
                        I'm here on my own
                      </span>
                      <span className="block font-label-md text-label-md text-on-surface-variant">
                        I'll answer a few questions about what I study.
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setEntry('school');
                      setShowSchoolStub(true);
                    }}
                    className="rounded-[20px] p-5 shadow-sm border-2 border-transparent bg-surface-container-lowest hover:border-primary-fixed-dim transition-all flex items-center gap-4 text-left"
                  >
                    <Icon name="school" className="text-[28px] text-primary shrink-0" />
                    <span>
                      <span className="block font-label-md text-label-md text-on-surface">
                        My school set this up
                      </span>
                      <span className="block font-label-md text-label-md text-on-surface-variant">
                        I'll find myself on my class list.
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            ))}

          {step === 'name' && (
            <div className="text-center">
              <div className="grid place-items-center mb-5">
                <TutorTile mode="teaching" variant="pip" />
              </div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                What should I call you?
              </h1>
              {/* The class planner is not told the name (lib/student.ts), so
                  this no longer promises to use it in class. */}
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                Just your first name is enough.
              </p>
              {/* Capped in the handler as well as by maxLength, which stops
                  typing but not a value set by paste or autofill. */}
              <input
                value={name}
                maxLength={MAX_NAME_CHARS}
                onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_CHARS))}
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && setStep('class')}
                placeholder="Your first name"
                aria-label="Your first name"
                autoFocus
                className="w-full min-h-[56px] px-5 rounded-2xl border-2 border-surface-variant bg-surface-container-lowest text-center font-headline-md text-[20px] text-on-surface outline-none focus:border-primary transition-colors"
              />
              <button
                onClick={() => setStep('class')}
                disabled={name.trim().length === 0}
                className={`mt-stack-md ${PRIMARY}`}
              >
                Continue
              </button>
            </div>
          )}

          {step === 'class' && (
            <div className="text-center">
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                Which class are you in{name.trim() ? `, ${name.trim()}` : ''}?
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                Your classes will match your level. You can change this later.
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
                What are you studying?
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md text-center">
                {available.length === 0
                  ? `Class ${klass} material is still being written — you can look around meanwhile.`
                  : available.length > 1
                    ? 'Pick at least one. More subjects are on their way.'
                    : 'More subjects are on their way.'}
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
                          : 'bg-surface-container-lowest border-surface-variant text-on-surface-variant hover:bg-surface-container'
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
                // A class with no authored subjects yet must still get through —
                // an empty selection is only a refusal when there was a choice.
                disabled={subjects.length === 0 && available.length > 0}
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
                {/* The paragraph and the reasoning behind every clause of it
                    live on LANGUAGE_PROMISE_NOTE above, where the contest door
                    can import them instead of keeping a second copy that says
                    something else. */}
                {LANGUAGE_PROMISE_NOTE} {LANGUAGE_ANSWER_NOTE}
              </p>
              <div className="flex flex-col gap-3">
                {(
                  [
                    { value: 'en', title: 'English', said: '"Let us look at the heart."' },
                    {
                      value: 'hi-en',
                      title: 'Hinglish',
                      said: '"Chalo, heart ko dekhte hain."',
                    },
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
              {/* No "you can change this later" line: there is no setting for
                  it yet, and a promise the app cannot keep is worse than a
                  question asked once. */}
              <button onClick={() => setStep('interests')} className={`mt-stack-lg ${PRIMARY}`}>
                Continue
              </button>
            </div>
          )}

          {/* WHAT THEY ENJOY (2026-09-29). A tutor who knows a student loves
              cricket explains averages with run rates. A fixed list, never
              free text, kept on this device only; skipping is a real answer. */}
          {step === 'interests' && (
            <div className="text-center">
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                What do you enjoy{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ''}?
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                Pick any. Meera uses them to choose examples for you. They are kept on this phone, and sent with your questions to the AI that runs Meera (Google's), only for that.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {INTERESTS.map((it) => {
                  const on = interests.includes(it.id);
                  return (
                    <button
                      key={it.id}
                      aria-pressed={on}
                      onClick={() =>
                        setInterestChoice((prev) => (on ? prev.filter((x) => x !== it.id) : [...prev, it.id]))
                      }
                      className={`min-h-[44px] rounded-full px-4 py-2 border-2 font-label-md text-label-md transition-all ${
                        on
                          ? 'bg-primary-fixed border-primary text-on-surface'
                          : 'bg-surface-container-lowest border-transparent text-on-surface hover:border-primary-fixed-dim'
                      }`}
                    >
                      <span aria-hidden>{it.emoji}</span> {it.label}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  setInterests(interests);
                  setStep('when');
                }}
                className={`mt-stack-lg ${PRIMARY}`}
              >
                {interests.length > 0 ? 'Continue' : 'Skip for now'}
              </button>
            </div>
          )}

          {step === 'when' && (
            <div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2 text-center">
                When do you study?
              </h1>
              {/* Asked here rather than buried in settings, because a reminder
                  nobody set up is a retention design that does not run. The
                  wording is a plan they are making, not a permission we want. */}
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md text-center">
                We will remind you then. Change it any time, or turn it off.
              </p>

              <div className="flex flex-wrap gap-2 justify-center mb-stack-md">
                {WEEKDAY_NAMES.map((label, day) => {
                  const on = days.includes(day as Weekday);
                  return (
                    <button
                      key={label}
                      onClick={() =>
                        setDays(
                          on
                            ? days.filter((d) => d !== day)
                            : [...days, day as Weekday].sort((a, b) => a - b),
                        )
                      }
                      aria-pressed={on}
                      className={`w-12 h-12 rounded-full border-2 font-label-md text-label-md transition-colors ${
                        on
                          ? 'bg-primary-fixed border-primary text-on-primary-fixed-variant'
                          : 'bg-surface-container-lowest border-surface-variant text-on-surface-variant'
                      }`}
                    >
                      {label[0]}
                    </button>
                  );
                })}
              </div>

              <label className="flex flex-col items-center gap-2 mb-stack-lg">
                <span className="font-label-md text-label-md text-on-surface-variant">
                  At {formatMinute(minute)}
                </span>
                <input
                  type="range"
                  min={6 * 60}
                  max={22 * 60}
                  step={30}
                  value={minute}
                  onChange={(e) => setMinute(Number(e.target.value))}
                  aria-label="What time you study"
                  className="w-full max-w-[280px] accent-primary"
                />
              </label>

              <button
                onClick={() => {
                  setStudyDays(days);
                  setStudyMinute(minute);
                  setRemindersEnabled(days.length > 0);
                  // Asked HERE, where the reason is on screen. A notification
                  // prompt on first open is the fastest way to be denied
                  // forever, and an iOS denial is painful to undo.
                  if (days.length > 0) void askForNotifications();
                  setStep('ready');
                }}
                className={PRIMARY}
              >
                {days.length > 0 ? 'Remind me then' : 'No reminders for now'}
              </button>
            </div>
          )}

          {step === 'ready' &&
            (hasPlacement ? (
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary-fixed grid place-items-center mx-auto mb-5">
                  <Icon name="explore" filled className="text-[38px] text-on-primary-fixed" />
                </div>
                <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                  Let's find your level
                </h1>
                <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                  20 quick questions on what you've studied before — no marks, nothing to
                  revise. I use them to work out what to teach you first, and what to skip.
                </p>
                <button onClick={() => finish(true)} className={PRIMARY}>
                  Start the placement test
                </button>
                <button
                  onClick={() => finish(false)}
                  className="w-full mt-3 py-3 font-label-md text-label-md text-on-surface-variant underline underline-offset-2"
                >
                  Skip for now
                </button>
              </div>
            ) : (
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary-fixed grid place-items-center mx-auto mb-5">
                  <Icon name="celebration" filled className="text-[38px] text-on-primary-fixed" />
                </div>
                <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                  You're all set{name.trim() ? `, ${name.trim()}` : ''}!
                </h1>
                <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                  Your placement test for Class {klass} is still being written — you can start
                  learning right away, and I'll ask you those questions once they're ready.
                </p>
                <button onClick={() => finish(false)} className={PRIMARY}>
                  Start learning
                </button>
              </div>
            ))}
        </div>
      </main>
    </div>
  );
}
