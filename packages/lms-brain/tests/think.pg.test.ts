// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SUPABASE_SHIM, migrationFiles, migrationSql } from '../../../supabase/tests/harness.ts';
import { think, type Sql, type Tx } from '../src/index.ts';

/**
 * TWO think() RUNS AT ONCE, ON A REAL POSTGRES (review MF9).
 *
 * PGlite has one connection and runs every query and transaction one after
 * another, so an overlap test there passes with no lock at all. This one needs
 * a real server and is SKIPPED unless LAM_PG_URL is set: a superuser URL to a
 * throwaway Postgres 15+ (it creates roles and a scratch database, and drops
 * the database after), with the `postgres` package installed. It has not been
 * run in this worktree, which has neither.
 *
 * What it checks: two runs over one learner both succeed (without the lock,
 * the second one's insert meets the first one's rows and fails on the primary
 * key), they leave exactly what one run leaves, and a reader polling all the
 * while never sees the learner with no rows (without the transaction it sees
 * the moment between the delete and the insert).
 */

const URL_ENV = process.env.LAM_PG_URL;

/** postgres.js, imported only when the test runs; not a dependency of this repo. */
type Postgres = any;

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';

/** The shim's roles exist cluster-wide: on a second run they are already there. */
const shimForServer = (shim: string): string =>
  shim.replace(
    /create role (\w+) ([^;]*);/g,
    (_, role: string, rest: string) =>
      `do $r$ begin create role ${role} ${rest}; exception when duplicate_object then null; end $r$;`,
  );

describe.skipIf(!URL_ENV)('think() under real concurrency (LAM_PG_URL)', () => {
  let admin: Postgres;
  let sql: Postgres;
  let db: Sql;
  let kid: string;
  const scratch = `lam_think_${Date.now()}`;

  const adapt = (q: Postgres): Tx => ({
    query: async <R>(text: string, params?: unknown[]) => ({ rows: [...(await q.unsafe(text, params ?? []))] as R[] }),
  });

  beforeAll(async () => {
    const name = 'postgres';
    const { default: postgres } = await import(/* @vite-ignore */ name);
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${scratch}`);
    const url = new URL(URL_ENV!);
    url.pathname = `/${scratch}`;
    sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
    await sql.unsafe(shimForServer(SUPABASE_SHIM));
    for (const file of migrationFiles()) await sql.unsafe(migrationSql(file));
    db = { ...adapt(sql), transaction: (fn) => sql.begin((tx: Postgres) => fn(adapt(tx))) };

    [{ id: kid }] = await sql.unsafe(`insert into auth.users default values returning id`);
    const [{ org_id: org }] = await sql.unsafe(`select org_id from public.membership where user_id = $1`, [kid]);
    for (let s = 0; s < 3; s++) {
      const session = crypto.randomUUID();
      await sql.unsafe(
        `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'quiz', now())`,
        [session, org, kid],
      );
      for (let n = 0; n < 4; n++) {
        await sql.unsafe(
          `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
           values ($1, $2, $3, $4, $5, now(), 'answered', 'quiz', 'tap', $6, $7::jsonb)`,
          [
            crypto.randomUUID(), org, kid, session, n + 1, [n % 2 ? DEFINE : CLOSURE],
            JSON.stringify({ correct: n % 2 === 1, chosenIndex: n % 2 ? 0 : 2, probeId: `p-${s}-${n}`, assistanceRung: 0 }),
          ],
        );
      }
    }
  }, 300_000);

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop database if exists ${scratch}`);
    await admin?.end();
  });

  const rowsOf = async () =>
    (
      await sql.unsafe(
        `select to_jsonb(cs) - 'updated_at' as row from public.concept_state cs where user_id = $1 order by outcome_id`,
        [kid],
      )
    ).map((r: { row: unknown }) => r.row);

  it('two runs over one learner at once both finish, leave what one run leaves, and never show half a model', async () => {
    await think(db, [kid]);
    const once = await rowsOf();
    expect(once.length).toBeGreaterThan(0);

    let running = true;
    const seen = new Set<number>();
    const reader = (async () => {
      while (running) {
        const [{ n }] = await sql.unsafe(`select count(*)::int as n from public.concept_state where user_id = $1`, [kid]);
        seen.add(n);
      }
    })();
    const runs = await Promise.allSettled([think(db, [kid]), think(db, [kid]), think(db, [kid])]);
    running = false;
    await reader;

    expect(runs.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect([...seen]).toEqual([once.length]);
    expect(await rowsOf()).toEqual(once);
  }, 120_000);
});
