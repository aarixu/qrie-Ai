-- SCHOOL-SAFE TENANCY: what must be true before the first school org exists.
--
-- Four things deployed before this migration are right for a student alone
-- and wrong for a school (final plan, Part 1 item 8). None has hurt anyone yet,
-- because no organization of kind 'school' exists. Each is cheap to fix now and
-- expensive once real children's rows sit under a school.
--
-- Every behaviour below is exercised against a real Postgres, as a real
-- student role, in supabase/tests/school-safe-tenancy.test.ts. Those tests
-- were written first and watched failing against 0001-0020.
--
--   1. 'parent' is reserved as a membership role, so adding parents later is
--      an INSERT and not a constraint change (final plan, decision 14).
--   2. The ledger accepts the sources the LMS will write: homework, test,
--      practice, api.
--   3. One rule answers "which org is this student's": org_of(). A school
--      membership wins over a solo one. fill_org_id now asks it instead of
--      taking the earliest membership, which was always the solo org, and so
--      does the relay's prep lock (packages/relay/src/prep.ts) — so this
--      migration must be applied before that relay is deployed.
--      ONE COPY REMAINS: apps/classroom/src/lib/ledgerSync.ts resolves the
--      org itself with .limit(1) and no order. It belongs to the tutor
--      session and is left for it to move to current_org_id(). Until then it
--      matters only to a student with two memberships, which after this
--      migration only a self-signed-up student later enrolled in a school
--      can have.
--   4. An account the school created gets no private solo org.
--   5. A student reads only their own membership rows. The old policy let every
--      member of an org read every membership of it — in a school, the roster
--      of minors.
--   6. The nightly purge deletes only what the server fold has already covered.
--      There is no server fold yet, so until one writes purge_safe_before the
--      purge deletes NO ledger events. That is the intended trade: keeping a
--      little extra test data a while longer, rather than destroying evidence
--      that was never folded into anything.
--   7. A member of a school cannot delete their own account; the school does.
--   8. `learner`: one row per account, and room for a learner known only by an
--      org and that org's own id. It is the join between the tutor's data and
--      the LMS's (final plan, decision 15).
--   9. What a student may WRITE into the ledger, where there is a measured
--      basis for a limit (supabase/tests/ledger-integrity.test.ts). The insert
--      policy checked who and under which org, never what.
--      NOT limited here, deliberately: time on task and the help rung. Measured
--      2026-09-26, 28 of 42 closed sessions report more active time than their
--      own start-to-end span, and the 20 quiz sessions average ~1,450x.
--      quizLedger.ts:88 records that a quiz's started_at used to be stamped at
--      grading, which would produce exactly this; whether these rows predate
--      that fix is UNVERIFIED. Either way, a cap on active_ms today would
--      reject rows as clients really write them. Homework sessions are written
--      by the server (LMS build plan, L3), where this cannot arise.

-- 1 -------------------------------------------------------------------------
alter table public.membership drop constraint if exists membership_role_check;
alter table public.membership add constraint membership_role_check
  check (role in ('admin', 'teacher', 'student', 'parent'));

-- 2 -------------------------------------------------------------------------
alter table public.learning_session drop constraint if exists learning_session_source_check;
alter table public.learning_session add constraint learning_session_source_check
  check (source in ('class', 'quiz', 'diagnostic', 'doubt', 'homework', 'test', 'practice', 'api'));

alter table public.ledger_event drop constraint if exists ledger_event_source_check;
alter table public.ledger_event add constraint ledger_event_source_check
  check (source in ('class', 'quiz', 'diagnostic', 'doubt', 'homework', 'test', 'practice', 'api'));

-- 3 -------------------------------------------------------------------------
-- org_of is the rule. It is SECURITY DEFINER because it reads membership past
-- RLS, and for the same reason it is closed to students: the answer for
-- another child is not theirs to have. current_org_id() is the student-facing
-- door, and it can only ever ask about the caller.
--
-- The final org_id tie-break makes the answer deterministic even when two
-- memberships share a created_at, which a bulk import can produce.
create or replace function public.org_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id
    from public.membership m
    join public.organization o on o.id = m.org_id
   where m.user_id = p_user
   order by (o.kind = 'school') desc, m.created_at asc, m.org_id asc
   limit 1;
$$;

