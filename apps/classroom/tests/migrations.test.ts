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
