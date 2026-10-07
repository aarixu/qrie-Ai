import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { migrate, migrationFiles } from '../../../supabase/tests/harness.ts';

/**
 * The demo school's database: PGlite with the Supabase shim and every
 * migration, exactly as the tests build it (supabase/tests/harness.ts) — so
 * the demo runs the same RLS, triggers and functions as production. Kept on
 * disk when given a directory, in memory otherwise.
 *
 * Two schemas are the demo's own and exist nowhere else: demo_meta (which
 * migrations built this database) and demo_auth (school ID + PIN sign-in,
 * standing in for Supabase Auth). Neither is readable by `authenticated`.
 */

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

export function migrationsFingerprint(): string {
  const h = createHash('sha256');
  for (const f of migrationFiles()) h.update(f).update(fs.readFileSync(path.join(MIGRATIONS, f)));
  return h.digest('hex');
}

const DEMO_SCHEMAS = `
create schema demo_meta;
create table demo_meta.info (key text primary key, value text not null);
create schema demo_auth;
create table demo_auth.login (
  login_id text primary key,
  user_id uuid not null unique references auth.users on delete cascade,
  salt text not null,
  hash text not null,
  failures integer not null default 0,
  locked_until timestamptz
);
revoke all on schema demo_meta, demo_auth from public, anon, authenticated;
`;

// Added after the first demo databases were built, so made on every open
// rather than only on a fresh one: an older demo keeps its data.
const DEMO_SESSIONS = `
create table if not exists demo_auth.session (
  token_hash text primary key,
  user_id uuid not null references auth.users on delete cascade,
  until timestamptz not null
);
revoke all on demo_auth.session from public, anon, authenticated;
`;

export async function openDemoDatabase(dir?: string): Promise<PGlite> {
  const existing = dir !== undefined && fs.existsSync(path.join(dir, 'PG_VERSION'));
  const db = dir === undefined ? new PGlite() : new PGlite(dir);
  if (existing) {
    const { rows } = await db.query<{ value: string }>(
      `select value from demo_meta.info where key = 'migrations'`,
    );
    if (rows[0]?.value !== migrationsFingerprint()) {
      await db.close();
      throw new Error(
        'The demo database was built from different migrations than the ones in this checkout. ' +
          'Start the demo again with --reset to rebuild it (the demo data is recreated).',
      );
    }
    await db.exec(DEMO_SESSIONS);
    return db;
  }
  await migrate(db);
  await db.exec(DEMO_SCHEMAS);
  await db.query(`insert into demo_meta.info (key, value) values ('migrations', $1)`, [migrationsFingerprint()]);
  await db.exec(DEMO_SESSIONS);
  return db;
}

export async function isSeeded(db: PGlite): Promise<boolean> {
  return (await db.query(`select 1 from lms.school limit 1`)).rows.length > 0;
}
