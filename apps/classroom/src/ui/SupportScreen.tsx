import { useEffect, useRef } from 'react';
import { HELPLINES } from '@ai-tutor/safety';
import { Bloub } from '../bloub/Bloub';

/**
 * WHAT THE ROOM BECOMES WHEN THE CLASS HALTS.
 *
 * Shown by ClassRoom in place of the whole room once `haltSession`
 * (lib/sessionHalt.ts) has run: the recording paused, the mic closed, the
 * doubt ended. It carries the line she has just said — the safety package's
 * support reply, written to be said to a child — so a student who missed it,
 * or who is reading rather than listening, has it in front of them.
 *
 * Calm, and deliberately short of choices. Every number in that reply (the
 * two helplines and 112) is one tap from a phone call. The only button leaves the class (every
 * caller of ClassRoom passes an `onExit` that goes home). There is no "carry
 * on": a class that starts talking again a tap after it has told a child to go
 * and find somebody is the app talking over that. Nothing on this screen
 * starts the class again.
 *
 * An alert dialog that TAKES FOCUS when it appears, so a screen reader lands
 * on it and reads its title and line (aria-labelledby, aria-describedby)
 * rather than leaving the student to find them. The focus has to be moved:
 * the room this replaces took the focused control — the Send button, the
 * doubt box — with it, which leaves focus on <body>, and TalkBack does not
 * reliably announce an alert dialog that nothing has focused. It is the
 * dialog that is focused, not its button, so an Enter meant for the doubt box
 * cannot press "Go back home". Whether TalkBack then reads it on a real phone
 * has not been checked: UNVERIFIED.
 */
export function SupportScreen({ line, onLeave }: { line: string; onLeave(): void }) {
  const LINK =
    'w-full rounded-xl bg-surface-container-high text-on-surface font-label-md text-label-md px-5 py-3 flex items-center justify-between gap-3';
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
  }, []);
  return (
    <div
      ref={dialog}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="support-title"
      aria-describedby="support-line"
      className="fixed inset-0 z-[80] bg-background overflow-y-auto grid place-items-center px-margin-mobile font-body-md outline-none"
    >
      <div className="text-center flex flex-col items-center gap-4 max-w-[46ch] py-10">
        {/* Her picture, not an alarm: this is the tutor speaking, gently.
            Bloub, as on every screen she is shown on, still (no flourishes
            on a page that should stay calm). */}
        <Bloub mode="idle" size={72} ambient={false} />
        <h1 id="support-title" className="font-headline-md text-[20px] leading-7 text-on-surface">
          Let&rsquo;s stop here for now
        </h1>
        <p id="support-line" className="font-body-md text-body-md text-on-surface leading-7">
          {line}
        </p>
        <div className="w-full grid gap-2">
          <a href={`tel:${HELPLINES.telemanas}`} className={LINK}>
            <span>Tele-MANAS</span>
            <span className="font-semibold tabular-nums">{HELPLINES.telemanas}</span>
          </a>
          <a href={`tel:${HELPLINES.childline}`} className={LINK}>
            <span>Childline</span>
            <span className="font-semibold tabular-nums">{HELPLINES.childline}</span>
          </a>
          {/* The line she said ends on "If you are in danger right now, call
              112" (persona v3): every number in it is one tap away. */}
          <a href={`tel:${HELPLINES.emergency}`} className={LINK}>
            <span>Emergency</span>
            <span className="font-semibold tabular-nums">{HELPLINES.emergency}</span>
          </a>
        </div>
        <button
          onClick={onLeave}
          className="mt-2 w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
        >
          Go back home
        </button>
      </div>
    </div>
  );
}
