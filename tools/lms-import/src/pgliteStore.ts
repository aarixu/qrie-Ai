import type { PGlite } from '@electric-sql/pglite';
import type { ImportStore } from './apply.ts';

/**
 * The import's store, backed by the migration harness's real Postgres. It
 * writes what the service role would, so 0021's triggers and 0022's
 * constraints judge every row exactly as they will in production. Used by the
 * import's tests and by the demo school (tools/lms-demo), never against the
 * hosted project.
 */
export function pgliteStore(db: PGlite): ImportStore {
  const one = async (sql: string, params: unknown[]): Promise<string | null> =>
    (await db.query<{ id: string }>(sql, params)).rows[0]?.id ?? null;

  return {
    async ensureSchool(cfg) {
      const found = await one(`select org_id as id from lms.school where code = $1`, [cfg.code]);
      if (found) return found;
      const org = (await one(`insert into public.organization (kind, name) values ('school', $1) returning id`, [
        cfg.displayName,
      ]))!;
      await db.query(
        `insert into lms.school (org_id, code, display_name, short_name, board) values ($1, $2, $3, $4, $5)`,
        [org, cfg.code, cfg.displayName, cfg.shortName ?? null, cfg.board],
      );
      return org;
    },
    async ensureYear(org, y) {
      return (
        (await one(`select id from lms.academic_year where org_id = $1 and label = $2`, [org, y.label])) ??
        (await one(
          `insert into lms.academic_year (org_id, label, starts_on, ends_on) values ($1, $2, $3, $4) returning id`,
          [org, y.label, y.startsOn, y.endsOn],
        ))!
      );
    },
    async ensureSubject(org, name) {
      return (
        (await one(`select id from lms.subject where org_id = $1 and name = $2`, [org, name])) ??
        (await one(`insert into lms.subject (org_id, name) values ($1, $2) returning id`, [org, name]))!
      );
    },
    async ensureSection(org, year, grade, name) {
      return (
        (await one(`select id from lms.section where academic_year_id = $1 and grade = $2 and name = $3`, [
          year,
          grade,
          name,
        ])) ??
        (await one(
          `insert into lms.section (org_id, academic_year_id, grade, name) values ($1, $2, $3, $4) returning id`,
          [org, year, grade, name],
        ))!
      );
    },
    async findAccount(org, loginId) {
      return one(`select user_id as id from lms.account where org_id = $1 and login_id = $2`, [org, loginId]);
    },
    async createAccount(a) {
      const user = (await one(
        `insert into auth.users (email, raw_app_meta_data) values ($1, $2::jsonb) returning id`,
        [a.email, JSON.stringify(a.appMetadata)],
      ))!;
      await db.query(`insert into public.membership (org_id, user_id, role) values ($1, $2, $3)`, [
        a.orgId,
        user,
        a.kind,
      ]);
      await db.query(
        `insert into lms.account (org_id, user_id, login_id, kind, display_name) values ($1, $2, $3, $4, $5)`,
        [a.orgId, user, a.loginId, a.kind, a.displayName],
      );
      return user;
    },
    async ensureTeaching(org, section, subject, teacher) {
      await db.query(
        `insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id)
         values ($1, $2, $3, $4) on conflict (section_id, subject_id, teacher_user_id) do nothing`,
        [org, section, subject, teacher],
      );
    },
    async activeEnrolment(year, student) {
      const { rows } = await db.query<{ sectionId: string; grade: number; name: string }>(
        `select e.section_id as "sectionId", s.grade, s.name
           from lms.enrolment e join lms.section s on s.id = e.section_id
          where e.academic_year_id = $1 and e.student_user_id = $2 and e.left_on is null`,
        [year, student],
      );
      return rows[0] ?? null;
    },
    async enrol(org, year, section, student, roll) {
      await db.query(
        `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
         values ($1, $2, $3, $4, $5)`,
        [org, year, section, student, roll],
      );
    },
  };
}
