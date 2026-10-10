/**
 * How a call reaches the `lms` functions of migration 0026. Two ways, one
 * contract, so a screen cannot tell them apart:
 *
 *   - supabaseTransport: production. A supabase-js client already signed in
 *     as the teacher or student; PostgREST runs the function as them.
 *   - pgliteTransport: the tests, and the demo mode that runs the real
 *     migrations in the browser. It runs each call the way PostgREST would —
 *     as `authenticated`, with auth.uid() set to one user — so row-level
 *     security applies exactly as it does in production.
 *
 * Both hand back what PostgREST would: rows with the database's own column
 * names, timestamps as ISO strings.
 */
export interface Transport {
  /** Calls a function that returns rows. */
  rows(fn: string, args?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  /** Calls a function that returns one value, or nothing (null). */
  value(fn: string, args?: Record<string, unknown>): Promise<unknown>;
}

type RpcAnswer = { data: unknown; error: { message: string } | null; status?: number };

/** What a supabase-js part answers with when a call fails, as far as this package reads it. */
export interface AnsweredError {
  message: string;
  /** auth-js: the error's kind; AuthRetryableFetchError for no answer or a 5xx, which it retries. */
  name?: string;
  /** auth-js: the HTTP status, or 0 when no answer came back. */
  status?: unknown;
  /** storage-js: what fetch threw, when the call never reached the project. */
  originalError?: unknown;
}

/**
 * Whether an error a supabase-js part answered with is a call that never
 * reached the project. supabase-js (2.112) does not throw fetch's own
 * TypeError then: postgrest-js answers with status 0 and "TypeError: Failed
 * to fetch" (or "FetchError: …") as the message, auth-js with status 0, and
 * storage-js with the TypeError as originalError.
 */
export function unreached(error: AnsweredError, status?: number): boolean {
  return (
    status === 0 ||
    error.status === 0 ||
    error.originalError instanceof TypeError ||
    /^(TypeError|FetchError)\b/.test(error.message)
  );
}

/**
 * The Error to throw for an error a supabase-js part answered with. A call
 * that never reached the project (unreached) becomes a TypeError again, as
 * plain fetch would throw, which is what friendlyError, both apps' retries
 * and the outbox read as "could not reach the school". Anything else is the
 * project's own refusal, an Error with its words.
 */
export function answerError(error: AnsweredError, status?: number): Error {
  return unreached(error, status) ? new TypeError(error.message) : new Error(error.message);
}

/** The part of a supabase-js client this needs; keeps supabase-js out of the package. */
export interface RpcClient {
  schema(name: 'lms'): {
    rpc(
      fn: string,
      args?: Record<string, unknown>,
    ): PromiseLike<RpcAnswer> & { range?(from: number, to: number): PromiseLike<RpcAnswer> };
  };
}

/** PostgREST's max-rows: the most one call hands back, the rest dropped without a word. */
const PAGE = 1000;

/**
 * `ready`, when given, runs before each request; a request it throws for is
 * not sent, and the call fails with what it threw.
 */
export function supabaseTransport(client: RpcClient, ready?: () => Promise<void>): Transport {
  const call = async (fn: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    await ready?.();
    const { data, error, status } = await client.schema('lms').rpc(fn, args);
    if (error) throw answerError(error, status);
    return data;
  };
  return {
    // Page by page, so a school bigger than one page loses nobody. Each page
    // runs the function again; every function here that returns many rows
    // only reads.
    async rows(fn, args = {}) {
      const out: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        await ready?.();
        const q = client.schema('lms').rpc(fn, args);
        const { data, error, status } = await (q.range ? q.range(from, from + PAGE - 1) : q);
        if (error) throw answerError(error, status);
        const page = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
        out.push(...page);
        if (!q.range || page.length < PAGE) return out;
      }
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

// Both are spliced into SQL, so both are held to a shape that cannot carry
// anything else. Every value travels as a bound parameter.
const FUNCTION_NAME = /^[a-z][a-z_]{0,62}$/;
const ARG_NAME = /^p_[a-z_]{1,60}$/;

function callSql(fn: string, args: Record<string, unknown>): { sql: string; params: unknown[] } {
  if (!FUNCTION_NAME.test(fn)) throw new Error(`not an lms function name: ${fn}`);
  const names = Object.keys(args).filter((k) => args[k] !== undefined);
  for (const n of names) if (!ARG_NAME.test(n)) throw new Error(`not an argument name: ${n}`);
  const list = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
  return { sql: `lms.${fn}(${list})`, params: names.map((n) => args[n]) };
}

function isoDates(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

export function pgliteTransport(db: PgliteLike, userId: string): Transport {
  const asUser = <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      return fn(tx);
    });
  return {
    rows(fn, args = {}) {
      const { sql, params } = callSql(fn, args);
      return asUser(async (tx) => (await tx.query<Record<string, unknown>>(`select * from ${sql}`, params)).rows.map(isoDates));
    },
    value(fn, args = {}) {
      const { sql, params } = callSql(fn, args);
      return asUser(async (tx) => {
        const { rows } = await tx.query<{ value: unknown }>(`select ${sql} as value`, params);
        const v = rows[0]?.value;
        return v instanceof Date ? v.toISOString() : (v ?? null);
      });
    },
  };
}
