import { Refused } from '../../lms-import/src/admin.ts';
import type { AdminApiDeps } from './handle.ts';

/**
 * THE TWO ROUTES THAT DELETE FILES FROM STORAGE (plan 5):
 *
 *   POST …/class-remove {classId, action, reason, env} → {classId, removed}
 *   POST …/erase        {requestId, reason, env}       → {requestId, rows, photos, activityLogLines}
 *
 * Each asks the database as the caller first (admin.class_remove_prepare,
 * admin.erasure_prepare: staff, role, a fresh authenticator code, the
 * environment, a reason). The class is hidden, or the request marked as
 * erasing, by that call, which answers the files to delete. Storage deletes
 * them with the service role, in batches of 100. Only then does the service
 * role report back (admin.class_files_removed deletes the catalogue row;
 * admin.erasure_complete deletes the child's rows), and the database refuses
 * that report while any of the files is still in Storage.
 *
 * Storage can stop partway: the batches before the failure are deleted for
 * good, nothing else changes, and the 502 says so. Pressing again lists what
 * is left and finishes. The counts reported at the end come from the
 * database, which recorded how many files there were at the first press.
 */

const BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

type Files = NonNullable<AdminApiDeps['files']>;
type ServiceAdmin = NonNullable<AdminApiDeps['serviceAdmin']>;

function storageOf(deps: AdminApiDeps): { files: Files; serviceAdmin: ServiceAdmin } {
  if (!deps.files || !deps.serviceAdmin) throw new Refused(503, 'This server cannot remove files yet.');
  return { files: deps.files, serviceAdmin: deps.serviceAdmin.bind(deps) };
}

const namesOf = (answer: unknown): string[] => {
  const objects = (answer as { objects?: unknown } | null)?.objects;
  return Array.isArray(objects) ? objects.filter((n): n is string => typeof n === 'string') : [];
};

/** Deletes the names in batches; a throw from Storage becomes `failed`, a 502. */
async function removeAll(files: Files, bucket: 'classes' | 'lms-work', names: string[], failed: string): Promise<number> {
  let removed = 0;
  try {
    for (let i = 0; i < names.length; i += BATCH) {
      removed += await files.remove(bucket, names.slice(i, i + BATCH));
    }
  } catch (e) {
    console.error('admin-api', bucket, e);
    throw new Refused(502, failed);
  }
  return removed;
}

export async function classRemoveRoute(
  deps: AdminApiDeps,
  auth: string,
  b: Record<string, unknown>,
): Promise<{ classId: string; removed: number }> {
  const { files, serviceAdmin } = storageOf(deps);
  const classId = text(b.classId);
  if (classId.length < 1 || classId.length > 200) throw new Refused(400, 'That is not a class ID.');
  if (b.action !== 'retract' && b.action !== 'reject') throw new Refused(400, 'Say retract or reject.');
  const prepared = await deps.asCaller(auth, 'class_remove_prepare', {
    p_class: classId, p_action: b.action, p_reason: text(b.reason), p_env: text(b.env),
  });
  const removed = await removeAll(
    files,
    'classes',
    namesOf(prepared),
    'The class is hidden, but Storage did not remove all of its files. Press again to finish; it is safe to repeat.',
  );
  const done = (await serviceAdmin('class_files_removed', { p_class: classId, p_removed: removed })) as { removed?: unknown } | null;
  // The database's count: every file the class had when it was hidden, even
  // when an earlier press removed some of them before Storage stopped.
  return { classId, removed: typeof done?.removed === 'number' ? done.removed : removed };
}

export async function eraseRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>): Promise<unknown> {
  const { files, serviceAdmin } = storageOf(deps);
  const requestId = text(b.requestId);
  if (!UUID.test(requestId)) throw new Refused(400, 'That is not a request ID.');
  const prepared = await deps.asCaller(auth, 'erasure_prepare', {
    p_request: requestId, p_reason: text(b.reason), p_env: text(b.env),
  });
  const removed = await removeAll(
    files,
    'lms-work',
    namesOf(prepared),
    "Some or none of the child's photos were removed; nothing else was erased. Press Erase again to finish; it is safe to repeat.",
  );
  return serviceAdmin('erasure_complete', { p_request: requestId, p_objects_removed: removed });
}
