import type { PGlite } from '@electric-sql/pglite';

/**
 * ONE FUNCTION CALL, RUN AS POSTGREST RUNS IT for POST /rest/v1/rpc/<fn>.
 *
 * The function is found in pg_catalog by schema, name and the argument names
 * given (named arguments only, as supabase-js sends them). The arguments go
 * in through json_to_record with each one's declared type, so a date arrives
 * as a date and a jsonb argument as the JSON it was sent as. The call then
 * runs in one transaction with the caller's role (anon, authenticated or
 * service_role), request.jwt.claims holding the whole claims object (so
 * admin.require_staff and admin.require_fresh_mfa read aal, amr and
 * is_anonymous) and request.jwt.claim.sub the subject (the harness's
 * auth.uid() reads that), in UTC as the hosted database is.
 *
 * The answer is the JSON Postgres itself writes: a set-returning function's
 * rows as an array (json_agg), anything else as its one value (to_json), a
 * void function as null. A database error answers PostgREST's body {code,
 * message, details, hint}: 42501 is 403 (401 for anon), a unique or foreign
 * key violation 409, a read-only refusal 405, everything else 400.
 *
 * Function and argument names are held to shapes that cannot carry SQL
 * before anything reaches the database; every value travels as a bound
 * parameter.
 */

export type Caller =
  | { role: 'anon' }
  | { role: 'authenticated'; claims: Record<string, unknown> }
  | { role: 'service_role' };

export interface RpcRequest {
  schema: string;
  fn: string;
  args: Record<string, unknown>;
  caller: Caller;
  /** GET /rpc: PostgREST runs it read-only. */
  readOnly?: boolean;
  /** The schemas that may be called: EXPOSED_SCHEMAS unless the demo's own in-process functions say otherwise. */
  exposed?: readonly string[];
}

/** `json` is the response body exactly as sent. */
export interface RpcAnswer {
  status: number;
  json: string;
}

/** What the demo serves over HTTP: the console's admin schema, and public. */
export const EXPOSED_SCHEMAS: readonly string[] = ['admin', 'public'];
const FUNCTION_NAME = /^[a-z][a-z_]{0,62}$/;
const ARG_NAME = /^p_[a-z_]{1,60}$/;

interface Candidate {
  set: boolean;
  isVoid: boolean;
  required: number;
  args: { name: string | null; type: string }[];
}

const failure = (status: number, code: string, message: string, hint: string | null = null): RpcAnswer => ({
  status,
  json: JSON.stringify({ code, message, details: null, hint }),
});

const notFound = (schema: string, fn: string, names: string[]) =>
  failure(
    404,
    'PGRST202',
    `Could not find the function ${schema}.${fn}(${[...names].sort().join(', ')}) in the schema cache`,
    'Perhaps you meant to call another function, or gave an argument it does not take.',
  );

const STATUS_BY_SQLSTATE: Record<string, number> = { '42501': 403, '23505': 409, '23503': 409, '25006': 405 };

type Tx = Parameters<Parameters<PGlite['transaction']>[0]>[0];

async function candidates(tx: Tx, schema: string, fn: string): Promise<Candidate[]> {
  const { rows } = await tx.query<{ set: boolean; is_void: boolean; required: number; args: Candidate['args'] }>(
    `select p.proretset as set,
            p.prorettype = 'void'::regtype as is_void,
            (p.pronargs - p.pronargdefaults)::int as required,
            coalesce((select json_agg(json_build_object('name', a.name, 'type', format_type(a.typ, null)) order by a.ord)
                        from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]), p.proargmodes, p.proargnames)
                             with ordinality as a(typ, mode, name, ord)
                       where coalesce(a.mode, 'i') in ('i', 'b')), '[]'::json) as args
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 and p.proname = $2 and p.prokind = 'f'`,
    [schema, fn],
  );
  return rows.map((r) => ({ set: r.set, isVoid: r.is_void, required: r.required, args: r.args }));
}

