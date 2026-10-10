import { useRef, useState } from 'react';
import { HELPLINES, redact, screen } from '@ai-tutor/safety';
import { UNKNOWN_OWNER, markSent, markUnsent, recordFlag } from '../stores/flags';
import { relayFetch } from '../lib/relay';
import { currentSessionId } from '../stores/ledger';
import { accountFromStoredSession } from '../lib/supabase';
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
 *   - AND 'kept' IS NOT 'LOST'. A refusal marks the draft in stores/flags.ts
 *     and App.tsx files it the next time the phone has signal, carrying the
 *     same `at` so the relay reads one report rather than two. Before that
 *     existed, one 503 dropped a Safety report for good under a sentence
 *     saying it was saved.
 *   - BUT 'refused' IS NOT 'kept'. A body the relay will not have gets the
 *     same answer however often it is offered, so it stops being queued and
 *     the child is told that instead of being promised a retry that is never
 *     coming. Their own copy stays on the phone in every case.
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

/**
 * THE ANSWERS THAT WILL NOT CHANGE IF WE ASK AGAIN.
 *
 * Everything else the relay can say is worth retrying, and the queue does:
 * 429 is the child's own rate or budget, 503 is our capacity or an outage, 401
 * is an identity that a later sign-in or a token refresh can supply, and a
 * thrown fetch is a phone in a lift. All of those come right on their own.
 *
 * These three do not. They are the relay's verdicts on the BODY —
 * packages/relay/src/report.ts answers 400 for a field its validator rejects,
 * 405 for the wrong method and 413 for a note past its cap — and the body is
 * frozen in the draft, so the same bytes get the same answer on every app open
 * for the life of the install, while the confirmation screen keeps telling the
 * child the app will try again. The short list is deliberate: a status this
 * set does not name is retried, because losing a child's Safety report is a
 * far worse mistake than a few wasted requests that cost nothing (/api/report
 * is metered at zero units and pays no vendor).
 */
const PERMANENT = new Set([400, 405, 413]);

/**
 * EVERYTHING THE RELAY'S CONTRACT ASKS FOR, GATHERED AT THE TAP.
 *
 * THIS IS THE POST BODY AND NOTHING ELSE IS. It used to be seven of the ten
 * fields, with `sessionId`, `release` and `platform` computed inside
 * `fileReport` at send time — which was harmless while a report was only ever
 * sent the instant it was written, and became wrong the moment App.tsx started
 * replaying kept ones. A report written in a class and replayed on the next
 * app open was filed with `sessionId: null`, or — on a reload with a sitting
 * still open — with the uuid of an UNRELATED lesson, which the relay stores
 * without complaint because it is well-formed. That is precisely the defect
 * stores/ledger.ts already documents for prep calls ("one sitting carrying
 * another sitting's ten rupees"), re-created on the report path. `release` had
 * the same shape: a report kept across an app update was stamped with the
 * build that replayed it rather than the build that produced it, which defeats
 * the one thing the field is for.
 *
 * So every field is stamped in `send` beside `at`, for the same reason `at`
 * is, and `fileReport` reads all ten off the draft and computes none.
 */
export interface ReportDraft {
  kind: ReportKind;
  note: string;
  lessonId: string;
  topicRef: string | null;
  beatId: string | null;
  spokenLine: string | null;
  /**
   * Which sitting this happened in, so the report can be read beside what it
   * cost and what was taught. Null outside a class, which is ordinary.
   */
  sessionId: string | null;
  /** Which build produced it — see RELEASE above. */
  release: string;
  platform: 'web' | 'android';
  /** ISO. Stamped ONCE — see the ref in the component. */
  at: string;
}

