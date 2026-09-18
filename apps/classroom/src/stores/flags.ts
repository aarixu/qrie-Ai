import { createLocalStore } from './localStore';
/**
 * TYPE-ONLY, and therefore not an import at all once this is built.
 *
 * The pending report's shape is the relay's POST body, and it belongs beside
 * the code that sends it — ui/ReportSheet.tsx already explains why it spells
 * the four kinds out rather than importing them from `@ai-tutor/relay`. A
 * third copy of that shape here is exactly how two of them drift, so this file
 * borrows the one that exists. `import type` is erased by the bundler, so the
 * runtime edge stays one-way: the sheet imports this store, never the reverse.
 */
import type { ReportDraft, ReportOutcome } from '../ui/ReportSheet';

/**
 * WHAT THE SAFETY LAYER SAW, KEPT ON THE DEVICE.
 *
 * A moderation layer with no record is a moderation layer nobody can check.
 * But this repo already made a decision about children's words that this must
 * not quietly undo — apps/agent/src/worker.ts, on LiveKit's recording flags:
 *
 *   "Our students are children between 11 and 18. Their voices and their
 *    doubts do not leave the room they were spoken in."
 *
 * So the log is LOCAL, and it holds the least it can: what kind of thing
 * happened, when, and which lesson — never the sentence itself. A distress
 * flag on a phone is enough for a parent to know a conversation happened; the
 * transcript of a child's worst moment sitting in localStorage is not
 * something this product should own.
 *
 * A REPORT is different, and is the student's own act: they press a button,
 * they choose to send it, and only then does anything leave the device. That
 * is what the store review is asking for — not surveillance, a way out.
 */

export type FlagKind =
  /** The child said something that needs a person, not a tutor. */
  | 'distress'
  /** Something outside school work; she redirected. */
  | 'redirect'
  /** A phone number, an address, or an instruction was taken out. */
  | 'cleaned'
  /** The student pressed Report. */
  | 'reported';

export interface Flag {
  kind: FlagKind;
  /** ISO, so a parent reading it sees a date and not a number. */
  at: string;
  /** The lesson it happened in, when there was one. */
  lessonId?: string;
  /**
   * For a report only, and only because the student typed it themselves.
   * Nothing the safety screen matched is ever stored.
   */
  note?: string;
  /**
   * FOR A 'reported' FLAG THAT HAS NOT REACHED ANYBODY YET.
   *
   * `fileReport` answers an outcome and nothing used to read 'kept' back, so
   * one 503 or one moment without signal dropped a child's Safety report
   * permanently while the sheet told them it was saved. Saved is not read.
   *
   * WHY A SECOND COPY OF ROUGHLY THE SAME WORDS IS ON THE DEVICE. `note` above
   * is the child's own text, unscrubbed, kept because they chose to write it
   * and for them to show a parent. `unsent.draft` is the SCRUBBED copy that
   * travels — phone numbers and email addresses already replaced. They are
   * different strings with different jobs, and merging them would mean either
   * sending the raw one or altering what the child can show at home.
   */
  unsent?: PendingReport;
}

