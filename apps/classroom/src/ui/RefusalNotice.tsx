import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { Refusal, RefusalWait } from '../lib/refusal';

/**
 * THE RELAY SAID NO, AND THE CHILD IS TOLD SO.
 *
 * gate.ts writes the sentence; `readRefusal` says whose limit it was and
 * whether waiting helps; this puts both in front of a student. It composes NO
 * apology of its own — the only sentence about what happened is the relay's
 * one, rendered word for word — and it never shows a status code or the name
 * of any part of our plumbing, because neither is a thing a child can act on.
 *
 * The one judgement it makes is about the BUTTON. A "Try again" under "come
 * back tomorrow" is a promise we cannot keep: it invites a tap that will be
 * refused in the same words, and a child who taps three times learns that the
 * app lies rather than that the day is spent. So the retry is offered only
 * where another go in a few seconds is a real offer, and `children` — which
 * the type requires — is where the caller puts the move that is always
 * honest: going somewhere else.
 *
 * This lives here rather than inside a screen because the two places a refusal
 * already reaches a student — LiveClass's error branch and ClassRoom's — are
 * not this phase's to edit. Adopting it there is a recorded handoff.
 */

/** What to do about it, in English chrome, matching the sentence's own promise. */
const WHAT_NOW: Record<RefusalWait, string> = {
  moment: 'Give it a few seconds, then have another go.',
  minutes: 'Come back in a few minutes and she will be ready.',
  tomorrow: 'Come back tomorrow and you can carry on where you left off.',
};

/**
 * Waiting, not breakage. An error triangle would tell a student something is
 * broken and that they may have broken it; none of the five refusals is that.
 *
 * Every name here must be a key of the map in ui/Icon.tsx, which is not this
 * file's to extend: an unknown name draws a literal dot instead (Icon.tsx:185),
 * and that is what the first cut of this notice shipped for the two refusals a
 * child meets most. refusal.test.ts now asserts each face resolves to an <svg>.
 */
const FACE: Record<RefusalWait, string> = {
  moment: 'schedule',
  minutes: 'hourglass_top',
  tomorrow: 'calendar_month',
};

export function RefusalNotice({
  refusal,
  onRetry,
  children,
  className = '',
}: {
  refusal: Refusal;
  /** Offered only when waiting a few seconds could actually change the answer. */
  onRetry?: () => void;
  /**
   * The move that is honest whatever the refusal — usually "Back home".
   *
   * REQUIRED, and not as ceremony. Three of the five refusals never get a
   * retry, so a caller that passed neither would leave a child on a block of
   * text with nothing to press. The type is what makes that a decision rather
   * than an oversight; `null` is a legitimate answer, an absent prop is not.
   */
  children: ReactNode;
  className?: string;
}) {
  const canRetry = onRetry !== undefined && refusal.wait === 'moment';

  return (
    <div
      role="status"
      className={`flex flex-col items-center text-center gap-3 py-12 ${className}`}
    >
      <div className="w-16 h-16 rounded-full bg-primary-container grid place-items-center">
        <Icon name={FACE[refusal.wait]} className="text-3xl text-on-primary-container" />
      </div>

      {/* The relay's sentence, unedited. It is the headline because it is the
          only line here that says what actually happened. */}
      <p className="font-headline-md text-[18px] leading-7 text-on-surface max-w-[42ch]">
        {refusal.message}
      </p>

      {/* Said out loud only when it is true. A 429 IS the student's own rate or
          their own day, and telling them otherwise would be a kindness that
          stops them understanding their own allowance. */}
      {refusal.ours && (
        <p className="font-body-md text-body-md text-on-surface-variant max-w-[42ch]">
          Nothing you did caused this.
        </p>
      )}

      <p className="font-body-md text-body-md text-on-surface-variant max-w-[42ch]">
        {WHAT_NOW[refusal.wait]}
      </p>

      <div className="flex items-center gap-3 mt-1">
        {canRetry && (
          <button
            onClick={onRetry}
            className="bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
          >
            Try again
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
