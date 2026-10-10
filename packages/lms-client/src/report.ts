import type { Transport } from './transport.ts';

/**
 * A STUDENT'S REPORT FROM THE STUDENT APP (plan 5, lms.report_problem, 0067).
 *
 * The Help sheet in apps/student files a report into the same queue the
 * tutor's report button fills. The note arrives already scrubbed on the
 * device (apps/student/src/lib/report.ts); the server checks its length and
 * keeps it as sent.
 */
export type ProblemKind = 'wrong' | 'rude' | 'unsafe' | 'other';
export type ProblemPlace = 'home' | 'work' | 'homework' | 'learn' | 'practice' | 'progress' | 'notices';

export interface ProblemReport {
  kind: ProblemKind;
  /** Already scrubbed on the device (apps/student/src/lib/report.ts); at most 500 characters; may be empty. */
  note: string;
  where: ProblemPlace;
  /** The homework's id when the report is about one; otherwise null. */
  itemId: string | null;
  platform: 'web' | 'android';
  release: string | null;
  /** ISO, stamped once when the child pressed Send; a retry sends the same value. */
  at: string;
}

/** Files the report and answers its id; the same `at` again answers the same id. */
export async function reportProblem(t: Transport, r: ProblemReport): Promise<string> {
  return String(
    await t.value('report_problem', {
      p_kind: r.kind,
      p_note: r.note,
      p_where: r.where,
      p_item: r.itemId,
      p_platform: r.platform,
      p_release: r.release,
      p_at: r.at,
    }),
  );
}