/**
 * WHAT BECAME OF IT, IN THE THREE WAYS THAT ARE ACTUALLY DIFFERENT.
 *
 *   - 'sent'    — it is in the queue a person reads.
 *   - 'kept'    — the network or the relay was not there. Trying again later
 *                 is exactly the right thing, and the app does.
 *   - 'refused' — the relay read the body and would not have it. The same
 *                 bytes get the same answer for the life of the install, so a
 *                 queue that keeps trying is a queue that lies to the child.
 *
 * The third one exists because the copy branches on it. Collapsing it into
 * 'kept' meant telling a child "we will try again" about a report that could
 * never land — literally true and practically a lie, which is the defect shape
 * this sheet has now been rewritten twice to get out of.
 */
export type ReportOutcome = 'sent' | 'kept' | 'refused';

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
 * TWO CALLS, AND THE SECOND ONE IS THE POINT.
 *
 * `screen` judges: four verdicts, of which only `allow` and `clean` hand text
 * back. `support` and `redirect` hand back a line to SAY and nothing else —
 * so the most serious note this product can receive had no scrubbed copy
 * anywhere, and this function could only WITHHOLD it. The report went with an
 * empty note: an operator saw that something had happened to a child and could
 * not see what. That was the right call while it was the only call, and it was
 * the wrong outcome.
 *
 * `redact` is the masking pass on its own — the same patterns, the same MASK,
 * one implementation that `screen` also calls (packages/safety/src/screen.ts).
 * So a distressing note is now scrubbed IDENTICALLY to one that took the clean
 * path, and then it travels. Nothing is withheld any more.
 *
 * `why` SURVIVES THE CHANGE because the verdict is still information about the
 * report even once the words can travel: it ranks the row (reportKindFor,
 * below) and it decides whether the child is asked to fetch an adult. Distress
 * and an off-limits question are not the same event and must not get the same
 * sentence in front of a child.
 */
export function noteThatMayTravel(note: string): {
  /** Scrubbed, and never empty because of a verdict. */
  note: string;
  /** What `screen` made of it, or null when it had no objection. */
  why: 'support' | 'redirect' | null;
} {
  const verdict = screen(note, 'from-student', { limit: MAX_NOTE });
  if (verdict.kind === 'allow' || verdict.kind === 'clean') {
    return { note: verdict.text, why: null };
  }
  return { note: redact(note, 'from-student', { limit: MAX_NOTE }).text, why: verdict.kind };
}

/**
 * THE KIND A DISTRESSING REPORT TRAVELS AS.
 *
 * The words travel now, so this is no longer the only thing telling an
 * operator that a person is needed. It is still what a QUEUE sorts on: a child
 * who tapped "Something else" — which is what a child in trouble most often
 * taps, because none of the four labels is about them — and then wrote
 * something serious must not sit below a typo complaint until somebody opens
 * the row and reads it.
 *
 * So a note the screen judged 'support' is filed as 'unsafe'. It is an enum,
 * not the child's words, so nothing of theirs leaks by saying it.
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
 *
 * IT IS NOT GATED ON mayPersist(), AND THAT IS A DECISION RATHER THAN AN
 * OVERSIGHT. Wave 3 left it open because lib/workspace.ts was mid-edit; the
 * predicate is green now, so the question is real: a pre-consent child — a
 * trial session, no parent, no phone number, no consent row — currently
 * creates a `student_report` row, and the trial door's whole promise is that
 * nothing about them is kept.
 *
 * It stays ungated, for three reasons that point the same way.
 *
 * ONE: the trial screen already tells that child this happens, in the copy
 * they read before they start. screens/contest/TrialConsent.tsx lists it as
 * the one exception — "The one thing that does leave this page is a report:
 * if you tell us something in the class is wrong, we keep what you typed so a
 * person can read it and fix it." Gating here would make THAT sentence false,
 * which is the aa278cd shape with the sign flipped: a promise a child is shown
 * and behaviour that quietly does something else. (The handoff a few lines
 * above that copy, asking for exactly this gate, is the half of that file that
 * did not get updated when the copy was written. HANDOFF: it is stale and
 * contradicts the rendered list beside it.)
 *
 * TWO: the person the gate would silence is the person least able to tell
 * anybody else. A trial child has no account, no teacher on our side, and no
 * way to be called back; the report button is the only channel they have. A
 * report is also their own deliberate act, which is the distinction
 * stores/flags.ts already draws — the trial refuses PASSIVE writes about a
 * child (beliefs, ledger rows, an analytics id, a Rs 30 preparation), not a
 * sentence they chose to send.
 *
 * THREE: nothing in what lands identifies anybody. The note is scrubbed by
 * `noteThatMayTravel` above. Of the nine fields beside it, seven are about the
 * LESSON or the app — kind, lesson, topic, beat, the line she said, the build,
 * the platform — and the other two, `sessionId` and `at`, say which sitting
 * and when. `sessionId` is a uuid for one sitting on one device with no name
 * attached to it. There is no name anywhere in the body, and a trial child is
 * never asked for one (TrialConsent says so as a promise: "You are not asked
 * for your name").
 *
 * AND THE HONEST LIMIT OF REASON TWO, verified rather than guessed at:
 * `relayFetch` calls `accessToken`, which does `signingIn ??=
 * startAnonymousSession()` when there is no session (lib/relay.ts:111-119,
 * :146-147). So a trial child who taps report DOES get a Supabase auth user
 * minted for them, on a page whose neighbouring bullet says "Nobody is told
 * who you are". That is a write outside this file and outside this phase's
 * paths; it is recorded as a handoff against lib/relay.ts, not as something
 * this docblock may claim is handled.
 */
