import type { ImportResponse } from '../../../packages/lms-client/src/backend.ts';
import { SOMETHING_WENT_WRONG } from '../../../packages/lms-client/src/errors.ts';
import { loginEmail } from '../../../packages/lms-client/src/login.ts';
import { applyPlan, type ImportStore } from './apply.ts';
import { newPin, type AccountKind } from './pin.ts';
import { previewImport, type SchoolSnapshot } from './portal.ts';

/**
 * THE HOSTED SCHOOL PORTAL'S ADMIN CALLS, as the lms-admin edge function
 * serves them (supabase/functions/lms-admin): adding people from the sheets,
 * a new PIN, a parent's sign-in. The same requests and answers as the demo
 * server's /admin/* (tools/lms-demo/src/import.ts), over the same database
 * functions (migration 0046), with the service role:
 *
 *   POST …/import      {students?, teachers?, commit?, acceptWarnings?} → ImportResponse
 *   POST …/reset-pin   {loginId}                                   → {loginId, displayName, pin}
 *   POST …/add-parent  {studentLoginId, displayName}               → {loginId, displayName, pin}
 *
 * Every call checks, on the server, that the caller is signed in and is their
 * school's admin; the sheets are checked here every time, whatever the
 * browser showed. A PIN is the new sign-in's password and leaves only in the
 * answer. Unlike the demo, a hosted commit is not one transaction: the auth
 * service and the tables are separate calls. Should one fail part-way,
 * running the same sheet again creates nobody twice (people are found by
 * their ID) — but the PINs of those already created are not shown again,
 * and "New PIN" gives them one.
 */

export interface AdminDeps {
  /** Who is calling, from their Authorization header (packages/relay createSupabaseVerifier). */
  verify(
    authorization: string | undefined,
  ): Promise<{ ok: true; user: { userId: string } } | { ok: false; status: number; why: string }>;
  /** One of 0046's lms functions, with the service role; its JSON answer. */
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** Accounts, classes and teaching, with the service role (supabaseStore). */
  store: ImportStore;
  /** The auth admin API: a sign-in's new password. */
  auth: { setPassword(userId: string, password: string): Promise<void> };
}

export interface AdminRequest {
  method: string;
  path: string;
  authorization?: string;
  body: unknown;
}

export interface AdminReply {
  status: number;
  body: unknown;
}

// No parameter properties: node runs these files by stripping types only.
export class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ROUTES = ['import', 'reset-pin', 'add-parent'] as const;
type Route = (typeof ROUTES)[number];

const objectOf = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new Refused(400, 'The request was not a JSON object.');
};

async function adminSchool(deps: AdminDeps, caller: string, what: string): Promise<string> {
  const org = await deps.rpc('admin_school', { p_user: caller });
  if (typeof org !== 'string') throw new Refused(403, `Only the school admin can ${what}.`);
  return org;
}

function checkSheets(req: Record<string, unknown>): void {
  for (const k of ['students', 'teachers'] as const) {
    if (req[k] !== undefined && typeof req[k] !== 'string') throw new Refused(400, `${k} must be the text of a CSV.`);
  }
}

/**
 * Adds people from the sheets to one school, with `actor` as the one who did
 * it in the school's activity log. The school admin's calls (handleAdmin,
 * below) and Qrie staff's (tools/admin-api) both come here once their own
 * check has named the school. Before any sheet is read it asks
 * lms.import_refusal (0063) whether the school may take people, and refuses
 * with that sentence (409) when it may not.
 */
