import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  achievements,
  chaptersOf,
  hasAnyProgress,
  nearestLocked,
  splitAchievements,
  type Achievement,
  type ChapterLessons,
} from '../lib/achievements';
import { SYLLABI, fetchCatalog } from '../lib/content';
import { formatDay } from '../lib/history';
import { doubtLogStore } from '../stores/doubtLog';
import { useStore } from '../stores/localStore';
import { profileStore } from '../stores/profile';
import { progressStore } from '../stores/progress';
import { quizHistoryStore } from '../stores/quizHistory';
import { Icon } from '../ui/Icon';
import { EmptyState, Screen } from '../ui/Screen';

/**
 * Everything the student has actually done — and, for everything they have not,
 * exactly how far off it is.
 *
 * The screen decides nothing: lib/achievements answers the catalogue and sorts
 * it, and this file draws the answer. A locked card is drawn in full — its own
 * icon, its title, its rule and its real progress — never as a grey mystery,
 * because "3 of 10 questions asked" is the only version of a locked achievement
 * that teaches a student anything.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-stack-md">
      <h2 className="font-label-sm text-label-sm uppercase tracking-wider text-outline mb-stack-sm">
        {title}
      </h2>
      <ul className="flex flex-col gap-3">{children}</ul>
    </section>
  );
}

function Card({ item }: { item: Achievement }) {
  const bar = item.progress;
  // Clamped for the bar only: the numbers in the label stay as they are.
  const percent =
    bar === undefined || bar.target <= 0
      ? 0
      : Math.min(100, Math.round((bar.value / bar.target) * 100));

  return (
    <li
      className={`rounded-[24px] p-card-padding flex gap-4 ${
        item.earned
          ? 'bg-surface-container-lowest shadow-soft-indigo'
          : 'bg-surface-container-low border-2 border-surface-variant'
      }`}
    >
      <div
        className={`w-12 h-12 shrink-0 rounded-full grid place-items-center ${
          item.earned ? 'bg-primary-fixed' : 'bg-surface-container-highest'
        }`}
      >
        <Icon
          name={item.icon}
          filled={item.earned}
          className={`text-[26px] ${item.earned ? 'text-on-primary-fixed' : 'text-outline'}`}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 font-headline-md text-[18px] leading-6 text-on-surface">
            {item.title}
          </h3>
          {/* Decorative: the section heading and the progress line already say
              which of the two states this card is in. */}
          <Icon
            name={item.earned ? 'check_circle' : 'lock'}
            filled={item.earned}
            className={`shrink-0 ${item.earned ? 'text-primary' : 'text-outline'}`}
          />
        </div>

        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{item.body}</p>

        {item.earned && item.earnedOn !== undefined && (
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-2">
            Earned {formatDay(item.earnedOn)}
          </p>
        )}

        {bar !== undefined && (
          <div className="mt-3">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={bar.target}
              aria-valuenow={Math.min(bar.value, bar.target)}
              aria-valuetext={bar.label}
              className="h-2 rounded-full bg-surface-variant overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-primary-fixed-dim"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant mt-2">{bar.label}</p>
          </div>
        )}
      </div>
    </li>
  );
}

export function Achievements() {
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const doubts = useStore(doubtLogStore);
  const quizzes = useStore(quizHistoryStore);
  const profile = useStore(profileStore);
  const [chapters, setChapters] = useState<ChapterLessons[]>([]);

  useEffect(() => {
    let live = true;
    fetchCatalog()
      .then((catalog) => {
        if (live) setChapters(chaptersOf(SYLLABI, catalog));
      })
      // A catalogue that will not load simply leaves the chapter achievement
      // out; every other one is answered from local data and stands regardless.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const list = achievements({ progress, doubts, quizzes, profile, chapters }, new Date());
  const { earned, locked } = splitAchievements(list);

  if (!hasAnyProgress(list)) {
    const next = nearestLocked(list);
    return (
      <Screen title="Achievements" onBack={() => navigate(-1)}>
        <EmptyState
          icon="verified"
          title="Nothing earned yet"
          body={
            next === null
              ? 'Everything here comes from lessons you finish and questions you ask.'
              : `The nearest one is "${next.title}" — ${next.body}`
          }
          action={
            <button
              onClick={() => navigate('/')}
              className="mt-2 bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
            >
              Start a class
            </button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen title="Achievements" onBack={() => navigate(-1)}>
      <div className="bg-surface-container-lowest rounded-[24px] p-card-padding shadow-soft-indigo mb-stack-md flex items-center gap-4">
        <Icon name="verified" filled className="text-[40px] text-primary shrink-0" />
        <div className="min-w-0">
          <div className="font-headline-lg text-[28px] leading-9 text-on-surface">
            {earned.length} of {list.length} earned
          </div>
          <p className="font-label-md text-label-md text-on-surface-variant">
            Each one is something you did, counted from your own lessons and questions.
          </p>
        </div>
      </div>

      {earned.length > 0 && (
        <Section title="Earned">
          {earned.map((item) => (
            <Card key={item.id} item={item} />
          ))}
        </Section>
      )}

      {locked.length > 0 && (
        <Section title="Not yet">
          {locked.map((item) => (
            <Card key={item.id} item={item} />
          ))}
        </Section>
      )}
    </Screen>
  );
}
