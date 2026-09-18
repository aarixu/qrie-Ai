import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNKNOWN_OWNER,
  discardUnsent,
  flagStore,
  markSent,
  markUnsent,
  recordFlag,
  replayUnsent,
  unsentReports,
} from '../src/stores/flags';
import type { ReportDraft } from '../src/ui/ReportSheet';

/**
 * A KEPT REPORT MUST EVENTUALLY GO — AND MUST GO AS ITSELF.
 *
 * `fileReport` has always answered an outcome and until Wave 4 nothing read
 * 'kept' back: one 503, one moment with no signal, and a child's Safety report
 * sat on the phone for good while the sheet told them it was saved. The
 * sheet's own "try again" button only helps a child who is still looking at it.
 *
 * THREE THINGS THESE TESTS GUARD HARDEST.
 *
 *   - THE TIMESTAMP. The relay's idempotency key is
 *     (user, lessonId, beatId, at) — packages/relay/src/report.ts, the `at` IS
 *     THE CLIENT'S paragraph — so a replay that re-stamps `at` files a SECOND
 *     row and an operator reads one child's report twice.
 *   - THE WHOLE BODY. `sessionId`, `release` and `platform` used to be
 *     recomputed inside `fileReport` at send time, so a replayed report was
 *     stamped with the sitting and the build that happened to be current when
 *     the phone next opened — the stores/ledger.ts defect ("one sitting
 *     carrying another sitting's ten rupees") re-created on the report path.
 *     They are stamped at the tap now and they travel in the draft.
 *   - WHOSE REPORT IT IS. A kept report is POSTed under whoever is signed in
 *     at replay time. On a shared phone that is a different child, so the
 *     marker carries the owner and the replay refuses to file one child's
 *     distress report under another child's name — the same rule
 *     lib/ledgerSync.ts already applies to the ledger outbox.
 */

const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'unsafe',
  note: 'she kept talking about something scary',
  lessonId: 'class10-blood',
  topicRef: 'class10-science/blood/plasma',
  beatId: 'b4',
  spokenLine: 'Blood carries oxygen around the body.',
  sessionId: '407e6546-54db-421e-afa9-a3d0fb54dbbf',
  release: '2026.09.1',
  platform: 'web',
  at: '2026-09-18T04:00:00.000Z',
  ...over,
});

/** What the sheet does when the relay refuses: keep the flag, mark it unsent. */
const keptOnDevice = (
  over: Partial<ReportDraft> = {},
  owner: string | null = null,
): ReportDraft => {
  const pending = draft(over);
  recordFlag({ kind: 'reported', at: pending.at, lessonId: pending.lessonId, note: 'a note' });
  markUnsent(pending.at, { draft: pending, owner });
  return pending;
};

/** The ordinary case: nobody is signed in, and nothing was stamped to anybody. */
const unclaimed = (send: (r: ReportDraft) => Promise<'sent' | 'kept' | 'refused'>) =>
  replayUnsent(send, null);

beforeEach(() => {
  localStorage.clear();
  flagStore.set({ flags: [] });
});

describe('the marker on a report that did not go', () => {
  it('remembers one, and hands back exactly what was meant to be POSTed', () => {
    const pending = keptOnDevice();
    expect(unsentReports(flagStore.get())).toEqual([{ draft: pending, owner: null }]);
  });

  it('holds the sitting and the build the report was MADE in', () => {
    const pending = keptOnDevice();
    const [waiting] = unsentReports(flagStore.get());
    expect(waiting?.draft.sessionId).toBe(pending.sessionId);
    expect(waiting?.draft.release).toBe('2026.09.1');
    expect(waiting?.draft.platform).toBe('web');
  });

  it('is cleared once it lands, so it is never sent a second time', () => {
    const pending = keptOnDevice();
    markSent(pending.at);
    expect(unsentReports(flagStore.get())).toEqual([]);
    // The flag itself stays: the child's own local copy is not what was unsent.
    expect(flagStore.get().flags).toHaveLength(1);
  });

  it('is cleared, and the flag kept, when the app gives up on sending it too', () => {
    const pending = keptOnDevice();
    discardUnsent(pending.at);
    expect(unsentReports(flagStore.get())).toEqual([]);
    expect(flagStore.get().flags).toHaveLength(1);
  });

  /**
   * The guard this names lives in `amendReport` — only a 'reported' flag is
   * amendable. Asserting on a freshly recorded flag would be vacuous (a new
   * flag has no `unsent` field whatever its kind), so `markUnsent` is actually
   * called against a distress flag and must do nothing.
   */
  it('leaves an ordinary flag alone — only a report can be unsent', () => {
    recordFlag({ kind: 'distress', at: '2026-09-18T05:00:00.000Z' });
    markUnsent('2026-09-18T05:00:00.000Z', { draft: draft(), owner: null });
    expect(unsentReports(flagStore.get())).toEqual([]);
    expect(flagStore.get().flags[0]?.unsent).toBeUndefined();
  });
});