export async function fileReport(draft: ReportDraft): Promise<ReportOutcome> {
  try {
    // Every field off the DRAFT, none recomputed — see ReportDraft on what a
    // replay used to file when three of them were built here instead.
    const res = await relayFetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (res.ok) return 'sent';
    return PERMANENT.has(res.status) ? 'refused' : 'kept';
  } catch {
    // Offline, or the relay is unreachable. The copy on this device stands.
    return 'kept';
  }
}

/**
 * WHAT THE CHILD IS TOLD ONCE IT IS DONE.
 *
 * Its own component, and exported, because on this sheet the copy IS the
 * behaviour: it has had to change twice now to keep up with what the app
 * actually does with a child's words, and both times the sentence on the
 * screen was the thing at risk of being left behind. A component renders in
 * a test; a paragraph buried in a branch does not. tests/reportSend.test.tsx
 * holds it to what this build really does.
 *
 * WHAT CHANGED THIS TIME. A child who wrote something distressing used to be
 * told "What you wrote stayed on this phone" — true then, because `screen`
 * would not hand the words back scrubbed and the sheet withheld them. They
 * travel now, scrubbed by the same masking pass every other note goes through,
 * so that sentence is gone.
 *
 * THE SCRUB IS NAMED, NOT IMPLIED. "We took some things out" would leave a
 * child guessing which of their words a stranger is about to read. Phone
 * numbers and email addresses is what `screen` and `redact` actually remove,
 * so that is what it says — the same two things the pre-send paragraph names,
 * and no more. It does NOT claim an address is removed: a short-form address
 * comes back untouched, and the paragraph before they typed said so.
 *
 * AND THE HELPLINE STANDS WHATEVER HAPPENED TO THE POST. A report reaching a
 * queue is not help arriving, and 'kept' means it has not even reached the
 * queue. A child who wrote something serious gets a number they can ring today
 * in every case.
 *
 * A 'redirect' CHILD IS DELIBERATELY TOLD NOTHING EXTRA, which is why this
 * branches on `why === 'support'` and not on `why`. The old build had a line
 * for them — "Some of what you wrote stayed on this phone" — and it went with
 * the withholding it described. Nothing replaced it because there is no true
 * sentence left to add: their words travelled like anybody else's, the
 * boundary they met was the tutor's rather than theirs, and telling a child
 * who asked something off-limits to go and fetch an adult would be this app
 * mistaking a boundary for an emergency. So 'redirect' renders exactly as a
 * note the screen had no objection to, on purpose.
 */
