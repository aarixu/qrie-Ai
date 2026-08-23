import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { settingsStore } from '../stores/settings';
import { profileStore, SUBJECTS_BY_CLASS } from '../stores/profile';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { BRAND } from '../brand';

const CLASSES = [6, 7, 8, 9, 10, 11, 12];
const STEPS = ['name', 'class', 'subjects', 'ready'] as const;
type Step = (typeof STEPS)[number];

/**
 * First run: name, class, subjects, then into the placement test.
 *
 * One question per screen. A single form asking all three at once looks
 * shorter and feels longer — and a student who abandons it halfway leaves us
 * nothing, where a stepped flow has already banked their name and class.
 */
export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [klass, setKlass] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);

  const index = STEPS.indexOf(step);
  const available = klass !== null ? (SUBJECTS_BY_CLASS[klass] ?? []) : [];

  const toggleSubject = (subject: string) =>
    setSubjects((current) =>
      current.includes(subject) ? current.filter((s) => s !== subject) : [...current, subject],
    );

  const chooseClass = (next: number) => {
    setKlass(next);
    // Subjects are per class, so a class change cannot keep the old selection.
    // Default to everything: opting out is easier than opting in.
    setSubjects(SUBJECTS_BY_CLASS[next] ?? []);
    setStep('subjects');
  };

  const finish = (toDiagnostic: boolean) => {
    if (klass === null) return;
    profileStore.update((p) => ({ ...p, name: name.trim(), klass, subjects }));
    // settingsStore still drives screens that predate the profile store; both
    // are written so neither can go stale.
    settingsStore.update((s) => ({ ...s, klass }));
    navigate(toDiagnostic ? '/diagnostic' : '/', { replace: true });
  };

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
          {step === 'name' && (
            <div className="text-center">
              <div className="grid place-items-center mb-5">
                <Logo size={64} />
              </div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                What should I call you?
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                Your tutor will use this in class.
              </p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && setStep('class')}
                placeholder="Your first name"
                aria-label="Your first name"
                autoFocus
                className="w-full min-h-[56px] px-5 rounded-2xl border-2 border-surface-variant bg-surface-container-lowest text-center font-headline-md text-[20px] text-on-surface outline-none focus:border-primary transition-colors"
              />
              <button
                onClick={() => setStep('class')}
                disabled={name.trim().length === 0}
                className="w-full mt-stack-md bg-primary text-on-primary font-label-md text-label-md px-6 py-4 rounded-xl border-b-4 border-[#323499] active:border-b-0 active:translate-y-1 transition-all disabled:opacity-40 disabled:active:translate-y-0"
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
                Your lessons will match your level. You can change this later.
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
                Pick at least one. You can add more later.
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
                onClick={() => setStep('ready')}
                disabled={subjects.length === 0}
                className="w-full mt-stack-lg bg-primary text-on-primary font-label-md text-label-md px-6 py-4 rounded-xl border-b-4 border-[#323499] active:border-b-0 active:translate-y-1 transition-all disabled:opacity-40 disabled:active:translate-y-0"
              >
                Continue
              </button>
            </div>
          )}

          {step === 'ready' && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-primary-fixed grid place-items-center mx-auto mb-5">
                <Icon name="explore" filled className="text-[38px] text-on-primary-fixed" />
              </div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                Let's find where you are
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
                A few quick questions — no marks, nothing to revise. {BRAND.name} uses them to
                work out what to teach you first, and what to skip.
              </p>
              <button
                onClick={() => finish(true)}
                className="w-full bg-primary text-on-primary font-label-md text-label-md px-6 py-4 rounded-xl border-b-4 border-[#323499] active:border-b-0 active:translate-y-1 transition-all"
              >
                Start
              </button>
              <button
                onClick={() => finish(false)}
                className="w-full mt-3 py-3 font-label-md text-label-md text-on-surface-variant underline underline-offset-2"
              >
                Skip for now
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
