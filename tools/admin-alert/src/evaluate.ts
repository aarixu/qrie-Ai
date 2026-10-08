/**
 * WHEN TO WAKE A PERSON. A pure function from the snapshot to messages.
 *
 * The checker runs every 5 minutes and keeps no state, so repeats are paced by
 * the clock: a rule with a window of N minutes fires in any run that lands in
 * the first DUE_SPAN_MINUTES of each N-minute block. That span is three runs
 * wide because schedulers drift: a duplicate is cheap, a missed alarm is not. A
 * rule with no window fires on every run: an unread unsafe report, and a
 * checker that cannot reach the database, stay loud until somebody acts.
 *
 * A distress flag (plan 5) also has no window: it speaks to the safety chat on
 * every run while the database counts a flag received in the last 15 minutes,
 * so one flag speaks on the runs of its first 15 minutes (three, when runs
 * are 5 minutes apart) and then the count falls to zero.
 *
 * Messages carry counts and ages and nothing that names a school, a lesson, a
 * child or a word of what a child wrote. Safety and operations go to different
 * chats, with different people. A checker that cannot see goes to both, because
 * a blind alarm is a safety problem too.
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
  /** Distress flags received in the last 15 minutes (0065). Absent from a database before 0065. */
  distressFlags15m?: number;
}

/** What the database answers: the snapshot, or `{ error }` for a refused token. */
export type SnapshotAnswer = Snapshot | { error: string };

export interface Alert {
  channel: 'safety' | 'ops';
  /** Stable name of the rule, for logs. */
  key: string;
  text: string;
}

/** How often the checker is scheduled to run. */
export const RUN_EVERY_MINUTES = 5;

/** A windowed rule fires in any run within this many minutes of its block's start. */
export const DUE_SPAN_MINUTES = 3 * RUN_EVERY_MINUTES;

const due = (nowMinutes: number, windowMinutes: number): boolean =>
  windowMinutes <= 0 || nowMinutes % windowMinutes < DUE_SPAN_MINUTES;

const isSnapshot = (a: SnapshotAnswer): a is Snapshot => !('error' in a);

export function evaluate(answer: SnapshotAnswer | null, nowMinutes: number): Alert[] {
  const out: Alert[] = [];
  const ops = (key: string, windowMinutes: number, text: string) => {
    if (due(nowMinutes, windowMinutes)) out.push({ channel: 'ops', key, text: `Qrie ops: ${text}` });
  };
  const both = (key: string, windowMinutes: number, text: string) => {
    if (!due(nowMinutes, windowMinutes)) return;
    out.push({ channel: 'ops', key, text: `Qrie ops: ${text}` });
    out.push({ channel: 'safety', key, text: `Qrie safety: ${text}` });
  };

  if (answer === null) {
    both('unreachable', 0, 'the alarm could not reach the database.');
    return out;
  }
  if (!isSnapshot(answer)) {
    both('token-refused', 60, `the alarm was refused (${answer.error}).`);
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

  const distress = answer.distressFlags15m ?? 0;
  if (distress > 0) {
    out.push({
      channel: 'safety',
      key: 'distress-flag',
      text: `Qrie safety: ${distress} distress flag(s) in the last 15 minutes. No words are kept. Open the Safety page.`,
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
