import { BRAND } from '../brand';
import { Wordmark } from '../ui/Logo';

/**
 * How long the splash stays up once it has been shown.
 *
 * A splash that appears for 80ms and vanishes reads as a rendering glitch, not
 * as a brand moment — so the integrator holds it for at least this long even
 * when startup work finishes sooner. Kept here, next to the screen it governs,
 * so the two cannot drift apart.
 */
export const MIN_SPLASH_MS = 900;

/**
 * The first thing a student sees.
 *
 * Deliberately still: a mark, a name, a promise, and a quiet sign that
 * something is happening. This is a held breath before the app, so nothing
 * here bounces or slides — the only motion is the loading dots fading, and
 * `prefers-reduced-motion` in the base stylesheet neutralises even that.
 *
 * The screen takes no props and routes nowhere on its own; deciding when it
 * gives way is the integrator's job.
 */
export function Splash() {
  return (
    <div className="bg-background text-on-background min-h-screen font-body-md grid place-items-center px-margin-mobile py-10">
      <div className="w-full max-w-[360px] flex flex-col items-center text-center gap-stack-md">
        <Wordmark size={112} />

        <p className="font-body-md text-body-md text-on-surface-variant max-w-[30ch]">
          {BRAND.tagline}
        </p>

        <div
          role="status"
          aria-label={`Loading ${BRAND.name}`}
          className="flex items-center gap-2 mt-stack-sm"
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-primary/40 animate-pulse"
              // Staggering by delay rather than by three keyframe sets keeps the
              // dots reading as one calm wave instead of three blinking lights.
              style={{ animationDelay: `${i * 220}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
