import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * A real Postgres, in-process, with every migration applied.
 *
 * PGlite is Postgres compiled to WASM: triggers, RLS, SECURITY DEFINER and
 * roles all behave as they do on the hosted project, which is the point — a
 * test can `set role authenticated`, claim to be a student, and see only what
 * the policies let that student see.
 *
 * It is NOT Supabase. Three things the hosted project provides are stood in
 * for by SUPABASE_SHIM below, and each stand-in is deliberately the smallest
 * thing the migrations touch — nothing a migration does not reference is
 * faked, so a migration that starts relying on more fails here loudly instead
 * of passing against a stub that happens to be generous.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

/**
 * What the hosted project has before migration 0001 runs.
 *
 * - `auth.users` with the columns the migrations and these tests use, and
 *   `auth.uid()` reading the JWT subject the way Supabase's does.
 * - The three API roles. `service_role` has BYPASSRLS, as it does on the
 *   platform — that is what lets the relay write past student policies.
 * - Supabase's default grants on `public`, so a policy is the only thing
 *   standing between a student and a row, exactly as in production.
 * - The two `storage` tables 0004 touches, and the two `cron` functions 0009
 *   calls, which record the schedule so a test can read it back.
 */
export const SUPABASE_SHIM = `
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets,
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
-- The platform's own helper, as Supabase defines it: every path segment but
-- the file name.
create function storage.foldername(name text) returns text[]
language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

create schema cron;
create table cron.job (
  jobid bigserial primary key,
  jobname text unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean
language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then
    raise exception 'could not find valid entry for job ''%''', job_name;
  end if;
  return true;
end
$$;
`;

/**
 * The one statement PGlite cannot run. pg_cron is a server extension that
 * does not exist in WASM; the shim's `cron` schema stands in for it. Anything
 * else a migration asks for that PGlite lacks should fail, not be edited out.
 */
function forPGlite(sql: string): string {
  return sql.replace(/create extension if not exists pg_cron\s*;/gi, '-- pg_cron: stood in for by the harness shim');
}

/** One migration's SQL as the harness runs it, with pg_cron stood in for. */
export function migrationSql(file: string): string {
  return forPGlite(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
}

async function apply(db: PGlite, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const sql = migrationSql(file);
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`${file} failed on the harness: ${(error as Error).message}`);
    }
  }
}

/**
 * Every migration, or — with `through` — only those up to and including the
 * one whose name starts with that prefix. The second form exists for backfill
 * tests: production already holds rows written before a new migration, so a
 * migration is tested against data that predates it, via `applyAfter`.
 */
/**
 * The shim and every migration, onto a database the caller opened — the demo
 * school (tools/lms-demo) keeps its database on disk, so it cannot use
 * freshDatabase's in-memory one.
 */
export async function migrate(db: PGlite): Promise<void> {
  await db.exec(SUPABASE_SHIM);
  await apply(db, migrationFiles());
}

export async function freshDatabase(opts: { through?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const all = migrationFiles();
  const cut = opts.through ? all.findIndex((f) => f.startsWith(opts.through!)) : all.length - 1;
  if (cut < 0) throw new Error(`no migration starts with ${opts.through}`);
  await apply(db, all.slice(0, cut + 1));
  return db;
}

/** Applies every migration after the one whose name starts with `through`. */
export async function applyAfter(db: PGlite, through: string): Promise<void> {
  const all = migrationFiles();
  const cut = all.findIndex((f) => f.startsWith(through));
  if (cut < 0) throw new Error(`no migration starts with ${through}`);
  await apply(db, all.slice(cut + 1));
}

type Tx = Parameters<Parameters<PGlite['transaction']>[0]>[0];

/**
 * A new auth user, created the way the platform creates one — so every
 * `on insert` trigger on auth.users fires. `appMeta` is the service-role-only
 * `app_metadata` a client can never set on itself.
 */
export async function createUser(
  db: PGlite,
  opts: { appMeta?: Record<string, unknown>; createdAt?: string } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (raw_app_meta_data, created_at)
     values ($1::jsonb, coalesce($2::timestamptz, now())) returning id`,
    [JSON.stringify(opts.appMeta ?? {}), opts.createdAt ?? null],
  );
  return rows[0].id;
}

export async function createSchool(db: PGlite, name = 'Test School'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.organization (kind, name) values ('school', $1) returning id`,
    [name],
  );
  return rows[0].id;
}

/** What the LMS import does with the service role: seat a user in an org. */
export async function enrol(db: PGlite, orgId: string, userId: string, role = 'student'): Promise<void> {
  await db.query(
    `insert into public.membership (org_id, user_id, role) values ($1, $2, $3)`,
    [orgId, userId, role],
  );
}

/**
 * Runs `fn` as a signed-in student would reach the database: the
 * `authenticated` role, with `auth.uid()` returning `userId`. RLS applies.
 */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    return fn(tx);
  });
}

/** Runs `fn` as the relay's service role: RLS is bypassed, grants still apply. */
export async function asService<T>(db: PGlite, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return fn(tx);
  });
}
