/**
 * AN admin.* FUNCTION, CALLED FROM AN EDGE FUNCTION THROUGH POSTGREST.
 *
 * POST <url>/rest/v1/rpc/<fn> with Content-Profile: admin, the anon key as the
 * gateway's apikey, and the Authorization given: the staff member's own
 * "Bearer <session>" for a call the database must decide as them, or
 * "Bearer <service role key>" for a service-role-only function. A refusal
 * comes back as RpcError with the database's message and the HTTP status; no
 * header is ever part of a message.
 */

export class RpcError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
  }
}

// Spliced into the URL, so held to a shape that cannot carry anything else.
const FUNCTION_NAME = /^[a-z][a-z_]{0,62}$/;

/** POST <url>/rest/v1/rpc/<fn> with Content-Profile: admin. `authorization` is the caller's header (user calls) or "Bearer <service key>". */
export function adminRpc(
  url: string,
  apikey: string,
  fetchImpl: typeof fetch = fetch,
): (authorization: string, fn: string, args: Record<string, unknown>) => Promise<unknown> {
  const base = url.replace(/\/+$/, '');
  return async (authorization, fn, args) => {
    if (!FUNCTION_NAME.test(fn)) throw new Error(`not an admin function name: ${fn}`);
    let res: Response;
    try {
      res = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey,
          authorization,
          'content-type': 'application/json',
          'content-profile': 'admin',
        },
        body: JSON.stringify(args),
      });
    } catch {
      throw new RpcError('the database did not answer', 0);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const message =
        json && typeof json === 'object' && typeof (json as { message?: unknown }).message === 'string'
          ? (json as { message: string }).message
          : `the database did not answer (${res.status})`;
      throw new RpcError(message, res.status);
    }
    if (json === undefined) throw new RpcError(`the database answered something that is not JSON (${res.status})`, 502);
    return json;
  };
}
