import type { PGlite } from '@electric-sql/pglite';
import { handIn, ledgerEvent, markAttendance, publish } from './admin-school-fixtures.ts';
import { seat, type School } from './fixtures.ts';
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

/** A homework photo in the private `lms-work` bucket at <org>/<assignment>/<student>/<file>, as 0025 stores one. */
export async function photo(db: PGlite, org: string, assignment: string, student: string, file = 'page-1.jpg'): Promise<string> {
  const name = `${org}/${assignment}/${student}/${file}`;
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('lms-work', $1, $2)`, [name, student]);
  return name;
}

let parents = 0;

/**
 * One row in each of these tables a school child's records reach: a sitting and its
 * ledger event, a usage row, a saved state, a report, a consent record, a
 * contest entry, a homework handed in with a photo, an attendance mark, a
 * teacher's comment, a notice read, a parent linked to them, and a line in the
 * school's activity log naming their login ID. Written as the database owner.
 */
export async function populateChild(
  db: PGlite,
  school: School,
  kid: string,
): Promise<{ login: string; parent: string; assignment: string; photo: string }> {
  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
  const { login } = await one<{ login: string }>(`select login_id as login from lms.account where user_id = $1`, [kid]);
  const { code } = await one<{ code: string }>(`select code from lms.school where org_id = $1`, [school.org]);
  await ledgerEvent(db, school.org, kid);
  await db.query(`insert into public.usage_event (user_id, relay, provider, status) values ($1, 'llm', 'vertex', 200)`, [kid]);
  await db.query(`insert into public.student_state (user_id, key, value, updated_at) values ($1, 'profile', '{}', 1)`, [kid]);
  await report(db, kid, { note: 'a private note' });
  await db.query(
    `insert into public.consent_record (user_id, parent_name, parent_phone, source, otp_verified_at)
     values ($1, 'A parent', '+919876543210', 'contest', now())`,
    [kid],
  );
  await db.query(`insert into public.contest_signup (user_id, student_name, klass, city) values ($1, 'Riya', 8, 'Pune')`, [kid]);
  const assignment = await publish(db, school, 2);
  await handIn(db, school.org, assignment, kid);
  const photoName = await photo(db, school.org, assignment, kid);
  await markAttendance(db, school, kid, 1);
  await db.query(
    `insert into lms.work_comment (assignment_id, student_user_id, org_id, text, written_by) values ($1, $2, $3, 'Good work', $4)`,
    [assignment, kid, school.org, school.teacherA],
  );
  const { id: notice } = await one<{ id: string }>(
    `insert into lms.notice (org_id, academic_year_id, whole_school, title, body, created_by)
     values ($1, $2, true, 'Holiday', 'School is closed on Friday.', $3) returning id`,
    [school.org, school.year, school.admin],
  );
  await db.query(`insert into lms.notice_read (notice_id, user_id) values ($1, $2)`, [notice, kid]);
  const parent = await seat(db, school.org, 'parent', `${code}-PAR${++parents}`, 'A parent');
  await db.query(`insert into lms.guardian (parent_user_id, student_user_id, org_id) values ($1, $2, $3)`, [parent, kid, school.org]);
  await db.query(
    `insert into lms.audit_event (org_id, actor, action, target, details) values ($1, $2, 'pin-reset', $3, $4::jsonb)`,
    [school.org, school.admin, login, JSON.stringify({ loginId: login, by: 'admin' })],
  );
  return { login, parent, assignment, photo: photoName };
}
