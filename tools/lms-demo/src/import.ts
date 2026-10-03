import type { PGlite } from '@electric-sql/pglite';
import type { ImportRequest, ImportResponse } from '../../../packages/lms-client/src/backend.ts';
import { applyPlan } from '../../lms-import/src/apply.ts';
import { pgliteStore } from '../../lms-import/src/pgliteStore.ts';
import { newPin } from '../../lms-import/src/pin.ts';
import { previewImport, type SchoolSnapshot } from '../../lms-import/src/portal.ts';
import { setPin } from './auth.ts';

/**
 * The school portal's "add people" and "new PIN", served by the demo
 * (POST /admin/import, POST /admin/reset-pin).
 *
 * The sheets are checked here, on the server, every time — what the admin's
 * browser showed is never trusted. A commit reads the school, checks the
 * sheets and makes every account, class and PIN in one transaction, so two
 * commits cannot both pass their checks against the same school, and a
 * failure part-way creates nobody.
 *
 * A new person's PIN leaves the server only in the answer to the commit. So
 * that a lost answer does not lose the PINs, the answer is kept in this
 * process's memory for 15 minutes under the key the admin's browser sent, and
 * a retry with that key from the same admin gets it again. A PIN lost for
 * good is replaced with "new PIN", whose answer carries the new one and which
 * signs the person out everywhere.
 */

export class ImportRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const KEPT_MS = 15 * 60 * 1000;
const KEY = /^[A-Za-z0-9-]{8,64}$/;
const kept = new Map<string, { until: number; response: ImportResponse }>();

async function adminOrg(db: PGlite, caller: string, what: string): Promise<string> {
  const { rows } = await db.query<{ org_id: string }>(
    `select org_id from lms.account where user_id = $1 and kind = 'admin'`,
    [caller],
  );
  if (!rows[0]) throw new ImportRefused(403, `Only the school admin can ${what}.`);
  return rows[0].org_id;
}

export async function importForAdmin(db: PGlite, caller: string, request: ImportRequest): Promise<ImportResponse> {
  for (const k of ['students', 'teachers'] as const) {
    if (request[k] !== undefined && typeof request[k] !== 'string') throw new ImportRefused(400, `${k} must be the text of a CSV.`);
  }
  if (request.importKey !== undefined && (typeof request.importKey !== 'string' || !KEY.test(request.importKey))) {
    throw new ImportRefused(400, 'That import key is not one this server gives meaning to.');
  }
  await adminOrg(db, caller, 'add people');

  const now = Date.now();
  for (const [k, v] of kept) if (v.until < now) kept.delete(k);
  const keptAs = request.importKey ? `${caller}/${request.importKey}` : null;
  if (request.commit === true && keptAs && kept.has(keptAs)) return kept.get(keptAs)!.response;

  const response = await db.transaction(async (tx) => {
    const t = tx as unknown as PGlite;
    const org = await adminOrg(t, caller, 'add people');
    const snapshot = await schoolSnapshot(t, org);
    const preview = previewImport(snapshot, { students: request.students, teachers: request.teachers });
    const checked: ImportResponse = {
      schoolCode: snapshot.config.code,
      errors: preview.errors,
      warnings: preview.warnings,
      people: preview.people,
      changes: preview.changes,
      committed: false,
      created: [],
      conflicts: [],
      seats: preview.seats,
      columns: preview.columns,
    };
    if (request.commit !== true || !preview.plan) return checked;
    if (preview.warnings.length > 0 && request.acceptWarnings !== true) {
      throw new ImportRefused(400, 'Read and accept the warnings first.');
    }
    const result = await applyPlan(preview.plan, pgliteStore(t));
    for (const c of result.created) await setPin(t, c.loginId, c.userId, c.pin);
    if (result.created.length) {
      await t.query(
        `insert into lms.audit_event (org_id, actor, action, target, details) values ($1, $2, 'people-added', $3, $4)`,
        [org, caller, `${result.created.length} people`, JSON.stringify({ ids: result.created.map((c) => c.loginId) })],
      );
    }
    const rolls = new Map(preview.people.map((p) => [p.loginId, p.roll]));
    return {
      ...checked,
      committed: true,
      created: result.created.map((c) => ({
        loginId: c.loginId,
        kind: c.kind,
        displayName: c.displayName,
        ...(c.grade !== undefined ? { className: `${c.grade}${c.section}`, roll: rolls.get(c.loginId) } : {}),
        pin: c.pin,
      })),
      conflicts: result.conflicts,
    };
  });
  if (response.committed && keptAs) kept.set(keptAs, { until: now + KEPT_MS, response });
  return response;
}

