import { BRAND } from '../brand';
import { Wordmark } from '../ui/Logo';
import { CartoonAvatar } from '../avatar/CartoonAvatar';

/**
 * How long the splash stays up once it has been shown.
 *
 * A splash that appears for 80ms and vanishes reads as a rendering glitch, not
 * as a brand moment — so the integrator holds it for at least this long even
 * when startup work finishes sooner. Kept here, next to the screen it governs,
 * so the two cannot drift apart.
 *
 * Longer than it was, because there is now something worth watching: he waves,
 * and a wave that is cut off halfway is worse than no wave.
 */
export const MIN_SPLASH_MS = 1_500;

/**
 * The first thing a student sees — and now it is the tutor, not a spinner.
 *
 * The penguin IS the product's face: he blinks, breathes and waves the moment
 * the app opens, and a student meets him before they meet a single control.
 * This is the one screen every student sees every time, and it used to be a
 * wordmark over three pulsing dots — true of any app, memorable in none.
 *
 * He needs nothing to run: the avatar drives itself from its own clock, and
 * with no line being spoken his beak simply rests while he blinks and sways.
 * `prefers-reduced-motion` is honoured inside the avatar's own loop.
 *
 * The screen takes no props and routes nowhere on its own; deciding when it
 * gives way is the integrator's job.
 */
export function Splash() {
  return (
    <div className="bg-background text-on-background min-h-screen font-body-md grid place-items-center px-margin-mobile py-10 overflow-hidden">
      <div className="w-full max-w-[360px] flex flex-col items-center text-center">
        {/* He arrives first, and the name settles under him. */}
        <div className="w-[190px] h-[210px] splash-rise" aria-hidden>
          <CartoonAvatar pose="greet" className="w-full h-full" />
        </div>

        <div className="splash-settle flex flex-col items-center gap-stack-md">
          <Wordmark size={92} />
          <p className="font-body-md text-body-md text-on-surface-variant max-w-[30ch]">
            {BRAND.tagline}
          </p>
        </div>

        {/* Announced, not drawn: the wave is the visible sign that something
            is happening, and a screen reader needs the words for it. */}
        <span role="status" aria-label={`Loading ${BRAND.name}`} className="sr-only">
          {`Loading ${BRAND.name}`}
        </span>
      </div>
    </div>
  );
}
