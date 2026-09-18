import { useRef, useState } from 'react';
import { HELPLINES, screen } from '@ai-tutor/safety';
import { recordFlag } from '../stores/flags';
import { relayFetch } from '../lib/relay';
import { currentSessionId } from '../stores/ledger';
import { isNative } from '../lib/platform';
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
 *   - THE LOCAL COPY IS KEPT, ALWAYS AND FIRST. It is written before anything
 *     is sent and it survives every refusal, so a relay that is down, halted
 *     or rate-limited cannot lose a child's report.
 *   - IT ANSWERS. A report that says "thank you for your feedback" and does
 *     nothing teaches a child that reporting is pointless. This one says what
 *     actually happens, and — because the commonest reason a child reports
 *     something is that they are upset by it — puts a real helpline in front
 *     of them without waiting to be asked.
 *
 * WHAT CHANGED, AND WHY THE OLD COPY WAS A DEFECT. This sheet used to write
 * localStorage and stop there, and it told the child "Nothing was sent
 * anywhere without you" — which was true, and was the problem: the report
 * reached nobody. POST /api/report now exists (packages/relay/src/report.ts),
 * so the sentence had to change with the behaviour. A sentence that stays
 * true only because the feature never worked is the shape of defect this
 * repo has shipped before.
 */

/**
 * The four kinds POST /api/report accepts, spelled here rather than imported.
 *
 * `@ai-tutor/relay` is NOT among the aliases apps/classroom/vite.config.ts
 * declares, so importing the contract would break the client build — and it
 * would pull server code into a browser bundle to do it. The relay's
 * validator is the authority and this is a copy that must follow it;
 * packages/relay/src/report.ts's KINDS set is what it follows.
 */
export type ReportKind = 'wrong' | 'rude' | 'unsafe' | 'other';

/** The reason ids ARE that kind — no mapping between label and contract. */
const REASONS: { id: ReportKind; label: string }[] = [
  { id: 'wrong', label: 'She got something wrong' },
  { id: 'rude', label: 'Something she said upset me' },
  { id: 'unsafe', label: 'Something here does not feel safe' },
  { id: 'other', label: 'Something else' },
];

/**
 * The sheet's own cap, and it is deliberately lower than the relay's.
 *
 * Both PRD copies give a child 500 characters to type; the server holds 2000
 * as headroom in the same direction as safety, so a compliant sheet never
 * sees a 413. See report.ts's note on why two numbers exist.
 *
 * ONE NUMBER, USED THREE TIMES, and that is the point of saying so: it is the
 * textarea's `maxLength`, the slice on the local copy, and the `limit` handed
 * to `screen`. It used to be none of the first — the textarea said 400, so a
 * child got a hundred characters less than this file claimed they did.
 *
 * `screen` TRUNCATES past its limit (safety/src/screen.ts's `tidy` appends an
 * ellipsis), where report.ts's rule for the same field is reject-never-
 * truncate. Unreachable from this sheet now that the textarea caps at the same
 * number and `tidy` collapses whitespace before it measures — but a caller
 * reaching for the exported `noteThatMayTravel` with a longer note would get a
 * silently shortened one presented as the whole thing.
 */
const MAX_NOTE = 500;

/** Stamped on the report so a person reading the queue knows which build. */
const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) || 'dev';

/** Everything the relay's contract asks for, gathered at the tap. */
export interface ReportDraft {
  kind: ReportKind;
  note: string;
  lessonId: string;
  topicRef: string | null;
  beatId: string | null;
  spokenLine: string | null;
  /** ISO. Stamped ONCE — see the ref in the component. */
  at: string;
}

/** Sent and a person can see it, or kept here and they cannot — yet. */
export type ReportOutcome = 'sent' | 'kept';

/**
 * WHAT MAY LEAVE THE DEVICE, DECIDED HERE AND NOWHERE ELSE.
 *
 * The note is the child's own typed words, and the relay declines to clean
 * them on purpose — a second cleaner would be a second place a child's words
 * are silently altered. So this is the only scrub there is, and until it
 * existed a name, a school or a phone number landed verbatim and permanently
 * in `student_report.note`, which is a DPDP data-minimisation problem on child
 * data (report.ts says so at length).
 *
 * `screen` is the repo's one PII scrubber and it answers four ways. Two of
 * them hand back text — `allow` and `clean` — and that text is what travels.
 * The other two, `support` and `redirect`, hand back only a line to SAY: the
 * screen decided the words need a person, and it exposes no scrubbed copy of
 * them at all.
 *
 * WHAT THIS DOES ABOUT THAT, said plainly because it is a real limit: the
 * note is WITHHELD. The report still goes — kind, lesson, beat and the line
 * she actually said are what a person triages on — and the child keeps their
 * full words on their own phone, with the helpline already in front of them
 * in the confirmation below. Sending the words raw instead would be the one
 * thing worse: an unscrubbed disclosure, permanently, in a database row.
 *
 * HANDOFF, recorded rather than worked around: `@ai-tutor/safety` has no pure
 * `redact()` — the masking lives behind the distress gate inside `screen`.
 * Until it does, a distressing note cannot travel scrubbed, and it does not
 * travel at all.
 */
