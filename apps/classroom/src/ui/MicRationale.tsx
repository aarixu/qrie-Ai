import { Icon } from './Icon';

/**
 * WHY SHE NEEDS TO HEAR YOU — asked before the phone asks.
 *
 * A system permission dialog is a yes/no with no context. On the web the cost
 * of a "no" is small: the student is asked again next time. On a phone it is
 * not — Android stops showing the prompt after two refusals and iOS after one,
 * and from then on the only way back is Settings, which nobody finds. A
 * fourteen-year-old who taps Deny because a box appeared out of nowhere has
 * silently turned off the thing that makes this a class rather than a video.
 *
 * So the app asks first, in its own words, and the system prompt only appears
 * to somebody who has already said yes to a sentence they understood.
 *
 * "Not now" is a real answer and costs nothing: the chips under her question
 * still work, and the class carries on typed. That is why this can be honest
 * about it rather than pleading — a permission screen that makes refusing feel
 * like breaking the app is a dark pattern with a friendly face.
 */

export function MicRationale({
  onAllow,
  onSkip,
}: {
  /** Opens the real system prompt. */
  onAllow: () => void;
  /** Carry on without it. The chips and the keyboard still work. */
  onSkip: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Let Meera hear your answers"
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/50 px-4 pb-4 sm:pb-0"
    >
      <div className="w-full max-w-md bg-surface-container-lowest rounded-[24px] p-card-padding shadow-lg font-body-md flex flex-col gap-4">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 rounded-full bg-primary-container grid place-items-center">
            <Icon name="mic" filled className="text-3xl text-on-primary-container" />
          </div>
          <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">
            Let Meera hear your answers
          </h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            When she asks you something, the mic opens on its own so you can just say it — in
            English, Hindi, or both. It closes the moment you finish.
          </p>
          <p className="font-label-md text-label-md text-on-surface-variant">
            Nothing is recorded or kept. Your phone will ask you next.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onAllow}
            className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
          >
            Turn on the mic
          </button>
          <button
            onClick={onSkip}
            className="w-full text-on-surface-variant font-label-md text-label-md py-3 rounded-xl hover:bg-surface-container-high transition-colors"
          >
            Not now — I will type
          </button>
        </div>
      </div>
    </div>
  );
}
