import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/**
 * THE STREAK, AS SOMETHING EARNED.
 *
 * A number in a pill is a fact. What makes a streak work — and it is the most
 * copied feature in this whole category — is that it behaves like a thing you
 * are keeping alive: the flame moves, and the count arrives rather than simply
 * being there.
 *
 * So on every open it counts UP to the real number. Not a decoration: it is
 * the one second a day the student is shown what they have built, and a digit
 * that ticks past 4, 5, 6 to land on 7 is read as an achievement in a way that
 * a printed 7 is not.
 *
 * Reduced motion gets the number immediately and a still flame, which is the
 * same information without the performance.
 */

/** How long the count takes, whatever the number. Long streaks must not drag. */
const COUNT_MS = 900;

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useCountUp(target: number, ms: number = COUNT_MS): number {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));

  useEffect(() => {
    if (prefersReducedMotion() || target <= 0) {
      setShown(target);
      return;
    }
    const started = performance.now();
    let raf = 0;
    const step = (): void => {
      const through = Math.min(1, (performance.now() - started) / ms);
      // Eased out: it sprints, then settles onto the number.
      setShown(Math.round(target * (1 - Math.pow(1 - through, 3))));
      if (through < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return shown;
}

export function StreakFlame({ days, onClick }: { days: number; onClick?: () => void }) {
  const shown = useCountUp(days);

  return (
    <button
      onClick={onClick}
      aria-label={`${days} day streak`}
      className="group flex items-center gap-1.5 bg-secondary-container text-on-secondary-container rounded-full pl-2.5 pr-3.5 py-1.5 shadow-sm font-label-md text-label-md font-bold active:scale-95 transition-transform"
    >
      <span className="streak-flame grid place-items-center">
        <Icon name="local_fire_department" filled className="text-[19px] text-[#f97316]" />
      </span>
      <span className="tabular-nums">{shown}</span>
      <span className="font-normal opacity-80">{days === 1 ? 'day' : 'days'}</span>
    </button>
  );
}
