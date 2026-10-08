import type { PGlite } from '@electric-sql/pglite';
import { asService } from './harness.ts';

/**
 * Plan 5's fixtures: distress flags, reports, classes and a child's records,
 * written the way the relay and the LMS write them.
 */

/** Keeps one distress flag through public.keep_safety_event as the service role, as the relay does. */
export async function keepFlag(
  db: PGlite,
  user: string,
  over: Partial<{ id: string; direction: 'from-student' | 'to-student'; at: string }> = {},
): Promise<boolean | null> {
  return asService(db, async (tx) => {
    const { rows } = await tx.query<{ kept: boolean | null }>(
      `select public.keep_safety_event($1, $2, 'distress', $3, 'web', 'test-build', coalesce($4::timestamptz, now())) as kept`,
      [user, over.id ?? crypto.randomUUID(), over.direction ?? 'from-student', over.at ?? null],
    );
    return rows[0].kept;
  });
}

let reportClock = 0;

/**
 * A child's report, kept through public.keep_student_report as the service
 * role (as the relay keeps one), then received `receivedMinutesAgo` minutes
 * back. Each call gets its own `at`, so no two collide on 0019's key.
 */
export async function report(
  db: PGlite,
  user: string,
  over: Partial<{
    kind: 'wrong' | 'rude' | 'unsafe' | 'other';
    note: string;
    lessonId: string;
    topicRef: string | null;
    beatId: string | null;
    spokenLine: string | null;
    sessionId: string | null;
    receivedMinutesAgo: number;
  }> = {},
): Promise<string> {
  const at = new Date(Date.UTC(2026, 9, 1) + ++reportClock * 1000).toISOString();
  const id = await asService(db, async (tx) => {
    const { rows } = await tx.query<{ report_id: string }>(
      `select report_id from public.keep_student_report($1, $2, $3, $4, $5, $6, $7, $8, 'test-build', 'web', $9::timestamptz)`,
      [
        user,
        over.kind ?? 'wrong',
        over.note ?? 'a private note',
        over.lessonId ?? 'L1',
        over.topicRef ?? null,
        over.beatId ?? null,
        over.spokenLine ?? null,
        over.sessionId ?? null,
        at,
      ],
    );
    return rows[0].report_id;
  });
  if (over.receivedMinutesAgo !== undefined) {
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(`update public.student_report set received_at = now() - make_interval(mins => $2::int) where id = $1`, [
        id,
        over.receivedMinutesAgo,
      ]);
    });
  }
  return id;
}

/** Sets columns of a report directly, as the database owner, with the session on. */
export async function setReport(db: PGlite, id: string, sql: string, params: unknown[] = []): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('admin.session', 'on', true)`);
    await tx.query(`update public.student_report set ${sql} where id = $1`, [id, ...params]);
  });
}

/**
 * A kept class: a prepared_class row and its files in the `classes` bucket at
 * <id>/<file>, as the relay's keepClass leaves them. Written as the database owner.
 */
export async function classRow(
  db: PGlite,
  id: string,
  over: Partial<{ status: 'pending' | 'published' | 'retracted'; topicRef: string; files: string[] }> = {},
): Promise<void> {
  await db.query(
    `insert into public.prepared_class (id, topic_ref, title, subtitle, klass, subject, review_status)
     values ($1, $2, $3, 'A subtitle', 8, 'science', $4)`,
    [id, over.topicRef ?? `topic/${id}`, `Title of ${id}`, over.status ?? 'published'],
  );
  for (const file of over.files ?? ['manifest.json']) {
    await db.query(`insert into storage.objects (bucket_id, name) values ('classes', $1)`, [`${id}/${file}`]);
  }
}
