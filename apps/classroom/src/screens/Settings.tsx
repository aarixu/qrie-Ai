import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND } from '../brand';
import { version } from '../../package.json';
import { settingsStore } from '../stores/settings';
import { profileStore } from '../stores/profile';
import { subjectsAvailable } from '../lib/content';
import { preferencesStore, setPreference, type Preferences } from '../stores/preferences';
import { progressStore } from '../stores/progress';
import { doubtLogStore } from '../stores/doubtLog';
import { useStore } from '../stores/localStore';
import { Screen } from '../ui/Screen';
import { Icon } from '../ui/Icon';

const CLASSES = [6, 7, 8, 9, 10, 11, 12];

const ROW =
  'w-full bg-surface-container-lowest rounded-[16px] p-4 flex items-center gap-4 shadow-soft-indigo';

/** The boolean preference keys — the ones a Switch can carry. */
type BooleanPreference = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

/** The playback switches, as data — one row shape, so they cannot drift apart. */
const PLAYBACK: { key: BooleanPreference; icon: string; label: string; hint: string }[] = [
  {
    key: 'voice',
    icon: 'record_voice_over',
    label: 'Tutor speaks aloud',
    hint: 'Hear the lesson read out, the way it was taught.',
  },
  {
    key: 'captions',
    icon: 'closed_caption',
    label: 'Captions',
    hint: 'Show what the tutor is saying as text.',
  },
  {
    key: 'autoplayNext',
    icon: 'skip_next',
    label: 'Autoplay next lesson',
    hint: 'Carry straight on when a lesson finishes.',
  },
  {
    key: 'reducedMotion',
    icon: 'motion_photos_off',
    label: 'Reduce motion',
    hint: 'Keep animations to a minimum, even if your device does not ask for it.',
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-stack-md">
      <h2 className="font-label-sm text-label-sm uppercase tracking-wider text-outline mb-stack-sm">
        {title}
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/**
 * There is no Switch in the design system yet, so this is the smallest honest
 * one: a real button carrying the switch role, labelled by the row's own text
 * so a screen reader announces "Captions, on" rather than "button".
 */
function Switch({
  labelId,
  checked,
  onChange,
}: {
  labelId: string;
  checked: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      onClick={() => onChange(!checked)}
      className={`w-[52px] h-8 shrink-0 rounded-full p-1 flex transition-colors ${
        checked ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start'
      }`}
    >
      <span className="w-6 h-6 rounded-full bg-surface-container-lowest shadow-sm" />
    </button>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const settings = useStore(settingsStore);
  const profile = useStore(profileStore);
  const preferences = useStore(preferencesStore);
  const [pickingClass, setPickingClass] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Both stores hold the class. Settings wins when they disagree because every
  // path that has ever set a class writes it (onboarding, Profile, this
  // screen), while the profile copy is only written by the newer ones — so it
  // is the one that can be stale, never the other way round.
  const klass = settings.klass ?? profile.klass;
  const available = klass !== null ? subjectsAvailable(klass) : [];

  const chooseClass = (next: number) => {
    // Subjects are listed per class, so a class change cannot keep a selection
    // made against the old list — default to everything, as onboarding does.
    profileStore.update((p) => ({ ...p, klass: next, subjects: subjectsAvailable(next) }));
    // Written to BOTH stores: a class in one and not the other would silently
    // give the student one class of lessons and another class of placement test.
    settingsStore.update((s) => ({ ...s, klass: next }));
    setPickingClass(false);
  };

  const toggleSubject = (subject: string) =>
    profileStore.update((p) => ({
      ...p,
      subjects: p.subjects.includes(subject)
        ? p.subjects.filter((s) => s !== subject)
        : [...p.subjects, subject],
    }));

  const resetProgress = () => {
    progressStore.set({ lessons: {}, lastLessonId: null });
    doubtLogStore.set([]);
    setConfirmingReset(false);
  };

  return (
    <Screen title="Settings" onBack={() => navigate('/profile')}>
      <Section title="Learning">
        <button
          onClick={() => setPickingClass((open) => !open)}
          aria-expanded={pickingClass}
          className={`${ROW} text-left hover:scale-[1.01] transition-transform`}
        >
          <Icon name="school" className="text-primary" />
          <span className="flex-1 font-body-md text-body-md text-on-surface">Class</span>
          <span className="font-label-md text-label-md text-on-surface-variant">
            {klass !== null ? `Class ${klass}` : 'Not set'}
          </span>
          <Icon
            name={pickingClass ? 'expand_less' : 'expand_more'}
            className="text-outline-variant"
          />
        </button>

        {pickingClass && (
          <div className="bg-surface-container-lowest rounded-[16px] p-4 shadow-soft-indigo grid grid-cols-3 sm:grid-cols-4 gap-3">
            {CLASSES.map((k) => (
              <button
                key={k}
                onClick={() => chooseClass(k)}
                aria-pressed={klass === k}
                className={`rounded-[20px] py-4 border-2 shadow-sm transition-all flex flex-col items-center hover:scale-[1.03] ${
                  klass === k
                    ? 'bg-primary-fixed border-primary'
                    : 'bg-surface-container-lowest border-transparent hover:border-primary-fixed-dim'
                }`}
              >
                <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">
                  Class
                </span>
                <span className="font-headline-lg text-[26px] leading-8 text-primary">{k}</span>
              </button>
            ))}
          </div>
        )}

        <div className="bg-surface-container-lowest rounded-[16px] p-4 shadow-soft-indigo">
          <div className="flex items-center gap-4 mb-stack-sm">
            <Icon name="book" className="text-primary" />
            <span className="flex-1 font-body-md text-body-md text-on-surface">Subjects</span>
          </div>
          {available.length === 0 ? (
            <p className="font-label-md text-label-md text-on-surface-variant">
              Pick your class first — subjects are listed per class.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {available.map((subject) => {
                  const on = profile.subjects.includes(subject);
                  return (
                    <button
                      key={subject}
                      onClick={() => toggleSubject(subject)}
                      aria-pressed={on}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full border-2 font-label-md text-label-md transition-colors ${
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
              {profile.subjects.length === 0 && (
                <p className="mt-stack-sm font-label-md text-label-md text-on-surface-variant">
                  Pick at least one, or your study plan has nothing to cover.
                </p>
              )}
            </>
          )}
        </div>
      </Section>

      <Section title="Appearance">
        {/* The segmented control needs the full width on a phone, so this row
            stacks rather than squeezing the hint into a column of one word. */}
        <div className={`${ROW} flex-col items-stretch gap-3`}>
          <div className="flex items-center gap-4">
            <Icon name="contrast" className="text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-body-md text-body-md text-on-surface">Theme</div>
              <div className="font-label-md text-label-md text-on-surface-variant">
                System follows your phone's setting.
              </div>
            </div>
          </div>
          <div
            className="flex gap-1 bg-surface-container rounded-full p-1"
            role="radiogroup"
            aria-label="Theme"
          >
            {(['light', 'system', 'dark'] as const).map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={preferences.theme === option}
                onClick={() => setPreference('theme', option)}
                className={`flex-1 px-3 py-2 rounded-full font-label-md text-label-md font-semibold capitalize transition-colors ${
                  preferences.theme === option
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Playback">
        {PLAYBACK.map((row) => {
          const labelId = `pref-${row.key}`;
          return (
            <div key={row.key} className={ROW}>
              <Icon name={row.icon} className="text-primary" />
              <div className="min-w-0 flex-1">
                <div id={labelId} className="font-body-md text-body-md text-on-surface">
                  {row.label}
                </div>
                <div className="font-label-md text-label-md text-on-surface-variant">{row.hint}</div>
              </div>
              <Switch
                labelId={labelId}
                checked={preferences[row.key]}
                onChange={(next) => setPreference(row.key, next)}
              />
            </div>
          );
        })}
      </Section>

      <Section title="About">
        <button
          onClick={() => navigate('/help')}
          className={`${ROW} text-left hover:scale-[1.01] transition-transform`}
        >
          <Icon name="help" className="text-primary" />
          <span className="flex-1 font-body-md text-body-md text-on-surface">
            How this works, and common questions
          </span>
          <Icon name="chevron_right" className="text-outline-variant" />
        </button>
        <p className="px-4 font-label-md text-label-md text-on-surface-variant">
          {BRAND.name} · version {version}
        </p>
      </Section>

      <Section title="Danger zone">
        {confirmingReset ? (
          <div className="bg-error-container rounded-[16px] p-4 flex flex-col gap-3">
            <p className="font-body-md text-body-md text-on-error-container">
              Reset progress? Finished lessons, your streak and every doubt you have asked go back
              to zero. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={resetProgress}
                className="flex-1 bg-error text-on-error font-label-md text-label-md px-5 py-3 rounded-xl border-b-4 border-on-error-container active:border-b-0 active:translate-y-1 transition-all"
              >
                Yes, reset
              </button>
              <button
                onClick={() => setConfirmingReset(false)}
                className="flex-1 bg-surface-container-lowest text-on-surface-variant font-label-md text-label-md px-5 py-3 rounded-xl border-2 border-surface-variant hover:bg-surface-container transition-colors"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingReset(true)}
            className={`${ROW} text-left hover:scale-[1.01] transition-transform`}
          >
            <Icon name="restart_alt" className="text-error" />
            <div className="min-w-0 flex-1">
              <div className="font-body-md text-body-md text-error">Reset progress</div>
              <div className="font-label-md text-label-md text-on-surface-variant">
                Your class and subjects stay; the lessons you have finished do not.
              </div>
            </div>
          </button>
        )}
      </Section>
    </Screen>
  );
}
