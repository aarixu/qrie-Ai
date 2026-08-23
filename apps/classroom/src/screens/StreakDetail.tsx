import { useNavigate } from 'react-router-dom';
import {
  CALENDAR_DAYS,
  activityCalendar,
  formatDay,
  streakBounds,
  type ActivityDay,
  type DayActivity,
} from '../lib/history';
import { doubtLogStore } from '../stores/doubtLog';
import { useStore } from '../stores/localStore';
import { progressStore } from '../stores/progress';
import { EmptyState, Screen } from '../ui/Screen';
import { Icon } from '../ui/Icon';

/**
 * The streak, in full: the number, its record, and the twelve weeks behind it.
 *
 * The grid tints days from the two signals the app collects — a lesson
 * finished, or a question asked. There are no freezes, no rewards and no
 * leagues in this product, so none appear here; the honest version of a streak
 * screen is a calendar and a sentence explaining the rule.
 */

/** An intensity ramp in one hue: quiet day, a question, a finished lesson. */
const TINT: Record<DayActivity, string> = {
  none: 'bg-surface-variant',
  doubts: 'bg-primary-fixed-dim',
  lesson: 'bg-primary',
};

const LEGEND: { activity: DayActivity; label: string }[] = [
  { activity: 'none', label: 'Nothing yet' },
  { activity: 'doubts', label: 'Asked a question' },
  { activity: 'lesson', label: 'Finished a lesson' },
];

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/** What a screen reader (and a hovering mouse) gets for one square. */
const titleOf = (day: ActivityDay): string => {
  const done: string[] = [];
  if (day.lessons > 0) done.push(`${plural(day.lessons, 'lesson', 'lessons')} finished`);
  if (day.doubts > 0) done.push(`${plural(day.doubts, 'question', 'questions')} asked`);
  return `${formatDay(day.day)} — ${done.length > 0 ? done.join(', ') : 'nothing'}`;
};

export function StreakDetail() {
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const doubts = useStore(doubtLogStore);

  const today = new Date();
  const bounds = streakBounds(progress, today);
  const calendar = activityCalendar(progress, doubts, { today, days: CALENDAR_DAYS });

  if (bounds.lastActiveDay === null && doubts.length === 0) {
    return (
      <Screen title="Your streak" onBack={() => navigate(-1)}>
        <EmptyState
          icon="local_fire_department"
          title="No streak yet"
          body="Finish one lesson today and your streak starts at one. It grows on every day you finish another."
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
    <Screen title="Your streak" onBack={() => navigate(-1)}>
      <div className="flex gap-3 mb-stack-md">
        <div className="tile-orange rounded-[24px] p-card-padding flex-[2] flex flex-col items-center gap-1">
          <Icon
            name="local_fire_department"
            filled
            className="text-[40px] text-on-secondary-container"
          />
          <span className="font-headline-xl text-headline-xl text-on-surface">
            {bounds.current}
          </span>
          <span className="font-label-md text-label-md text-on-surface-variant text-center">
            {bounds.current === 1 ? 'day in a row' : 'days in a row'}
          </span>
        </div>

        <div className="bg-surface-container-lowest rounded-[24px] p-card-padding flex-1 flex flex-col items-center justify-center gap-1 shadow-sm">
          <span className="font-headline-md text-headline-md text-on-surface">
            {bounds.longest}
          </span>
          <span className="font-label-sm text-label-sm text-on-surface-variant text-center uppercase tracking-wide">
            Best ever
          </span>
        </div>
      </div>

      {/* Twelve weeks, one square a day. */}
      <div className="bg-surface-container-lowest rounded-[24px] p-card-padding shadow-sm mb-stack-md">
        <h2 className="font-headline-md text-[20px] leading-7 text-on-surface mb-1">
          Last 12 weeks
        </h2>
        <p className="font-label-md text-label-md text-on-surface-variant mb-stack-sm">
          {formatDay(calendar[0].day)} to {formatDay(calendar[calendar.length - 1].day)}
        </p>

        {/* Seven rows filled column by column, so one column is one week. */}
        <div className="grid grid-rows-[repeat(7,minmax(0,1fr))] grid-flow-col auto-cols-fr gap-1">
          {calendar.map((day) => {
            const label = titleOf(day);
            return (
              <div
                key={day.day}
                role="img"
                aria-label={label}
                title={label}
                className={`aspect-square rounded ${TINT[day.activity]}`}
              />
            );
          })}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-stack-sm">
          {LEGEND.map(({ activity, label }) => (
            <span
              key={activity}
              className="flex items-center gap-2 font-label-sm text-label-sm text-on-surface-variant"
            >
              <span className={`w-3 h-3 rounded ${TINT[activity]}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-[24px] p-card-padding shadow-sm">
        <h2 className="font-headline-md text-[20px] leading-7 text-on-surface mb-2">
          How the streak works
        </h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          It counts days, not lessons. Finish one lesson and the day counts, however
          many you watch after it. Miss a whole day and the streak starts again at one.
          That is the whole rule — there is nothing to buy and no way to pause it.
        </p>
        {bounds.lastActiveDay !== null && (
          <p className="font-label-md text-label-md text-on-surface-variant mt-stack-sm">
            Last lesson finished on {formatDay(bounds.lastActiveDay)}.
          </p>
        )}
      </div>
    </Screen>
  );
}