describe('replaying on app open', () => {
  it('sends a kept report with the ORIGINAL stamp, never a fresh one', async () => {
    const pending = keptOnDevice({ at: '2026-09-01T09:30:00.000Z' });
    const seen: ReportDraft[] = [];

    const { sent } = await unclaimed(async (report) => {
      seen.push(report);
      return 'sent';
    });

    expect(sent).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.at).toBe('2026-09-01T09:30:00.000Z');
    expect(seen[0]).toEqual(pending);
  });

  it('forgets it afterwards, so the next open does not file it again', async () => {
    keptOnDevice();
    await unclaimed(async () => 'sent');
    const second: ReportDraft[] = [];
    await unclaimed(async (report) => {
      second.push(report);
      return 'sent';
    });
    expect(second).toEqual([]);
  });

  it('keeps it when the relay refuses again — a refusal must never lose it', async () => {
    const pending = keptOnDevice();
    const { sent } = await unclaimed(async () => 'kept');

    expect(sent).toBe(0);
    expect(unsentReports(flagStore.get())).toEqual([{ draft: pending, owner: null }]);
  });

  it('keeps it when the send throws, which is what offline looks like', async () => {
    keptOnDevice();
    await unclaimed(async () => {
      throw new Error('offline');
    });
    expect(unsentReports(flagStore.get())).toHaveLength(1);
  });

  /**
   * A body the relay has REFUSED — a 400, a 405, a 413 — is the one case where
   * trying again cannot help: the same bytes get the same answer, for the life
   * of the install, while the child is told the app will keep trying. It stops
   * queueing. The child's own copy of what they wrote is untouched.
   */
  it('stops queueing a report the relay will never accept, and keeps the child’s copy', async () => {
    const pending = keptOnDevice();
    const { sent } = await unclaimed(async () => 'refused');

    expect(sent).toBe(0);
    expect(unsentReports(flagStore.get())).toEqual([]);
    expect(flagStore.get().flags.find((f) => f.at === pending.at)?.note).toBe('a note');
  });

  /**
   * One report that the relay will not take right now must not silence the
   * rest. Head-of-line blocking here means a child's later report waits behind
   * an earlier one that is going nowhere.
   */
  it('does not let one stuck report block the ones behind it', async () => {
    keptOnDevice({ at: '2026-09-01T09:00:00.000Z', beatId: 'b1' });
    keptOnDevice({ at: '2026-09-02T09:00:00.000Z', beatId: 'b2' });

    const { sent } = await unclaimed(async (report) => (report.beatId === 'b2' ? 'sent' : 'kept'));

    expect(sent).toBe(1);
    expect(unsentReports(flagStore.get()).map((r) => r.draft.beatId)).toEqual(['b1']);
  });

  it('asks nothing of the network when there is nothing waiting', async () => {
    let called = 0;
    const { sent } = await unclaimed(async () => {
      called += 1;
      return 'sent';
    });
    expect(called).toBe(0);
    expect(sent).toBe(0);
  });
});

/**
 * WHOSE REPORT IS THIS? — the contest-kiosk and family-phone case.
 *
 * lib/ledgerSync.ts already refuses to drain one child's outbox under the next
 * child's name, under a comment naming this exact scenario. The report replay
 * had no equivalent: child A reports something distressing, the relay 503s,
 * child A leaves, child B opens the app, and A's report is filed against B —
 * while A's never reaches anybody under A's name. The handover that would have
 * cleared the flag log runs on a different async chain, so ordering cannot be
 * relied on; the owner is stamped instead.
 */
