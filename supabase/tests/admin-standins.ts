import type { PGlite } from '@electric-sql/pglite';

/**
 * Three tables the hosted project has and the harness does not: pg_cron's run
 * history, Supabase Auth's authenticator factors, and the Supabase CLI's list
 * of applied migrations. The admin functions look for each with to_regclass
 * when they are called, so a test adds them to see what the console reads on
 * a hosted project. Only the columns those functions read are here. Their
 * hosted shapes are UNVERIFIED until the first check against a real project.
 */
export async function addHostedStandIns(db: PGlite): Promise<void> {
  await db.exec(`
    create table if not exists cron.job_run_details (
      jobid bigint, runid bigserial primary key, job_pid integer, database text, username text, command text,
      status text, return_message text, start_time timestamptz, end_time timestamptz
    );
    create table if not exists auth.mfa_factors (
      id uuid primary key default gen_random_uuid(), user_id uuid not null, friendly_name text,
      factor_type text not null, status text not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, name text);
  `);
}