/**
 * A REPORT WAITING FOR A NETWORK, AND WHO IT BELONGS TO.
 *
 * `draft` IS THE POST BODY, HELD WHOLE, because that is what a retry has to
 * send back byte for byte: the relay's idempotency key is
 * (user, lessonId, beatId, at), so a replay that rebuilds the draft — above
 * all one that re-stamps `at` — files a second row and an operator reads one
 * child's report twice. Every field the request carries is in there, including
 * the three that used to be recomputed at send time; ui/ReportSheet.tsx says
 * what went wrong when they were not.
 *
 * `owner` IS THE OTHER HALF OF THAT, and it is not part of the body.
 *
 * A replay POSTs under whoever is signed in at the moment it runs, because
 * that is whose token lib/relay.ts attaches and whose id the relay stamps the
 * row with. On a contest kiosk or a family phone the child who opens the app
 * next is a DIFFERENT child, so without this a distress report written by one
 * of them is filed against the other — and the first child's never reaches
 * anybody under their own name.
 *
 * lib/ledgerSync.ts solves exactly this for the event outbox by claiming it
 * before it drains, under a comment naming the shared phone. `handOverDevice`
 * would in fact clear this log on a handover, but it runs on a different async
 * chain from the replay and nothing sequences the two, so ordering is not
 * something this can lean on. The stamp is correct whatever order they run in.
 *
 * THERE ARE THREE ANSWERS HERE AND AN EARLIER VERSION HAD TWO, which is what
 * made this hole. It said "NULL MEANS UNCLAIMED, not unknown: nobody was signed
 * in when the report was written". That was false in the commonest case. The
 * stamp came from `currentAccount()`, which calls `getUser` — a network request
 * that, offline, answers `null` for a child who is perfectly well signed in. And
 * offline is precisely what CREATES a kept report. So the dominant path stamped
 * "unclaimed" and the replay then filed one child's distress report under the
 * next child at the kiosk: the exact leak this stamp exists to close.
 *
 * So the writer now reads the PERSISTED session instead (lib/supabase.ts
 * `accountFromStoredSession`), which needs no network, and the three answers are
 * kept apart:
 *
 *   - a uuid   — this child wrote it. Send only to them; discard if a DIFFERENT
 *                child is here, because their report cannot go out under
 *                somebody else's name; wait while nobody is here.
 *   - null     — there was no session in storage. Nobody was signed in, so
 *                nobody else has a claim on it and it may go under whoever
 *                sends it. This is the narrow, honest version of what the old
 *                comment claimed for everything.
 *   - UNKNOWN  — storage or a token refresh failed and we CANNOT TELL. Never
 *                sent automatically and never discarded: it waits on the device,
 *                where the sheet's own "try sending it again" button can put it
 *                out under a person who is actually present and choosing to.
 *
 * stores/localStore.ts:199 draws a superficially similar line, and the old
 * comment borrowed it. It does not transfer: its `previous === null` is a
 * synchronous localStorage read that cannot fail for network reasons.
 */

/**
 * Stamped when we could not work out who was here. A uuid can never collide
 * with it, and it is deliberately not `null`, because `null` is now a claim
 * ("nobody") rather than an absence of one.
 */
export const UNKNOWN_OWNER = 'unknown';

export interface PendingReport {
  draft: ReportDraft;
  owner: string | null;
}

export interface FlagLog {
  flags: Flag[];
}

/**
 * Bounded. This is a safety net, not an archive, and an unbounded array in
 * localStorage is a store that eventually refuses to write anything at all.
 */
const KEEP = 50;

/**
 * `neverSync` is load-bearing, not decoration.
 *
 * Registration into the sync map is automatic, so for its first weeks this log
 * was being pushed to `student_state` — every distress flag, and the note a
 * student typed into a report — in flat contradiction of the paragraph above
 * it. The rule was written down and the default quietly won.
 */
export const flagStore = createLocalStore<FlagLog>('flags', { flags: [] }, { neverSync: true });

export function recordFlag(flag: Flag): void {
  flagStore.update((log) => ({ flags: [flag, ...log.flags].slice(0, KEEP) }));
}

// ----------------------------------------------- a report that has not gone --

/**
 * Change one 'reported' flag, found by the stamp the sheet minted for it.
 *
 * `at` is the key rather than an index because it is already the identifier
 * this report is known by everywhere else — it is part of the relay's
 * idempotency key — and because the log is prepended to, so an index moves.
 */
function amendReport(at: string, change: (flag: Flag) => Flag): void {
  flagStore.update((log) => ({
    flags: log.flags.map((flag) =>
      flag.kind === 'reported' && flag.at === at ? change(flag) : flag,
    ),
  }));
}

/**
 * Remember that this report did not reach anybody, and what it was.
 *
 * Called after `fileReport` answers 'kept'. The flag itself was written
 * moments earlier, before anything was sent — that ordering is the sheet's
 * oldest rule and it is what makes this an amendment rather than a write.
 */
export function markUnsent(at: string, pending: PendingReport): void {
  amendReport(at, (flag) => ({ ...flag, unsent: pending }));
}

/** Take the queued POST off a flag, leaving the child's own record standing. */
function forgetPending(at: string): void {
  amendReport(at, (flag) => {
    // Deleted rather than set to undefined: this shape is JSON.stringify'd
    // into localStorage, and an explicit undefined and an absent key read back
    // the same. Removing it keeps the stored row the size it was before.
    const settled = { ...flag };
    delete settled.unsent;
    return settled;
  });
}

/**
 * It landed. Forget the pending copy, keep the flag.
 *
 * The flag is the child's own record of having reported something and is not
 * what was unsent; only the queued POST goes.
 */
