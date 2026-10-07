import type { PGlite } from '@electric-sql/pglite';
import type { ImportRequest, ImportResponse } from '../../../packages/lms-client/src/backend.ts';
import { loginEmail } from '../../../packages/lms-client/src/login.ts';
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
  const org = (await db.query<{ org: string | null }>(`select lms.admin_school($1) as org`, [caller])).rows[0]?.org;
  if (!org) throw new ImportRefused(403, `Only the school admin can ${what}.`);
  return org;
}

/** One account of the school by its ID (0046), or null. */
async function accountByLogin(db: PGlite, org: string, loginId: string) {
  return (
    await db.query<{ a: { userId: string; kind: 'student' | 'teacher' | 'admin' | 'parent'; displayName: string; leftAt: string | null } | null }>(
      `select lms.account_by_login($1, $2) as a`,
      [org, loginId],
    )
  ).rows[0]?.a ?? null;
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
      await t.query(`select lms.audit_by($1, $2, 'people-added', $3, $4)`, [
        org,
        caller,
        `${result.created.length} people`,
        JSON.stringify({ ids: result.created.map((c) => c.loginId) }),
      ]);
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
  const who = await accountByLogin(db, org, id);
  if (!who) throw new ImportRefused(404, `There is no one in your school with the ID ${id || '(none)'}.`);
  const pin = newPin(who.kind);
  await db.transaction(async (tx) => {
    const t = tx as unknown as PGlite;
    await setPin(t, id, who.userId, pin);
    // Whoever held the old PIN is signed out everywhere (the demo's own sessions).
    await t.query(`delete from demo_auth.session where user_id = $1`, [who.userId]);
    await t.query(`select lms.audit_by($1, $2, 'pin-reset', $3)`, [org, caller, id]);
  });
  return { loginId: id, displayName: who.displayName, pin };
}

/**
 * A child's parent, given their own sign-in by the admin (0045): an account
 * of kind 'parent' with the school's next P-number ID and an 8-digit PIN,
 * linked to the child. The PIN is returned this once.
 */
export async function addParentForAdmin(
  db: PGlite,
  caller: string,
  request: Record<string, unknown>,
): Promise<{ loginId: string; displayName: string; pin: string }> {
  const org = await adminOrg(db, caller, 'give a parent a sign-in');
  const name = typeof request.displayName === 'string' ? request.displayName.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > 80) throw new ImportRefused(400, "Write the parent's name, up to 80 letters.");
  const studentId = typeof request.studentLoginId === 'string' ? request.studentLoginId.trim().toUpperCase() : '';
  const child = await accountByLogin(db, org, studentId);
  if (!child) throw new ImportRefused(404, `There is no one in your school with the ID ${studentId || '(none)'}.`);
  if (child.kind !== 'student' || child.leftAt) throw new ImportRefused(400, `${studentId} is not a student at your school.`);
  const pin = newPin('parent');
  return db.transaction(async (tx) => {
    const t = tx as unknown as PGlite;
    // The next P-number: one more than the highest, never a gap reused (0046).
    const loginId = (await t.query<{ id: string }>(`select lms.next_parent_login($1) as id`, [org])).rows[0].id;
    const user = await pgliteStore(t).createAccount({
      orgId: org,
      loginId,
      kind: 'parent',
      displayName: name,
      email: loginEmail(loginId),
      password: pin,
      appMetadata: { provisioned_by: 'school', school_code: loginId.slice(0, loginId.lastIndexOf('-P')) },
    });
    await setPin(t, loginId, user, pin);
    await t.query(`select lms.attach_parent($1, $2, $3, $4)`, [org, caller, loginId, studentId]);
    return { loginId, displayName: name, pin };
  });
}

/** What the school has now, as the preview reads it (0046's import_snapshot, the hosted function's too). */
async function schoolSnapshot(db: PGlite, org: string): Promise<SchoolSnapshot> {
  const snapshot = (await db.query<{ s: SchoolSnapshot | null }>(`select lms.import_snapshot($1) as s`, [org])).rows[0]?.s;
  if (!snapshot) throw new ImportRefused(409, 'The school has no academic year yet.');
  return snapshot;
}
