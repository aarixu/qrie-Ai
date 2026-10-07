import { AdminError, type AdminErrorCode } from './errors.ts';

/**
 * Calls to the admin-api edge function (supabase/functions/admin-api): what
 * needs the service role, after the database has said yes as the caller.
 * Every reply goes through readReply, so a screen gets the same typed
 * AdminError it gets from a database function.
 */
export interface AdminApiCaller {
  post(route: string, body: Record<string, unknown>): Promise<unknown>;
}

const CODES: readonly AdminErrorCode[] = ['needs-mfa', 'not-allowed', 'wrong-environment', 'other'];

export function readReply(status: number, body: unknown): unknown {
  if (status >= 200 && status < 300) return body;
  const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; code?: unknown };
  const code: AdminErrorCode = CODES.includes(b.code as AdminErrorCode)
    ? (b.code as AdminErrorCode)
    : status === 401 || status === 403 ? 'not-allowed' : 'other';
  const message = typeof b.error === 'string' && b.error ? b.error : 'The admin service did not answer properly.';
  throw new AdminError(message, code);
}

export const adminApiUrl = (supabaseUrl: string): string => `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/admin-api`;

export function fetchAdminApi(
  baseUrl: string,
  token: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): AdminApiCaller {
  return {
    async post(route, body) {
      const t = await token();
      if (!t) throw new AdminError('Please sign in again.', 'not-allowed');
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/${route}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        throw new AdminError('Could not reach the admin service.', 'other');
      }
      return readReply(res.status, await res.json().catch(() => null));
    },
  };
}

/** The same reading over any handler's reply: the tests, and an in-process demo. */
export function replyCaller(send: (route: string, body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>): AdminApiCaller {
  return {
    async post(route, body) {
      const r = await send(route, body);
      return readReply(r.status, r.body);
    },
  };
}