export function markSent(at: string): void {
  forgetPending(at);
}

/**
 * IT WILL NEVER LAND, SO STOP ASKING. Same mechanics as `markSent` and a
 * different event, which is why it has its own name: nobody has read this one.
 *
 * Two things reach it. A body the relay REFUSES (400, 405, 413 —
 * packages/relay/src/report.ts) gets the same answer however many times it is
 * sent, so a queue that keeps trying is a queue that lies to the child in the
 * confirmation copy. And a report belonging to a PREVIOUS occupant of a shared
 * phone must not be filed under the child sitting here now.
 *
 * The child's own unscrubbed copy is untouched in both cases. That is the
 * point of keeping the flag: they can still show a parent what they wrote.
 */
export function discardUnsent(at: string): void {
  forgetPending(at);
}

/** Every report still waiting, oldest first — the order they happened in. */
export const unsentReports = (log: FlagLog): PendingReport[] =>
  log.flags
    .filter((flag): flag is Flag & { unsent: PendingReport } => flag.unsent !== undefined)
    .map((flag) => flag.unsent)
    .reverse();

/**
 * SEND WHAT IS WAITING, AND SAY HOW MANY LANDED AND HOW MANY WERE NOT OURS.
 *
 * The sender is passed IN rather than imported. Two reasons, and the second is
 * the bigger one: this store must not import a React component (the runtime
 * edge runs the other way), and App.tsx can then reach for ui/ReportSheet
 * lazily — a phone with nothing waiting never loads the sheet's chunk just to
 * find that out.
 *
 * ONE REFUSAL DOES NOT STOP THE QUEUE. A report the relay will not take right
 * now would otherwise sit at the head of it forever with a child's later
 * report behind it. Each one is independent and is tried on its own; the cost
 * of getting this wrong is a report nobody reads, and the cost of getting it
 * right is at most a handful of failed fetches on a phone with no signal.
 *
 * NOTHING AGES OUT ON TIME. A report queued offline for three days is still a
 * report — packages/relay/src/report.ts says exactly that, and refuses a
 * server-side skew window for the same reason. Only two things take one off
 * the queue unsent, both of them about whether sending it could ever work or
 * could ever be right: see `discardUnsent`. The remaining bound is the flag
 * log's own KEEP.
 *
 * `owner` IS WHO IS SIGNED IN NOW, resolved by the caller. Three answers:
 *
 *   - the report is unclaimed, or it is theirs — send it;
 *   - it belongs to somebody else — discard it rather than file a child's
 *     report under the wrong name (lib/ledgerSync.ts does the same for the
 *     event outbox, and reports the count the same way);
 *   - we do not know who is here (offline, or no project configured) — WAIT.
 *     Sending risks the wrong name and discarding loses a child's report, so
 *     the answer that cannot be wrong is to leave it where it is.
 */
export async function replayUnsent(
  send: (report: ReportDraft) => Promise<ReportOutcome>,
  owner: string | null,
): Promise<{ sent: number; discarded: number }> {
  const waiting = unsentReports(flagStore.get());
  let sent = 0;
  let discarded = 0;
  for (const pending of waiting) {
    // We could not tell who wrote it. Sending it would be a guess at a child's
    // name on a distress report, and discarding it would throw the report away
    // to avoid that guess. Neither is ours to do automatically: it stays, and
    // the sheet's retry button lets a present human send it deliberately.
    if (pending.owner === UNKNOWN_OWNER) continue;

    if (pending.owner !== null && pending.owner !== owner) {
      if (owner === null) continue;
      discardUnsent(pending.draft.at);
      discarded += 1;
      continue;
    }

    let outcome: ReportOutcome;
    try {
      outcome = await send(pending.draft);
    } catch {
      // Offline, or the relay is unreachable. The copy on this device stands.
      outcome = 'kept';
    }
    if (outcome === 'kept') continue;
    if (outcome === 'sent') {
      markSent(pending.draft.at);
      sent += 1;
    } else {
      discardUnsent(pending.draft.at);
    }
  }
  return { sent, discarded };
}

/** Whether anything has ever been flagged — what Help uses to offer a way on. */
export const hasFlags = (log: FlagLog): boolean => log.flags.length > 0;

/** Most recent first, which is the only order a person reads this in. */
export const recentFlags = (log: FlagLog, limit = 10): Flag[] => log.flags.slice(0, limit);