export function noteThatMayTravel(note: string): {
  note: string;
  withheld: boolean;
  /**
   * WHICH refusal it was, or null when nothing was withheld. Distress and an
   * off-limits request are not the same event, and they must not get the same
   * sentence in front of a child.
   */
  why: 'support' | 'redirect' | null;
} {
  const verdict = screen(note, 'from-student', { limit: MAX_NOTE });
  if (verdict.kind === 'allow' || verdict.kind === 'clean') {
    return { note: verdict.text, withheld: false, why: null };
  }
  return { note: '', withheld: true, why: verdict.kind };
}

/**
 * THE KIND A WORDLESS REPORT TRAVELS AS.
 *
 * When the screen withholds for distress, the row reaches an operator with an
 * EMPTY note and whatever the child happened to tap, which may well be
 * "Something else". The single most serious report this product can receive
 * would sort to the bottom of a queue, indistinguishable from a typo
 * complaint.
 *
 * So a withheld distress note is filed as 'unsafe'. A note the screen refused
 * to release IS the evidence that a person is needed, and `kind` is the only
 * field left that can carry it — an enum, not the child's words, so nothing of
 * theirs leaks by saying it.
 *
 * NOT for 'redirect'. That is a child who wrote about something the tutor
 * declines to discuss: a boundary, not an emergency, and dressing it as one
 * would put an untrue flag against a child.
 */
export function reportKindFor(
  tapped: ReportKind,
  why: 'support' | 'redirect' | null,
): ReportKind {
  return why === 'support' ? 'unsafe' : tapped;
}

/**
 * Post one report. Never throws, and never loses anything: the caller has
 * already kept the local copy, so 'kept' is a complete and honest outcome.
 *
 * `at` comes in rather than being stamped here, because it is part of the
 * relay's idempotency key — a retry must resend it byte for byte or an
 * operator reads one report five times (report.ts, the `at` IS THE CLIENT'S
 * paragraph).
 */
export async function fileReport(draft: ReportDraft): Promise<ReportOutcome> {
  try {
    const res = await relayFetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: draft.kind,
        note: draft.note,
        lessonId: draft.lessonId,
        topicRef: draft.topicRef,
        beatId: draft.beatId,
        spokenLine: draft.spokenLine,
        // Which sitting this happened in, so the report can be read beside
        // what it cost and what was taught. Null outside a class.
        sessionId: currentSessionId(),
        release: RELEASE,
        platform: isNative() ? 'android' : 'web',
        at: draft.at,
      }),
    });
    return res.ok ? 'sent' : 'kept';
  } catch {
    // Offline, or the relay is unreachable. The copy on this device stands.
    return 'kept';
  }
}