revoke all on function public.org_of(uuid) from public, anon, authenticated;
grant execute on function public.org_of(uuid) to service_role;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.org_of(auth.uid());
$$;

revoke all on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated, service_role;

create or replace function public.fill_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is null then
    new.org_id := public.org_of(new.user_id);
  end if;
  return new;
end;
$$;

-- 4 -------------------------------------------------------------------------
-- The LMS import creates school accounts with the service role and sets
-- app_metadata.provisioned_by = 'school'. app_metadata cannot be written by
-- the user it belongs to, so a student cannot use this to dodge a solo org.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  when (coalesce(new.raw_app_meta_data ->> 'provisioned_by', '') <> 'school')
  execute function public.provision_solo_org();

-- 5 -------------------------------------------------------------------------
-- A teacher's view of a roster arrives with the section tables, scoped to the
-- sections they teach (LMS build plan, L1). Until then nobody reads anybody
-- else's membership from a browser.
drop policy if exists "read memberships of your organizations" on public.membership;
drop policy if exists "read your own memberships" on public.membership;
create policy "read your own memberships" on public.membership
  for select
  using (user_id = auth.uid());

-- 6 -------------------------------------------------------------------------
-- purge_safe_before is written by the server fold (LMS build plan, L6) to say
-- "every event this user sent before this instant is folded". Nothing writes
-- it yet, so it is null for everyone and the purge below deletes no events.
alter table public.learner_model add column if not exists purge_safe_before timestamptz;

create or replace function public.purge_old_ledger(p_days integer default 90)
returns table (events_deleted bigint, sessions_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  ev bigint;
  se bigint;
begin
  delete from public.ledger_event e
   using public.learner_model lm
   where lm.user_id = e.user_id
     and lm.purge_safe_before is not null
     and e.received_at < least(cutoff, lm.purge_safe_before);
  get diagnostics ev = row_count;

  delete from public.learning_session s
   where s.received_at < cutoff
     and not exists (select 1 from public.ledger_event e where e.session_id = s.id);
  get diagnostics se = row_count;

  return query select ev, se;
end;
$$;

-- 7 -------------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if exists (
    select 1
      from public.membership m
      join public.organization o on o.id = m.org_id
     where m.user_id = auth.uid()
       and o.kind = 'school'
  ) then
    raise exception 'This account belongs to a school. Ask your school to delete it.'
      using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- 8 -------------------------------------------------------------------------
create table if not exists public.learner (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users on delete cascade,
  org_id uuid references public.organization on delete cascade,
  external_id text,
  created_at timestamptz not null default now(),
  constraint learner_is_a_login_or_an_org_scoped_id
    check (auth_user_id is not null or (org_id is not null and external_id is not null)),
  constraint learner_external_id_unique_per_org unique (org_id, external_id)
);

alter table public.learner enable row level security;

-- Read your own; write nothing. Learners are created by the trigger below and
-- by the service role, never from a browser.
drop policy if exists "read your own learner" on public.learner;
create policy "read your own learner" on public.learner
  for select
  using (auth_user_id = auth.uid());

revoke insert, update, delete on public.learner from anon, authenticated;

create or replace function public.provision_learner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.learner (auth_user_id) values (new.id)
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.provision_learner() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_learner on auth.users;
create trigger on_auth_user_created_learner
  after insert on auth.users
  for each row execute function public.provision_learner();

-- Every account that exists before this migration gets its learner. Idempotent.
insert into public.learner (auth_user_id)
select u.id from auth.users u
on conflict (auth_user_id) do nothing;

-- 9 -------------------------------------------------------------------------
-- 4 KB is ~18x the largest payload in the live ledger (230 bytes over 162
-- events, measured 2026-09-26). 200 is the client's own cap on a stored answer,
-- MAX_ANSWER_CHARS in packages/ledger/src/normalise.ts; the longest live one
-- was 12. Both hold for every existing row, so the constraints validate as
-- they are added.
alter table public.ledger_event drop constraint if exists ledger_event_payload_size;
alter table public.ledger_event add constraint ledger_event_payload_size
  check (octet_length(payload::text) <= 4096);

alter table public.ledger_event drop constraint if exists ledger_event_answer_length;
alter table public.ledger_event add constraint ledger_event_answer_length
  check (char_length(coalesce(payload ->> 'answerNormalised', '')) <= 200);
