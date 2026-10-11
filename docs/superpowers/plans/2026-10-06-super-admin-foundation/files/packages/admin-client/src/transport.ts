/**
 * How a call reaches the `admin` functions of migrations 0047 onward. Two ways,
 * one contract, so a screen cannot tell them apart:
 *
 *   - supabaseAdminTransport: production. A supabase-js client signed in as a
 *     member of staff, with their authenticator code verified (aal2); PostgREST
 *     runs the function as them and every function checks for staff itself.
 *   - pgliteAdminTransport: the tests, and the demo that runs the real
 *     migrations in-process. It runs each call as PostgREST would, with the
 *     claims given, so the same refusals happen as in production.
 *
 * Both hand back what PostgREST would: rows with the database's own column
 * names, timestamps as ISO strings.
 */
export interface AdminTransport {
  /** Calls a function that returns rows. */
  rows(fn: string, args?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  /** Calls a function that returns one value (a jsonb document, say), or nothing (null). */
  value(fn: string, args?: Record<string, unknown>): Promise<unknown>;
}

type RpcAnswer = { data: unknown; error: { message: string } | null };

/** The part of a supabase-js client this needs; keeps supabase-js out of the package. */
export interface AdminRpcClient {
  schema(name: 'admin'): {
    rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcAnswer>;
  };
}

export function supabaseAdminTransport(client: AdminRpcClient): AdminTransport {
  const call = async (fn: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const { data, error } = await client.schema('admin').rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    async rows(fn, args) {
      const data = await call(fn, args);
      return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    },
    async value(fn, args) {
      return (await call(fn, args)) ?? null;
    },
  };
}

/** The part of PGlite (or its transaction) this needs. */
interface Queryable {
  exec(sql: string): Promise<unknown>;
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}
export interface PgliteLike {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** What a staff member's JWT carries that the functions read. */
export interface AdminClaims {
  sub: string;
  aal?: 'aal1' | 'aal2';
  is_anonymous?: boolean;
  amr?: { method: string; timestamp: number }[];
}

// Both are spliced into SQL, so both are held to a shape that cannot carry
// anything else. Every value travels as a bound parameter.
const FUNCTION_NAME = /^[a-z][a-z_]{0,62}$/;
const ARG_NAME = /^p_[a-z_]{1,60}$/;

/** By convention an argument called p_value is a jsonb document. */
const JSONB_ARG = 'p_value';

function callSql(fn: string, args: Record<string, unknown>): { sql: string; params: unknown[] } {
  if (!FUNCTION_NAME.test(fn)) throw new Error(`not an admin function name: ${fn}`);
  const names = Object.keys(args).filter((k) => args[k] !== undefined);
  for (const n of names) if (!ARG_NAME.test(n)) throw new Error(`not an argument name: ${n}`);
  const list = names.map((n, i) => `${n} => $${i + 1}${n === JSONB_ARG ? '::jsonb' : ''}`).join(', ');
  return {
    sql: `admin.${fn}(${list})`,
    params: names.map((n) => (n === JSONB_ARG ? JSON.stringify(args[n]) : args[n])),
  };
}

function isoDates(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

export function pgliteAdminTransport(db: PgliteLike, claims: AdminClaims): AdminTransport {
  const run = <T>(work: (tx: Queryable) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims.sub]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ role: 'authenticated', aal: 'aal1', is_anonymous: false, ...claims }),
      ]);
      return work(tx);
    });
  return {
    async rows(fn, args = {}) {
      const { sql, params } = callSql(fn, args);
      return run(async (tx) => (await tx.query<Record<string, unknown>>(`select * from ${sql}`, params)).rows.map(isoDates));
    },
    async value(fn, args = {}) {
      const { sql, params } = callSql(fn, args);
      return run(async (tx) => {
        const { rows } = await tx.query<{ v: unknown }>(`select ${sql} as v`, params);
        const v = rows[0]?.v;
        return v === undefined || v === '' ? null : v;
      });
    },
  };
}
