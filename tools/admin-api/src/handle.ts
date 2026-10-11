import { importForSchool, Refused, resetPinForSchool, type AdminDeps } from '../../lms-import/src/admin.ts';
import { newStaffPassword } from './password.ts';
import { classRemoveRoute, eraseRoute } from './privacy.ts';

/**
 * THE STAFF CONSOLE'S SERVICE CALLS, as the admin-api edge function serves
 * them (supabase/functions/admin-api):
 *
 *   POST …/import        {code, students?, teachers?, commit?, acceptWarnings?, reason?, env?} → the import's answer
 *   POST …/reset-pin     {code, loginId, reason, env}            → {loginId, displayName, pin}
 *   POST …/staff-invite  {email, displayName, role, reason, env} → {userId, email, temporaryPassword}
 *   POST …/user-block    {userId, blocked, reason, env}          → {userId, blocked}
 *   POST …/class-remove  {classId, action, reason, env}          → {classId, removed}
 *   POST …/erase         {requestId, reason, env}                → {requestId, rows, photos, activityLogLines}
 *
 * Each call first asks the database AS THE CALLER, with their own token:
 * admin.api_gate, admin.staff_invite, admin.direct_user_block,
 * admin.class_remove_prepare or admin.erasure_prepare decide who may act
 * (staff, role, a recent authenticator code, the environment, a reason).
 * Only then does anything happen with the service role. Adding people and new
 * PINs run the LMS lane's own code (tools/lms-import/src/admin.ts) for the
 * school the gate named, with the member of staff as the actor. The two
 * Storage routes are in ./privacy.ts.
 *
 * A refusal answers {error, code}; code is what the console's AdminError
 * branches on.
 */

/** A refusal from the database through PostgREST: its message and SQLSTATE. */
export class CallerError extends Error {
  readonly sqlstate: string;
  constructor(message: string, sqlstate: string) {
    super(message);
    this.sqlstate = sqlstate;
  }
}

export const CALLER_FUNCTIONS = ['api_gate', 'staff_invite', 'direct_user_block', 'class_remove_prepare', 'erasure_prepare'] as const;
export type CallerFunction = (typeof CALLER_FUNCTIONS)[number];

export interface AdminApiDeps {
  /** One admin function, run as the caller (their Authorization header). */
  asCaller(authorization: string, fn: CallerFunction, args: Record<string, unknown>): Promise<unknown>;
  /** The LMS lane's service-role calls (the same shape lms-admin uses). */
  lms: Pick<AdminDeps, 'rpc' | 'store' | 'auth'>;
  /** The auth admin API, with the service role. */
  authAdmin: {
    createStaffUser(email: string, password: string): Promise<string>;
    /** Takes back an account staffInviteRoute made when the invitation then fails. */
    deleteStaffUser(userId: string): Promise<void>;
    setBanned(userId: string, banned: boolean): Promise<void>;
  };
  password?: () => string;
  /** The Storage API with the service role (plan 5). Absent: the two routes answer 503 before anything changes. */
  files?: { remove(bucket: 'classes' | 'lms-work', names: string[]): Promise<number> };
  /** A service-role-only admin function (plan 5). */
  serviceAdmin?(fn: 'class_files_removed' | 'erasure_complete', args: Record<string, unknown>): Promise<unknown>;
}

export interface ApiRequest { method: string; path: string; authorization?: string; body: unknown }
export interface ApiReply { status: number; body: unknown }

const ROUTES = ['import', 'reset-pin', 'staff-invite', 'user-block', 'class-remove', 'erase'] as const;
type Route = (typeof ROUTES)[number];

const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const objectOf = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new Refused(400, 'The request was not a JSON object.');
};

interface Gate { actor: string; orgId: string | null }

const gate = async (deps: AdminApiDeps, auth: string, action: string, b: Record<string, unknown>, target = ''): Promise<Gate> =>
  (await deps.asCaller(auth, 'api_gate', {
    p_action: action, p_code: text(b.code), p_target: target, p_reason: text(b.reason), p_env: text(b.env),
  })) as Gate;

async function importRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>) {
  const commit = b.commit === true;
  // The teachers sheet is the only one that makes teachers and school admins;
  // the gate lets only the owner commit one (R22). Whatever is not passed on
  // as a teachers sheet here is never read as one below.
  const teachersSent = b.teachers !== undefined && b.teachers !== '';
  const g = await gate(deps, auth, commit ? 'people-import' : 'people-preview', b, teachersSent ? 'teachers' : '');
  return importForSchool(deps.lms, g.orgId as string, g.actor, {
    students: b.students, teachers: teachersSent ? b.teachers : undefined, commit, acceptWarnings: b.acceptWarnings === true,
  });
}