export async function callRpc(db: PGlite, req: RpcRequest): Promise<RpcAnswer> {
  const { schema, fn, caller } = req;
  const exposed = req.exposed ?? EXPOSED_SCHEMAS;
  if (!exposed.includes(schema)) {
    return failure(406, 'PGRST106', `The schema must be one of the following: ${exposed.join(', ')}`);
  }
  const names = Object.keys(req.args).filter((k) => req.args[k] !== undefined);
  if (!FUNCTION_NAME.test(fn) || !names.every((n) => ARG_NAME.test(n))) return notFound(schema, fn, names);

  const sub = caller.role === 'authenticated' ? String(caller.claims.sub ?? '') : '';
  const claims = caller.role === 'authenticated' ? caller.claims : { role: caller.role };
  try {
    return await db.transaction(async (tx) => {
      if (req.readOnly) await tx.exec('set transaction read only');
      const fit = (await candidates(tx, schema, fn)).filter((c) => {
        const declared = c.args.map((a) => a.name);
        return names.every((n) => declared.includes(n)) && c.args.slice(0, c.required).every((a) => a.name && names.includes(a.name));
      });
      if (fit.length === 0) return notFound(schema, fn, names);
      if (fit.length > 1) return failure(300, 'PGRST203', `Could not choose the best candidate function for ${schema}.${fn}`);
      const f = fit[0];

      // Declared order, only those given: a left-out argument takes its default.
      const cols = f.args.filter((a): a is { name: string; type: string } => a.name !== null && names.includes(a.name));
      const call = `${schema}.${fn}(${cols.map((a) => `${a.name} => _a.${a.name}`).join(', ')})`;
      const record = cols.length ? `json_to_record($1::json) as _a(${cols.map((a) => `${a.name} ${a.type}`).join(', ')})` : '';
      const params = cols.length ? [JSON.stringify(Object.fromEntries(cols.map((a) => [a.name, req.args[a.name]])))] : [];
      const sql = f.set
        ? `select coalesce(json_agg(_r), '[]'::json)::text as body from ${record ? `${record} cross join lateral ` : ''}${call} as _r`
        : f.isVoid
          ? `select ${call}${record ? ` from ${record}` : ''}`
          : `select coalesce(to_json(${call})::text, 'null') as body${record ? ` from ${record}` : ''}`;

      await tx.exec(`set local role ${caller.role}`);
      await tx.exec(`set local timezone to 'UTC'`);
      await tx.query(
        `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true),
                set_config('request.jwt.claim.role', $3, true)`,
        [JSON.stringify(claims), sub, caller.role],
      );
      const { rows } = await tx.query<{ body?: string }>(sql, params);
      return { status: 200, json: f.isVoid ? 'null' : (rows[0]?.body ?? 'null') };
    });
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown; detail?: unknown; hint?: unknown };
    if (typeof err.code !== 'string' || !/^[0-9A-Z]{5}$/.test(err.code)) throw e;
    const status = err.code === '42501' && caller.role === 'anon' ? 401 : (STATUS_BY_SQLSTATE[err.code] ?? 400);
    return {
      status,
      json: JSON.stringify({
        code: err.code,
        message: String(err.message ?? ''),
        details: typeof err.detail === 'string' ? err.detail : null,
        hint: typeof err.hint === 'string' ? err.hint : null,
      }),
    };
  }
}

/** A call that failed, with PostgREST's status and the database's code and message. */
export class RpcFailed extends Error {
  readonly status: number;
  readonly sqlstate: string;
  constructor(message: string, status: number, sqlstate: string) {
    super(message);
    this.name = 'RpcFailed';
    this.status = status;
    this.sqlstate = sqlstate;
  }
}

/** callRpc's answer as a value, or RpcFailed: for the demo's own seeding and the in-process functions. */
export async function rpcValue<T = unknown>(db: PGlite, req: RpcRequest): Promise<T> {
  const r = await callRpc(db, req);
  const body = JSON.parse(r.json) as unknown;
  if (r.status >= 300) {
    const b = (body ?? {}) as { message?: unknown; code?: unknown };
    throw new RpcFailed(String(b.message ?? `${req.fn} answered ${r.status}`), r.status, String(b.code ?? ''));
  }
  return body as T;
}