export async function importForSchool(
  deps: Pick<AdminDeps, 'rpc' | 'store'>,
  org: string,
  actor: string,
  req: Record<string, unknown>,
): Promise<ImportResponse> {
  checkSheets(req);
  // Offboarded, suspended or ended, and later the school's privacy decision
  // (0063, admin.import_refusal): asked before anything is read, for the
  // school admin's calls and staff's alike.
  const refusal = await deps.rpc('import_refusal', { p_org: org });
  if (typeof refusal === 'string' && refusal) throw new Refused(409, refusal);
  const snapshot = (await deps.rpc('import_snapshot', { p_org: org })) as SchoolSnapshot | null;
  if (!snapshot) throw new Refused(409, 'The school has no academic year yet.');
  const preview = previewImport(snapshot, {
    students: req.students as string | undefined,
    teachers: req.teachers as string | undefined,
  });
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
  if (req.commit !== true || !preview.plan) return checked;
  if (preview.warnings.length > 0 && req.acceptWarnings !== true) throw new Refused(400, 'Read and accept the warnings first.');
  const result = await applyPlan(preview.plan, deps.store);
  if (result.created.length) {
    await deps.rpc('audit_by', {
      p_org: org,
      p_actor: actor,
      p_action: 'people-added',
      p_target: `${result.created.length} people`,
      p_details: { ids: result.created.map((c) => c.loginId) },
    });
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
}

async function importPeople(deps: AdminDeps, caller: string, req: Record<string, unknown>): Promise<ImportResponse> {
  checkSheets(req);
  const org = await adminSchool(deps, caller, 'add people');
  return importForSchool(deps, org, caller, req);
}

type Holder = { userId: string; kind: AccountKind; displayName: string; leftAt: string | null };

/** A new PIN for one person of one school; the old one stops and its holder is signed out everywhere. */
export async function resetPinForSchool(
  deps: Pick<AdminDeps, 'rpc' | 'auth'>,
  org: string,
  actor: string,
  loginId: unknown,
): Promise<{ loginId: string; displayName: string; pin: string }> {
  const id = typeof loginId === 'string' ? loginId.trim().toUpperCase() : '';
  const who = (await deps.rpc('account_by_login', { p_org: org, p_login: id })) as Holder | null;
  if (!who) throw new Refused(404, `There is no one in your school with the ID ${id || '(none)'}.`);
  const pin = newPin(who.kind);
  await deps.auth.setPassword(who.userId, pin);
  // Whoever held the old PIN is signed out everywhere.
  await deps.rpc('end_sessions', { p_user: who.userId });
  await deps.rpc('audit_by', { p_org: org, p_actor: actor, p_action: 'pin-reset', p_target: id });
  return { loginId: id, displayName: who.displayName, pin };
}

async function resetPin(deps: AdminDeps, caller: string, req: Record<string, unknown>) {
  const org = await adminSchool(deps, caller, 'give out new PINs');
  return resetPinForSchool(deps, org, caller, req.loginId);
}

async function addParent(deps: AdminDeps, caller: string, req: Record<string, unknown>) {
  const org = await adminSchool(deps, caller, 'give a parent a sign-in');
  const name = typeof req.displayName === 'string' ? req.displayName.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > 80) throw new Refused(400, "Write the parent's name, up to 80 letters.");
  const studentId = typeof req.studentLoginId === 'string' ? req.studentLoginId.trim().toUpperCase() : '';
  const child = (await deps.rpc('account_by_login', { p_org: org, p_login: studentId })) as Holder | null;
  if (!child) throw new Refused(404, `There is no one in your school with the ID ${studentId || '(none)'}.`);
  if (child.kind !== 'student' || child.leftAt) throw new Refused(400, `${studentId} is not a student at your school.`);
  const loginId = (await deps.rpc('next_parent_login', { p_org: org })) as string;
  const pin = newPin('parent');
  await deps.store.createAccount({
    orgId: org,
    loginId,
    kind: 'parent',
    displayName: name,
    email: loginEmail(loginId),
    password: pin,
    appMetadata: { provisioned_by: 'school', school_code: loginId.slice(0, loginId.lastIndexOf('-P')) },
  });
  await deps.rpc('attach_parent', { p_org: org, p_actor: caller, p_parent_login: loginId, p_child_login: studentId });
  return { loginId, displayName: name, pin };
}

export async function handleAdmin(req: AdminRequest, deps: AdminDeps): Promise<AdminReply> {
  const route = req.path.replace(/\/+$/, '').split('/').pop() as Route;
  if (!ROUTES.includes(route)) return { status: 404, body: { error: 'There is no such call.' } };
  if (req.method !== 'POST') return { status: 405, body: { error: 'POST only.' } };
  const who = await deps.verify(req.authorization);
  if (!who.ok) return { status: who.status === 503 ? 503 : 401, body: { error: 'Please sign in again.' } };
  try {
    const body = objectOf(req.body);
    const caller = who.user.userId;
    const answer =
      route === 'import'
        ? await importPeople(deps, caller, body)
        : route === 'reset-pin'
          ? await resetPin(deps, caller, body)
          : await addParent(deps, caller, body);
    return { status: 200, body: answer };
  } catch (e) {
    if (e instanceof Refused) return { status: e.status, body: { error: e.message } };
    // The server's own words go to its log, not to the school.
    console.error('lms-admin', route, e);
    return { status: 500, body: { error: SOMETHING_WENT_WRONG } };
  }
}
