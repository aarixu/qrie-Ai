/**
 * WHEN TO WAKE A PERSON. A pure function from the snapshot to messages.
 *
 * The checker runs every 5 minutes and keeps no state, so repeats are paced by
 * the clock: a rule with a window of N minutes fires only in the first run of
 * each N-minute block. A rule with no window fires on every run: that is for
 * an unread unsafe report, which should be loud until somebody opens it.
 *
 * Messages carry counts and ages and nothing that names a school, a lesson, a
 * child or a word of what a child wrote. Safety and operations go to different
 * chats, with different people, and safety is never merged into the other.
 */
export interface Snapshot {
  at: string;
  halted: boolean;
  ceilingUnits: number;
  unitsToday: number;
  newReports: number;
  unsafeNewReports: number;
  oldestNewReportMinutes: number;
  pendingClasses: number;
  relayEvents5m: number;
  relayFailures5m: number;
}

/** What the database answers: the snapshot, or `{ error }` for a refused token. */
export type SnapshotAnswer = Snapshot | { error: string };

export interface Alert {
  channel: 'safety' | 'ops';
  /** Stable name of the rule, for logs. */
  key: string;
  text: string;
}

/** How often the checker runs. A windowed rule fires in the first run of its block. */
export const RUN_EVERY_MINUTES = 5;

const due = (nowMinutes: number, windowMinutes: number): boolean =>
  windowMinutes <= 0 || nowMinutes % windowMinutes < RUN_EVERY_MINUTES;

const isSnapshot = (a: SnapshotAnswer): a is Snapshot => !('error' in a);

export function evaluate(answer: SnapshotAnswer | null, nowMinutes: number): Alert[] {
  const out: Alert[] = [];
  const ops = (key: string, windowMinutes: number, text: string) => {
    if (due(nowMinutes, windowMinutes)) out.push({ channel: 'ops', key, text: `Qrie ops: ${text}` });
  };

  if (answer === null) {
    ops('unreachable', 15, 'the alarm could not reach the database.');
    return out;
  }
  if (!isSnapshot(answer)) {
    ops('token-refused', 60, `the alarm was refused (${answer.error}).`);
    return out;
  }

  if (answer.unsafeNewReports > 0) {
    out.push({
      channel: 'safety',
      key: 'unsafe-report',
      text: `Qrie safety: ${answer.unsafeNewReports} unsafe report(s) unread, the oldest ${answer.oldestNewReportMinutes} min. Open the panel.`,
    });
  } else if (answer.newReports > 0 && answer.oldestNewReportMinutes >= 120 && due(nowMinutes, 120)) {
    out.push({
      channel: 'safety',
      key: 'old-report',
      text: `Qrie safety: ${answer.newReports} report(s) unread, the oldest ${answer.oldestNewReportMinutes} min.`,
    });
  }

  if (answer.halted) ops('halted', 60, 'the tutor is stopped.');

  if (answer.ceilingUnits > 0) {
    const used = answer.unitsToday / answer.ceilingUnits;
    if (used >= 1) ops('ceiling-reached', 30, "today's ceiling is reached; the tutor is refusing requests.");
    else if (used >= 0.8) ops('ceiling-near', 60, `spend is at ${Math.round(used * 100)}% of today's ceiling.`);
  }

  if (answer.relayEvents5m >= 20) {
    const failed = answer.relayFailures5m / answer.relayEvents5m;
    if (failed >= 0.3) ops('failing', 30, `${Math.round(failed * 100)}% of tutor calls failed in the last 5 minutes.`);
  }

  return out;
}
