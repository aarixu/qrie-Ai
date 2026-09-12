import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE POLICY MUST EXIST AS A MIGRATION, NOT AS A COMMENT.
 *
 * It used to live only in a docstring in supabase.ts, which is not a
 * permission: until it runs on the project, the anon key that ships in the
 * bundle can select the whole table. These tests cannot reach the live
 * project — that check is a human one — but they can stop the migration from
 * being quietly deleted or weakened, which is how this kind of thing is
 * actually lost.
 */

const dir = path.resolve(process.cwd(), 'supabase/migrations');
const sqlOf = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8');

describe('the student_state migration', () => {
  const sql = sqlOf('0001_student_state.sql');

  it('creates the table with the composite key the client upserts on', () => {
    expect(sql).toMatch(/create table if not exists public\.student_state/i);
    expect(sql).toMatch(/primary key \(user_id, key\)/i);
  });

  it('cascades the work away with the account', () => {
    expect(sql).toMatch(/references auth\.users on delete cascade/i);
  });

  it('turns row level security ON', () => {
    expect(sql).toMatch(/alter table public\.student_state enable row level security/i);
  });

  it('lets a student touch only their own rows, on read AND on write', () => {
    // `using` guards what can be read; `with check` guards what can be
    // written. A policy with only the first lets one student write rows
    // under another student's id.
    expect(sql).toMatch(/using \(auth\.uid\(\) = user_id\)/i);
    expect(sql).toMatch(/with check \(auth\.uid\(\) = user_id\)/i);
  });
});

describe('the account deletion migration', () => {
  const sql = sqlOf('0002_deleted_account.sql');

  it('deletes the auth user, not merely their rows', () => {
    expect(sql).toMatch(/delete from auth\.users/i);
  });

  it('refuses when nobody is signed in, rather than deleting by null', () => {
    expect(sql).toMatch(/auth\.uid\(\) is null/i);
    expect(sql).toMatch(/raise exception/i);
  });

  it('deletes only the caller', () => {
    expect(sql).toMatch(/where id = auth\.uid\(\)/i);
  });

  it('is callable by a signed-in student and nobody else', () => {
    expect(sql).toMatch(/revoke all on function public\.delete_own_account\(\) from public/i);
    expect(sql).toMatch(/grant execute on function public\.delete_own_account\(\) to authenticated/i);
  });
});

describe('the tenancy migration', () => {
  const sql = sqlOf('0005_tenancy.sql');

  it('gives every role the LMS will need, so the check is not altered later', () => {
    expect(sql).toMatch(/check \(role in \('admin', 'teacher', 'student'\)\)/i);
  });

  it('resolves membership through a definer function, or RLS recurses forever', () => {
    // A policy on `membership` that reads `membership` recurses until Postgres
    // gives up. This function is the way out, and it only works as definer.
    expect(sql).toMatch(/create or replace function public\.is_member/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/using \(public\.is_member\(org_id\)\)/i);
  });

  it('provisions the org in Postgres, not in the app', () => {
    // Anonymous sign-in never passes through app code we control, and the
    // ledger needs an org on the student's very first event.
    expect(sql).toMatch(/create trigger on_auth_user_created/i);
    expect(sql).toMatch(/after insert on auth\.users/i);
  });

  it('lets nobody write their own tenancy from a browser', () => {
    // Membership is what every ledger policy trusts. A student who could write
    // it could seat themselves inside someone else's school.
    expect(sql).not.toMatch(/create policy[^;]*on public\.membership\s+for (insert|update|delete)/i);
    expect(sql).not.toMatch(/create policy[^;]*on public\.organization\s+for (insert|update|delete)/i);
  });

  it('backfills accounts that existed before it, or they can never write an event', () => {
    expect(sql).toMatch(/from auth\.users u/i);
    expect(sql).toMatch(/not exists \(select 1 from public\.membership/i);
  });
});

describe('the ledger migration', () => {
  const sql = sqlOf('0006_ledger.sql');

  it('takes the id from the device instead of generating one', () => {
    // The client mints it when the event happens, and it is the primary key —
    // which is what makes replaying a half-failed drain a no-op instead of a
    // duplicate answer inflating mastery.
    expect(sql).toMatch(/id uuid primary key,/i);
    expect(sql).not.toMatch(/id uuid primary key default/i);
  });

  it('is APPEND-ONLY, enforced by the absence of a policy', () => {
    // The learner model is rebuilt from these rows. A student who could edit
    // them could edit what the system believes about them.
    expect(sql).toMatch(/for select using \(auth\.uid\(\) = user_id\)/i);
    expect(sql).toMatch(/for insert with check/i);
    expect(sql).not.toMatch(/on public\.ledger_event[\s\S]{0,80}for (update|delete)/i);
    expect(sql).not.toMatch(/on public\.learning_session[\s\S]{0,80}for (update|delete)/i);
  });

  it('pins an insert to both the caller and their organization', () => {
    // user_id alone would let a student file answers into someone else's school.
    expect(sql).toMatch(/with check \(auth\.uid\(\) = user_id and public\.is_member\(org_id\)\)/i);
  });

  it('cannot be made to hold two events at one position in a session', () => {
    expect(sql).toMatch(/create unique index[\s\S]{0,80}ledger_event \(session_id, seq\)/i);
  });

  it('keeps both clocks, because a phone clock cannot be trusted', () => {
    expect(sql).toMatch(/at timestamptz not null,/i);
    expect(sql).toMatch(/received_at timestamptz not null default now\(\)/i);
  });

  it('records time ON TASK, which the primary metric divides by', () => {
    expect(sql).toMatch(/active_ms integer/i);
  });

  it('closes a session through a function, and only once', () => {
    expect(sql).toMatch(/create or replace function public\.close_learning_session/i);
    expect(sql).toMatch(/and ended_at is null/i);
    expect(sql).toMatch(/grant execute on function public\.close_learning_session/i);
  });
});

describe('the retention migration', () => {
  const sql = sqlOf('0007_retention.sql');

  it('takes the empty solo org with the last member who left it', () => {
    // ledger_event and learning_session already cascaded from auth.users, but
    // the org created by the 0005 trigger referenced nothing that does — so
    // deleting an account left a row behind forever.
    expect(sql).toMatch(/create trigger on_membership_removed/i);
    expect(sql).toMatch(/after delete on public\.membership/i);
    expect(sql).toMatch(/and o\.kind = 'solo'/i);
  });

  it('leaves a school with no members alone', () => {
    // A school between terms is not rubbish.
    expect(sql).toMatch(/o\.kind = 'solo'/i);
    expect(sql).not.toMatch(/delete from public\.organization[\s\S]{0,200}kind = 'school'/i);
  });

  it('ages rows by the SERVER clock, never the phone', () => {
    // A device set to 2019 would have its events purged on arrival.
    expect(sql).toMatch(/where received_at < cutoff/i);
    expect(sql).not.toMatch(/where at < cutoff/i);
  });

  it('never orphans half a session', () => {
    expect(sql).toMatch(/not exists \(select 1 from public\.ledger_event e where e\.session_id = s\.id\)/i);
  });

  it('is an operator tool and unreachable from a browser', () => {
    // A purge a student could call is a purge a student could call with 1 day.
    expect(sql).toMatch(/revoke all on function public\.purge_old_ledger\(integer\) from anon/i);
    expect(sql).toMatch(/revoke all on function public\.purge_old_ledger\(integer\) from authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.purge_old_ledger\(integer\) to service_role/i);
  });

  it('refuses a zero or negative window', () => {
    expect(sql).toMatch(/greatest\(p_days, 1\)/i);
  });
});