export function ReportSheet({
  lessonId,
  topicRef,
  beatId,
  /**
   * THE LINE SHE ACTUALLY SAID, and the single most useful field on a 'rude'
   * or an 'unsafe' report — nothing else in the row says what the child is
   * objecting to.
   *
   * Worth being exact about what this is, because the rule beside the note is
   * that nothing the safety screen matched is stored: this is not a screen
   * match and not the child's words. It is the tutor's own delivered line,
   * which the child was just shown on screen as a caption.
   */
  spokenLine,
  onClose,
}: {
  lessonId?: string;
  topicRef?: string;
  beatId?: string | null;
  spokenLine?: string | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportKind | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);
  const [withheld, setWithheld] = useState<'support' | 'redirect' | null>(null);

  /**
   * ONE TIMESTAMP FOR THIS REPORT, however many times it is sent.
   *
   * It is part of the relay's idempotency key `(user, lessonId, beatId, at)`.
   * Computing `new Date().toISOString()` inside the send — which is what this
   * sheet used to do — makes every retry a brand new row, so a flaky
   * connection puts the same report in front of an operator five times.
   */
  const stampedAt = useRef<string | null>(null);

  const send = async () => {
    if (reason === null || sending) return;
    setSending(true);
    const at = (stampedAt.current ??= new Date().toISOString());
    const label = REASONS.find((r) => r.id === reason)?.label ?? reason;

    /**
     * THE LOCAL COPY FIRST, AND UNSCRUBBED.
     *
     * Their own words, kept because they chose to write them, on their own
     * device, for them to show a parent or a teacher. The scrub below is
     * about what LEAVES the phone; masking what stays on it would alter what
     * a child wrote in order to protect them from themselves.
     */
    recordFlag({
      kind: 'reported',
      at,
      ...(lessonId ? { lessonId } : {}),
      note: [label, note.trim()].filter(Boolean).join(' — ').slice(0, MAX_NOTE),
    });

    const travelling = noteThatMayTravel(note.trim());
    setWithheld(travelling.why);
    const result = await fileReport({
      kind: reportKindFor(reason, travelling.why),
      // The reason travels as `kind`. Joining it onto the note as well — which
      // is what the local copy does for a human reader — would put a label
      // this app wrote inside a column that holds a child's own sentence.
      note: travelling.note,
      lessonId: lessonId ?? 'none',
      topicRef: topicRef ?? null,
      beatId: beatId ?? null,
      spokenLine: spokenLine ?? null,
      at,
    });
    setOutcome(result);
    setSending(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report something in this class"
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/50 px-4 pb-4 sm:pb-0"
    >
      <div className="w-full max-w-md bg-surface-container-lowest rounded-[24px] p-card-padding shadow-lg font-body-md">
        {outcome !== null ? (
          <div className="flex flex-col gap-3 text-center items-center">
            <div className="w-14 h-14 rounded-full ring-tint-green ink-green grid place-items-center">
              <Icon name="check" filled className="text-2xl" />
            </div>
            <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">
              Thank you for telling us
            </h2>
            {/* The copy follows what actually happened, which is the whole
                point of this change. Two outcomes, two different truths. */}
            {/* THE WITHHELD SENTENCE FIRST. "Somebody will read it" followed
                by "what you wrote stayed on this phone" reads as a
                contradiction in that order; a child should learn what did not
                travel before being told what did. */}
            {withheld !== null && (
              <p className="font-body-md text-body-md text-on-surface-variant">
                {withheld === 'support'
                  ? 'What you wrote stayed on this phone. Please tell an adult you trust what happened.'
                  : 'Some of what you wrote stayed on this phone. The rest of your report has gone.'}
              </p>
            )}
            <p className="font-body-md text-body-md text-on-surface-variant">
              {outcome === 'sent'
                ? 'This is saved on your phone, and it has been sent to the people who look after this app. Somebody will read it.'
                : 'This is saved on your phone. We could not send it just now, so nobody has read it yet — it is still here, and you can show it to a parent or a teacher.'}
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant">
              If something has upset you or you do not feel safe, please talk to an adult you trust.
              You can also call Tele-MANAS on <strong>{HELPLINES.telemanas}</strong>, free, any time.
            </p>
            {/* A KEPT REPORT CAN BE SENT AGAIN, and nothing else in this app
                ever retries one: `recordFlag({ kind: 'reported' })` is written
                and never read back anywhere in apps/classroom/src. Without
                this a single 503 drops a Safety report for good, and "saved on
                the phone" is not "reaches a person". The retry is SAFE because
                `at` is stamped once in the ref above, which is exactly what
                makes the relay's idempotency key (user, lessonId, beatId, at)
                hold — an operator does not read the same report twice. */}
            {outcome === 'kept' && (
              <button
                onClick={() => void send()}
                disabled={sending}
                className="w-full bg-secondary-container text-on-secondary-container font-label-md text-label-md py-3 rounded-xl disabled:opacity-40"
              >
                {sending ? 'Trying again…' : 'Try sending it again'}
              </button>
            )}
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
                  onClick={() => setReason(r.id)}
                  aria-pressed={reason === r.id}
                  className={`text-left px-4 py-3 rounded-xl border-2 transition-colors font-body-md text-body-md ${
                    reason === r.id
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
                maxLength={MAX_NOTE}
                className="w-full bg-surface-container rounded-xl p-3 font-body-md text-body-md text-on-surface outline-none border-2 border-transparent focus:border-primary transition-colors resize-none"
              />
            </label>

            {/* Said BEFORE they tap, not after. A child deciding whether to
                report something should know where it goes. */}
            {/* ONLY WHAT IS ACTUALLY REMOVED. The screen takes out phone
                numbers and email addresses. It does NOT take out a short-form
                address: "i live at 14 MG Road, Pune" comes back from
                packages/safety as verdict 'allow', byte-identical, because
                ADDRESS wants "flat"/"house no"/"my address is" in front of the
                number. So the rest of this is an instruction and not a
                promise. A child must not be invited to rely on a guard that is
                not there — least of all in the one box where they are most
                likely to write about home. */}
            <p className="font-label-md text-label-md text-on-surface-variant">
              This is saved on your phone and sent to the people who look after this app. We take
              out phone numbers and email addresses before it is sent. Please do not write where
              you live, your school, or anyone’s name.
            </p>

            <button
              onClick={() => void send()}
              disabled={reason === null || sending}
              className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all disabled:opacity-40 disabled:active:translate-y-0"
            >
              {sending ? 'Sending…' : 'Send report'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