describe('whose report is being sent', () => {
  it('files a report stamped to the child who is here', async () => {
    keptOnDevice({}, 'child-a');
    const seen: ReportDraft[] = [];
    const { sent, discarded } = await replayUnsent(async (r) => {
      seen.push(r);
      return 'sent';
    }, 'child-a');

    expect(sent).toBe(1);
    expect(discarded).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it('never files one child’s report under the next child’s name', async () => {
    keptOnDevice({}, 'child-a');
    const seen: ReportDraft[] = [];
    const { sent, discarded } = await replayUnsent(async (r) => {
      seen.push(r);
      return 'sent';
    }, 'child-b');

    expect(seen).toEqual([]);
    expect(sent).toBe(0);
    expect(discarded).toBe(1);
    expect(unsentReports(flagStore.get())).toEqual([]);
  });

  /**
   * A null stamp now means one narrow thing: there was NO SESSION IN STORAGE
   * when the report was written, so nobody was signed in and nobody else has a
   * claim on it.
   *
   * It used to mean that AND "we asked the network and it did not answer",
   * because the stamp came from `currentAccount()`. That made this test read as
   * a rule about unclaimed reports while the arm it exercised was mostly being
   * reached by signed-in children who happened to be offline — and they are the
   * ones who write kept reports. The writer reads the persisted session now
   * (lib/supabase.ts `accountFromStoredSession`), and the case it cannot answer
   * is stamped UNKNOWN_OWNER and tested two blocks down.
   */
  it('sends an unclaimed report under whoever is here', async () => {
    keptOnDevice({}, null);
    const seen: ReportDraft[] = [];
    await replayUnsent(async (r) => {
      seen.push(r);
      return 'sent';
    }, 'child-b');
    expect(seen).toHaveLength(1);
  });

  /**
   * Offline, or no project configured: we cannot tell who is here. Sending
   * would risk the wrong name and discarding would lose a child's report, so
   * it waits — the one answer that cannot be wrong.
   */
  it('waits rather than guessing when it cannot tell who is here', async () => {
    const pending = keptOnDevice({}, 'child-a');
    const seen: ReportDraft[] = [];
    const { sent, discarded } = await replayUnsent(async (r) => {
      seen.push(r);
      return 'sent';
    }, null);

    expect(seen).toEqual([]);
    expect(sent).toBe(0);
    expect(discarded).toBe(0);
    expect(unsentReports(flagStore.get())).toEqual([{ draft: pending, owner: 'child-a' }]);
  });

  /**
   * THE SHARED-PHONE LEAK, IN THE PATH THAT ACTUALLY REACHES IT.
   *
   * A stamp of UNKNOWN_OWNER means the writer could not work out who was here:
   * storage failed, or the token had expired and the refresh could not reach
   * anybody. That is not "nobody", and the two were the same value until this
   * landed — so a signed-in child's report, written offline, was stamped
   * unclaimed and then sent under whichever child opened the app next. On a
   * contest kiosk that is a different person's name on a distress report.
   *
   * Neither automatic answer is allowed here: sending guesses at a child's
   * name, discarding throws the report away to avoid guessing. It waits, and
   * the sheet's own retry button is how a person who is actually present sends
   * it.
   */
  it('never sends an UNKNOWN_OWNER report under whoever is here, and never drops it', async () => {
    const pending = keptOnDevice({}, UNKNOWN_OWNER);
    const seen: ReportDraft[] = [];
    const { sent, discarded } = await replayUnsent(async (r) => {
      seen.push(r);
      return 'sent';
    }, 'child-b');

    expect(seen).toEqual([]);
    expect(sent).toBe(0);
    expect(discarded).toBe(0);
    // Still on the device, still stamped, still reachable from the sheet.
    expect(unsentReports(flagStore.get())).toEqual([{ draft: pending, owner: UNKNOWN_OWNER }]);
  });

  it('holds an UNKNOWN_OWNER report when nobody is signed in either', async () => {
    keptOnDevice({}, UNKNOWN_OWNER);
    const { sent, discarded } = await replayUnsent(async () => 'sent', null);
    expect(sent).toBe(0);
    expect(discarded).toBe(0);
  });
});

/**
 * AND THE WIRE FROM THE APP OPENING TO THE SEND.
 *
 * Wave 3 could not do this half: triggering a replay needs App.tsx, which was
 * a sibling file mid-edit then, so the marker had nowhere to be read from. The
 * function is exported rather than left inside the effect so this can assert
 * the real path — the real `fileReport`, the real relay call — with only the
 * network faked.
 */
describe('what the app does when it opens', () => {
  const calls: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return Promise.resolve({
        ok: true,
        status: 202,
        json: () => Promise.resolve({ id: 'a-report-id' }),
      } as Response);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const reports = () => calls.filter((c) => c.url.includes('/api/report'));

  it('files a report that was kept, with the stamp it was kept under', async () => {
    const { replayKeptReports } = await import('../src/App');
    const pending = keptOnDevice({ at: '2026-09-01T09:30:00.000Z' });

    await replayKeptReports();

    const posted = reports()[0];
    expect(posted).toBeDefined();
    const body = JSON.parse(String(posted?.init.body)) as Record<string, unknown>;
    expect(body.at).toBe(pending.at);
    expect(body.note).toBe(pending.note);
    expect(body.beatId).toBe(pending.beatId);
    expect(unsentReports(flagStore.get())).toEqual([]);
  });

  /**
   * The field that went wrong before this test existed. `fileReport` called
   * `currentSessionId()` at send time, so a replay on app open filed the
   * report with `null` — or, on a reload with a sitting still open, with the
   * uuid of an UNRELATED lesson, which report.ts stores without complaint
   * because it is well-formed.
   */
  it('files it against the sitting and the build it was MADE in', async () => {
    const { replayKeptReports } = await import('../src/App');
    const pending = keptOnDevice({ sessionId: '407e6546-54db-421e-afa9-a3d0fb54dbbf' });

    await replayKeptReports();

    const body = JSON.parse(String(reports()[0]?.init.body)) as Record<string, unknown>;
    expect(body.sessionId).toBe(pending.sessionId);
    expect(body.release).toBe(pending.release);
    expect(body.platform).toBe(pending.platform);
  });

  it('touches the network at all only when something is waiting', async () => {
    const { replayKeptReports } = await import('../src/App');
    await replayKeptReports();
    expect(calls).toEqual([]);
  });

  /**
   * <StrictMode> double-invokes the mount effect in development, and the extra
   * listeners below can fire while a drain is already running. Both passes
   * would otherwise read the same snapshot and POST every kept report twice.
   * The relay deduplicates, so nothing was ever read twice — but the comment
   * said "once" and the code did not.
   */
  it('does not drain twice when it is called twice at the same moment', async () => {
    const { replayKeptReports } = await import('../src/App');
    keptOnDevice();

    await Promise.all([replayKeptReports(), replayKeptReports()]);

    expect(reports()).toHaveLength(1);
  });

  /**
   * THE CHILD IS PROMISED A RETRY, SO THE APP HAS TO BE LISTENING FOR ONE.
   *
   * A mount effect alone is not "as soon as your phone is back online": inside
   * the Capacitor shell, and in a browser tab left open, coming back RESUMES a
   * live WebView and React never remounts. lib/ledgerSync.ts has listened on
   * these two events since before this wave for the same reason.
   */
  it('tries again when the phone comes back online', async () => {
    const { watchForReportReplay } = await import('../src/App');
    const detach = watchForReportReplay();
    await new Promise((r) => setTimeout(r, 0));

    calls.length = 0;
    keptOnDevice({ at: '2026-09-03T09:00:00.000Z', beatId: 'b9' });
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 0));
    detach();

    expect(reports()).toHaveLength(1);
  });

  it('stops listening once it is detached', async () => {
    const { watchForReportReplay } = await import('../src/App');
    const detach = watchForReportReplay();
    await new Promise((r) => setTimeout(r, 0));
    detach();

    calls.length = 0;
    keptOnDevice({ at: '2026-09-04T09:00:00.000Z' });
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toEqual([]);
  });
});
