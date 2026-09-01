import { useNavigate } from 'react-router-dom';
import { progressStore, computeStreak } from '../stores/progress';
import { profileStore, hasDiagnostic } from '../stores/profile';
import { settingsStore } from '../stores/settings';
import { doubtLogStore } from '../stores/doubtLog';
import { useStore } from '../stores/localStore';
import { Screen } from '../ui/Screen';
import { Icon } from '../ui/Icon';
import { useAccount } from '../lib/account';
import { cloudConfigured, signOut } from '../lib/supabase';

const ROW =
  'w-full bg-surface-container-lowest rounded-[16px] p-4 flex items-center gap-4 shadow-soft-indigo text-left transition-colors hover:bg-surface-container';

/**
 * Who the student is, and the way into everything about them.
 *
 * It deliberately owns no settings of its own any more. It used to carry its
 * own class switcher and its own reset button, which meant two screens wrote
 * the class — and Profile wrote only half of it, leaving the profile store
 * stale. Settings owns those controls now; this screen points at them.
 */
export function Profile() {
  const navigate = useNavigate();
  const { account } = useAccount();
  const profile = useStore(profileStore);
  const settings = useStore(settingsStore);
  const progress = useStore(progressStore);
  const doubts = useStore(doubtLogStore);

  // Settings is the copy every path has always written; see Settings.tsx.
  const klass = settings.klass ?? profile.klass;
  const completed = Object.values(progress.lessons).filter((l) => l.completedAt).length;
  const streak = computeStreak(progress);

  const stat = (value: number, label: string) => (
    <div className="flex-1 min-w-[92px] bg-surface-container-lowest rounded-[20px] py-4 flex flex-col items-center shadow-soft-indigo">
      <span className="font-headline-lg text-[28px] leading-9 text-primary">{value}</span>
      <span className="font-label-sm text-label-sm text-on-surface-variant text-center">{label}</span>
    </div>
  );

  const row = (icon: string, label: string, hint: string, to: string) => (
    <button onClick={() => navigate(to)} className={ROW}>
      <div className="w-11 h-11 shrink-0 rounded-full bg-primary-fixed grid place-items-center">
        <Icon name={icon} className="text-on-primary-fixed" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-label-md text-label-md text-on-surface">{label}</div>
        <div className="font-body-md text-body-md text-on-surface-variant truncate">{hint}</div>
      </div>
      <Icon name="chevron_right" className="text-on-surface-variant shrink-0" />
    </button>
  );

  return (
    <Screen title="Profile">
      {/* Identity */}
      <div className="flex items-center gap-4 bg-surface-container-lowest rounded-[24px] p-card-padding shadow-soft-indigo mb-stack-md">
        <div className="w-16 h-16 rounded-full bg-primary-fixed grid place-items-center shrink-0">
          <Icon name="person" filled className="text-3xl text-on-primary-fixed" />
        </div>
        <div className="min-w-0">
          <div className="font-headline-md text-[20px] leading-7 text-on-surface truncate">
            {profile.name?.trim() || 'Student'}
          </div>
          <div className="font-label-md text-label-md text-on-surface-variant">
            {klass ? `Class ${klass}` : 'Class not set'}
            {profile.subjects.length > 0 && ` · ${profile.subjects.length} subjects`}
          </div>
          {/* Who they are SIGNED IN as, which is a different fact from who
              they are — and the one a student looks for here when they want
              to know whether their work is being kept. */}
          {account && (
            <div className="font-label-sm text-label-sm text-on-surface-variant truncate mt-0.5">
              {account.label}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3 mb-stack-md">
        {stat(completed, 'lessons done')}
        {stat(streak, 'day streak')}
        {stat(doubts.length, 'questions asked')}
      </div>

      <div className="flex flex-col gap-2">
        {row('back_hand', 'Your questions', 'Every doubt you raised, and where', '/doubts')}
        {row('local_fire_department', 'Streak', 'The days you showed up', '/streak')}
        {row(
          'explore',
          hasDiagnostic(profile) ? 'Retake the placement test' : 'Take the placement test',
          hasDiagnostic(profile)
            ? 'Find out what has changed since last time'
            : 'A few questions, so lessons start where you are',
          '/diagnostic',
        )}
        {row('bookmark', 'Saved lessons', 'The ones you kept for later', '/bookmarks')}
        {row('edit_note', 'My notes', 'What you wrote down, at the moment you wrote it', '/notes')}
        {row('trophy', 'Achievements', 'What you have earned so far', '/achievements')}
        {row('settings', 'Settings', 'Class, subjects, playback, reset', '/settings')}
        {row('help', 'Help', 'How this works, and what to do when it does not', '/help')}

        {/* Signing in and out belongs HERE, next to the identity it changes —
            not buried in Settings, which is where a student looks for the
            class they study, not for who they are. */}
        {cloudConfigured() &&
          (account ? (
            <button
              onClick={() => void signOut()}
              className="flex items-center gap-4 bg-surface-container-lowest rounded-[20px] p-4 text-left hover:scale-[1.01] transition-transform"
            >
              <div className="w-10 h-10 rounded-full bg-surface-variant grid place-items-center shrink-0">
                <Icon name="logout" className="text-on-surface-variant" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-body-md text-body-md text-on-surface">Sign out</div>
                <div className="font-label-md text-label-md text-on-surface-variant truncate">
                  Your work stays on this device either way
                </div>
              </div>
            </button>
          ) : (
            row(
              'cloud_off',
              'Keep your progress',
              'Sign in so your streak and notes reach any device',
              '/signin',
            )
          ))}
      </div>
    </Screen>
  );
}