/**
 * A sign-in ID as lms.account stores it (0022: ^[A-Z0-9-]{3,40}$), checked
 * BEFORE it is upper-cased. JavaScript's toUpperCase turns some letters into
 * two ('ﬆ' into 'ST', 'ß' into 'SS') where Postgres's upper() leaves them, so
 * a look-alike could pass admin.api_gate's R22 check as nobody and then reach
 * a teacher's account here. Only the one normalised string goes on, to the
 * gate and to the reset alike.
 */
const LOGIN_ID = /^[A-Za-z0-9-]{3,40}$/;

async function resetPinRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>) {
  const raw = text(b.loginId);
  if (!LOGIN_ID.test(raw)) throw new Refused(400, 'A sign-in ID is letters, digits and hyphens, such as DPS-8A-12.');
  const loginId = raw.toUpperCase();
  const g = await gate(deps, auth, 'pin-reset', b, loginId);
  return resetPinForSchool(deps.lms, g.orgId as string, g.actor, loginId);
}

async function staffInviteRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>) {
  const email = text(b.email).toLowerCase();
  if (!EMAIL.test(email)) throw new Refused(400, 'Write an email address.');
  await gate(deps, auth, 'staff-invite', b, email);
  const password = (deps.password ?? newStaffPassword)();
  const userId = await deps.authAdmin.createStaffUser(email, password);
  try {
    await deps.asCaller(auth, 'staff_invite', {
      p_user: userId, p_role: text(b.role), p_name: text(b.displayName), p_reason: text(b.reason), p_env: text(b.env),
    });
  } catch (e) {
    // Nobody will ever see this account's password: take the account back so
    // the address can be invited again. If that fails too, the log says so.
    try {
      await deps.authAdmin.deleteStaffUser(userId);
    } catch (undo) {
      console.error('admin-api', 'staff-invite could not take back the account it made', userId, undo);
    }
    throw e;
  }
  return { userId, email, temporaryPassword: password };
}

async function userBlockRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>) {
  const userId = text(b.userId);
  if (!UUID.test(userId)) throw new Refused(400, 'That is not a user ID.');
  if (typeof b.blocked !== 'boolean') throw new Refused(400, 'Say whether to block or unblock.');
  await deps.asCaller(auth, 'direct_user_block', {
    p_user: userId, p_blocked: b.blocked, p_reason: text(b.reason), p_env: text(b.env),
  });
  try {
    await deps.authAdmin.setBanned(userId, b.blocked);
  } catch (e) {
    console.error('admin-api', 'ban', e);
    throw new Refused(502, 'Recorded, but the sign-in service did not confirm it. Press again; it is safe to repeat.');
  }
  return { userId, blocked: b.blocked };
}

const SIGN_IN_AGAIN = { status: 401, body: { error: 'Please sign in again.', code: 'not-allowed' } };
export const SERVER_FAILED = 'Something went wrong on the server. Try again in a moment; the details are in the function log.';

function refusal(route: Route, e: unknown): ApiReply {
  if (e instanceof CallerError) {
    if (e.sqlstate.startsWith('PGRST3')) return SIGN_IN_AGAIN;
    if (e.sqlstate === '42501') {
      return /authenticator code/i.test(e.message)
        ? { status: 403, body: { error: 'Confirm with your authenticator code to continue.', code: 'needs-mfa' } }
        : { status: 403, body: { error: 'You do not have access to this.', code: 'not-allowed' } };
    }
    if (/^this console is /i.test(e.message)) return { status: 409, body: { error: e.message, code: 'wrong-environment' } };
    if (e.sqlstate === 'P0001') return { status: 400, body: { error: e.message, code: 'other' } };
  }
  if (e instanceof Refused) return { status: e.status, body: { error: e.message, code: 'other' } };
  // The database's or the server's own words go to the log, not to the screen.
  console.error('admin-api', route, e);
  return { status: 500, body: { error: SERVER_FAILED, code: 'other' } };
}

export async function handleAdminApi(req: ApiRequest, deps: AdminApiDeps): Promise<ApiReply> {
  const route = req.path.replace(/\/+$/, '').split('/').pop() as Route;
  if (!ROUTES.includes(route)) return { status: 404, body: { error: 'There is no such call.', code: 'other' } };
  if (req.method !== 'POST') return { status: 405, body: { error: 'POST only.', code: 'other' } };
  const auth = req.authorization ?? '';
  if (!/^Bearer \S+$/.test(auth)) return SIGN_IN_AGAIN;
  try {
    const b = objectOf(req.body);
    const answer =
      route === 'import' ? await importRoute(deps, auth, b)
      : route === 'reset-pin' ? await resetPinRoute(deps, auth, b)
      : route === 'staff-invite' ? await staffInviteRoute(deps, auth, b)
      : route === 'class-remove' ? await classRemoveRoute(deps, auth, b)
      : route === 'erase' ? await eraseRoute(deps, auth, b)
      : await userBlockRoute(deps, auth, b);
    return { status: 200, body: answer };
  } catch (e) {
    return refusal(route, e);
  }
}