export function ReportDone({
  outcome,
  why,
  hasNote,
  sending,
  onRetry,
  onClose,
  closeLabel = 'Back to the class',
}: {
  outcome: ReportOutcome;
  /** What the safety screen made of the note, or null if it had no objection. */
  why: 'support' | 'redirect' | null;
  /**
   * WHETHER THERE WERE ANY WORDS AT ALL. The textarea is optional and says so,
   * and a child who taps a reason and sends was being told their own words had
   * travelled and been cleaned when there were none to clean.
   */
  hasNote: boolean;
  sending: boolean;
  onRetry: () => void;
  onClose: () => void;
  /** The last button's words: 'Back' when the sheet was opened outside a class. */
  closeLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3 text-center items-center">
      <div className="w-14 h-14 rounded-full ring-tint-green ink-green grid place-items-center">
        <Icon name="check" filled className="text-2xl" />
      </div>
      <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">
        Thank you for telling us
      </h2>
      {/* THE DISTRESS SENTENCE FIRST, and it is about the child rather than
          about the report. Whatever happened to the POST, the true and useful
          thing to say to somebody who has just written that down is that this
          app is not the help they need today. */}
      {why === 'support' && (
        <p className="font-body-md text-body-md text-on-surface-variant">
          Somebody reading this is not the same as somebody helping you. Please tell an adult you
          trust today what you have told us.
        </p>
      )}
      {/* Three outcomes, three different truths — which is the whole point of
          this branch. 'kept' must not borrow a word from 'sent', and 'refused'
          must not borrow the promise from 'kept'. */}
      <p className="font-body-md text-body-md text-on-surface-variant">
        {outcome === 'sent' &&
          (hasNote
            ? 'This is saved on your phone, and it has been sent to the people who look after this app — your own words too, with phone numbers and email addresses taken out of them. Somebody will read it.'
            : 'This is saved on your phone, and it has been sent to the people who look after this app. Somebody will read it.')}
        {outcome === 'kept' &&
          'This is saved on your phone. We could not send it just now, so nobody has read it yet. We will try again as soon as your phone is back online, and it stays here either way — you can show it to a parent or a teacher.'}
        {outcome === 'refused' &&
          'This is saved on your phone. Something in this app stopped it from being sent, and trying again will not fix that, so nobody here has read it. Please show it to a parent or a teacher — it stays on your phone for you.'}
      </p>
      <p className="font-body-md text-body-md text-on-surface-variant">
        If something has upset you or you do not feel safe, please talk to an adult you trust. You
        can also call Tele-MANAS on <strong>{HELPLINES.telemanas}</strong>, free, any time.
      </p>
      {/* A KEPT REPORT CAN BE SENT AGAIN BY HAND, for a child who is still
          looking at this screen and would rather not wait. The automatic
          replay (App.tsx, stores/flags.ts replayUnsent) is what covers the
          child who closes the app and never sees this again. Both are SAFE
          because `at` is stamped once in the sheet's ref, which is what makes
          the relay's idempotency key (user, lessonId, beatId, at) hold — an
          operator does not read the same report twice.

          NOT OFFERED FOR 'refused'. A button whose only possible outcome is
          the same refusal is a button that wastes a child's hope. */}
      {outcome === 'kept' && (
        <button
          onClick={onRetry}
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
        {closeLabel}
      </button>
    </div>
  );
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
  place = 'class',
}: {
  lessonId?: string;
  topicRef?: string;
  beatId?: string | null;
  spokenLine?: string | null;
  onClose: () => void;
  /**
   * Where it was opened: in a class, or from the tutor's pause card
   * (ui/AppConfigGate.tsx), outside any class. Only the dialog's name and the
   * last button's words change.
   */
  place?: 'class' | 'app';
}) {
  const [reason, setReason] = useState<ReportKind | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);
  const [why, setWhy] = useState<'support' | 'redirect' | null>(null);

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
    // Whether this is the first tap or the retry button below, which matters
    // to the local copy: a second recordFlag with the same stamp would put the
    // same report in a child's own log twice.
    const first = stampedAt.current === null;
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
    if (first) {
      recordFlag({
        kind: 'reported',
        at,
        ...(lessonId ? { lessonId } : {}),
        note: [label, note.trim()].filter(Boolean).join(' — ').slice(0, MAX_NOTE),
      });
    }

    const travelling = noteThatMayTravel(note.trim());
    setWhy(travelling.why);
    const draft: ReportDraft = {
      kind: reportKindFor(reason, travelling.why),
      // The reason travels as `kind`. Joining it onto the note as well — which
      // is what the local copy does for a human reader — would put a label
      // this app wrote inside a column that holds a child's own sentence.
      note: travelling.note,
      lessonId: lessonId ?? 'none',
      topicRef: topicRef ?? null,
      beatId: beatId ?? null,
      spokenLine: spokenLine ?? null,
      /**
       * STAMPED HERE, WITH `at`, AND FOR THE SAME REASON.
       *
       * These three used to be computed inside `fileReport`. That was fine
       * while a report only ever went at the moment it was written; once
       * App.tsx started replaying kept ones it meant a report filed against
       * whichever sitting and whichever build happened to be current when the
       * phone next opened. See ReportDraft for what that actually produced.
       */
      sessionId: currentSessionId(),
      release: RELEASE,
      platform: isNative() ? 'android' : 'web',
      at,
    };
    const result = await fileReport(draft);

    /**
     * AND THE MARKER, WHICH IS WHAT MAKES 'kept' MEAN SOMETHING.
     *
     * Nothing used to read 'kept' back, so a 503 or a moment without signal
     * dropped a Safety report for good while this sheet told the child it was
     * saved. The draft IS the POST body and it is stored whole, because the
     * relay deduplicates on (user, lessonId, beatId, at) and a replay that
     * rebuilds any of it files a different row. App.tsx sends these back.
     *
     * WHO IT BELONGS TO IS ASKED FOR ONCE, AND ONLY ON THIS BRANCH. A replay
     * POSTs under whoever is signed in when it runs, so on a shared phone the
     * stamp is the only thing standing between one child's distress report and
     * another child's name (stores/flags.ts PendingReport). It is resolved
     * AFTER the POST rather than before it because `relayFetch` mints the
     * anonymous identity on its way out — asking first, on a fresh device,
     * would read null and record the report as unclaimed.
     *
     * markSent on the other branches covers the retry button below: a report
     * that lands on the second attempt must not stay queued for a third, and
     * one the relay has refused outright must not be queued at all.
     */
    if (result === 'kept') {
      // The PERSISTED session, not `currentAccount()`. That one asks the network,
      // and a kept report is by definition often written with no network — so it
      // answered "nobody" for a signed-in child and the replay filed their report
      // under the next child at the kiosk. See stores/flags.ts's owner docblock.
      const who = await accountFromStoredSession().catch(() => ({ known: false }) as const);
      markUnsent(at, {
        draft,
        owner: who.known ? (who.account?.id ?? null) : UNKNOWN_OWNER,
      });
    } else markSent(at);

    setOutcome(result);
    setSending(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={place === 'app' ? 'Report something' : 'Report something in this class'}
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/50 px-4 pb-4 sm:pb-0"
    >
      <div className="w-full max-w-md bg-surface-container-lowest rounded-[24px] p-card-padding shadow-lg font-body-md">
        {outcome !== null ? (
          <ReportDone
            outcome={outcome}
            why={why}
            hasNote={note.trim().length > 0}
            sending={sending}
            onRetry={() => void send()}
            onClose={onClose}
            closeLabel={place === 'app' ? 'Back' : 'Back to the class'}
          />
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
