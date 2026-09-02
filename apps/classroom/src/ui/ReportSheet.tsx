import { useState } from 'react';
import { HELPLINES } from '@ai-tutor/safety';
import { recordFlag } from '../stores/flags';
import { Icon } from './Icon';

/**
 * A WAY TO SAY "THIS WAS WRONG".
 *
 * The app put an open-ended conversation in front of a child and gave them no
 * way to object to anything in it. That is the specific thing a store reviewer
 * looks for in a child-facing app, and it is also the honest admission that a
 * model will sometimes say something it should not — a product that cannot be
 * told so has decided not to find out.
 *
 * Two rules shape it:
 *
 *   - IT LEAVES NOTHING BEHIND UNLESS THE STUDENT SAYS SO. The repo already
 *     committed to this (apps/agent/src/worker.ts: "their voices and their
 *     doubts do not leave the room they were spoken in"), so nothing is
 *     captured automatically. What is kept is what they typed, because they
 *     typed it on purpose.
 *   - IT ANSWERS. A report that says "thank you for your feedback" and does
 *     nothing teaches a child that reporting is pointless. This one says what
 *     actually happens, and — because the commonest reason a child reports
 *     something is that they are upset by it — puts a real helpline in front
 *     of them without waiting to be asked.
 */

const REASONS = [
  { id: 'wrong', label: 'She got something wrong' },
  { id: 'rude', label: 'Something she said upset me' },
  { id: 'unsafe', label: 'Something here does not feel safe' },
  { id: 'other', label: 'Something else' },
] as const;

export function ReportSheet({
  lessonId,
  onClose,
}: {
  lessonId?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  const send = () => {
    recordFlag({
      kind: 'reported',
      at: new Date().toISOString(),
      ...(lessonId ? { lessonId } : {}),
      // Their own words, kept because they chose to write them. Nothing the
      // safety screen matched is ever stored beside this.
      note: [reason, note.trim()].filter(Boolean).join(' — ').slice(0, 500),
    });
    setSent(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report something in this class"
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/50 px-4 pb-4 sm:pb-0"
    >
      <div className="w-full max-w-md bg-surface-container-lowest rounded-[24px] p-card-padding shadow-lg font-body-md">
        {sent ? (
          <div className="flex flex-col gap-3 text-center items-center">
            <div className="w-14 h-14 rounded-full ring-tint-green ink-green grid place-items-center">
              <Icon name="check" filled className="text-2xl" />
            </div>
            <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">Thank you for telling us</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              This is saved on your phone so you can show it to a parent or a teacher. Nothing was
              sent anywhere without you.
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant">
              If something has upset you or you do not feel safe, please talk to an adult you trust.
              You can also call Tele-MANAS on <strong>{HELPLINES.telemanas}</strong>, free, any time.
            </p>
            <button
              onClick={onClose}
              className="mt-1 w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
            >
              Back to the class
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">
                Report something
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
              >
                <Icon name="close" />
              </button>
            </div>

            <div className="grid gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setReason(r.label)}
                  aria-pressed={reason === r.label}
                  className={`text-left px-4 py-3 rounded-xl border-2 transition-colors font-body-md text-body-md ${
                    reason === r.label
                      ? 'border-primary bg-primary-container text-on-primary-container'
                      : 'border-surface-variant text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <label className="flex flex-col gap-2">
              <span className="font-label-md text-label-md text-on-surface-variant">
                Anything you want to add (optional)
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={400}
                className="w-full bg-surface-container rounded-xl p-3 font-body-md text-body-md text-on-surface outline-none border-2 border-transparent focus:border-primary transition-colors resize-none"
              />
            </label>

            <button
              onClick={send}
              disabled={reason === null}
              className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all disabled:opacity-40 disabled:active:translate-y-0"
            >
              Send report
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