/** A new PIN for somebody in the admin's school; the old one stops working. */
export async function resetPinForAdmin(
  db: PGlite,
  caller: string,
  loginId: unknown,
): Promise<{ loginId: string; displayName: string; pin: string }> {
  const org = await adminOrg(db, caller, 'give out new PINs');
  const id = typeof loginId === 'string' ? loginId.trim().toUpperCase() : '';
  const { rows } = await db.query<{ user_id: string; kind: 'student' | 'teacher' | 'admin'; display_name: string }>(
    `select user_id, kind, display_name from lms.account where org_id = $1 and login_id = $2`,
    [org, id],
  );
  const who = rows[0];
  if (!who) throw new ImportRefused(404, `There is no one in your school with the ID ${id || '(none)'}.`);
  const pin = newPin(who.kind);
  await db.transaction(async (tx) => {
    const t = tx as unknown as PGlite;
    await setPin(t, id, who.user_id, pin);
    // Whoever held the old PIN is signed out everywhere.
    await t.query(`delete from demo_auth.session where user_id = $1`, [who.user_id]);
    await t.query(`insert into lms.audit_event (org_id, actor, action, target) values ($1, $2, 'pin-reset', $3)`, [
      org,
      caller,
      id,
    ]);
  });
  return { loginId: id, displayName: who.display_name, pin };
}

/** What the school has now: this year's classes, its subjects, everybody's ID, rolls and classes taught, and its licence's seats. */
async function schoolSnapshot(db: PGlite, org: string): Promise<SchoolSnapshot> {
  const school = (
    await db.query<{ code: string; display_name: string; short_name: string | null; board: SchoolSnapshot['config']['board'] }>(
      `select code, display_name, short_name, board from lms.school where org_id = $1`,
      [org],
    )
  ).rows[0];
  // This year: the one today falls in, else the latest.
  const year = (
    await db.query<{ id: string; label: string; starts_on: string; ends_on: string }>(
      `select id, label, starts_on::text, ends_on::text from lms.academic_year where org_id = $1
        order by (current_date between starts_on and ends_on) desc, starts_on desc limit 1`,
      [org],
    )
  ).rows[0];
  if (!school || !year) throw new ImportRefused(409, 'The school has no academic year yet.');
  const accounts = (
    await db.query<{
      login_id: string;
      kind: 'student' | 'teacher' | 'admin';
      display_name: string;
      class_name: string | null;
      roll: string | null;
      teaches: string[];
    }>(
      `select a.login_id, a.kind, a.display_name, en.class_name, en.roll,
              coalesce((select array_agg(sec.grade || sec.name || ' ' || sub.name order by sec.grade, sec.name, sub.name)
                          from lms.teaching_assignment ta
                          join lms.section sec on sec.id = ta.section_id and sec.academic_year_id = $2
                          join lms.subject sub on sub.id = ta.subject_id
                         where ta.teacher_user_id = a.user_id), '{}') as teaches
         from lms.account a
         left join lateral (
           select sec.grade || sec.name as class_name, e.roll_number as roll
             from lms.enrolment e join lms.section sec on sec.id = e.section_id
            where e.student_user_id = a.user_id and e.academic_year_id = $2 and e.left_on is null
            limit 1
         ) en on true
        where a.org_id = $1`,
      [org, year.id],
    )
  ).rows;
  const sections = (
    await db.query<{ name: string }>(`select grade || name as name from lms.section where academic_year_id = $1`, [year.id])
  ).rows;
  const subjects = (await db.query<{ name: string }>(`select name from lms.subject where org_id = $1 order by name`, [org])).rows;
  // The licence's seats and those in use (0041); no row when no licence is set.
  const licence = (
    await db.query<{ seats: number; used: number }>(
      `select l.seats, lms.seats_used(l.org_id) as used from lms.licence l where l.org_id = $1`,
      [org],
    )
  ).rows[0];
  return {
    config: {
      code: school.code,
      displayName: school.display_name,
      ...(school.short_name ? { shortName: school.short_name } : {}),
      board: school.board,
      year: { label: year.label, startsOn: year.starts_on, endsOn: year.ends_on },
    },
    accounts: accounts.map((a) => ({
      loginId: a.login_id,
      kind: a.kind,
      displayName: a.display_name,
      className: a.class_name,
      roll: a.roll,
      teaches: a.teaches,
    })),
    sections: sections.map((s) => s.name),
    subjects: subjects.map((s) => s.name),
    licence: licence ? { seats: licence.seats, used: licence.used } : null,
  };
}
