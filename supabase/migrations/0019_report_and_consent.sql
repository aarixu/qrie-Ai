-- A CHILD'S REPORT MUST REACH A PERSON, AND A PARENT'S CONSENT MUST BE A ROW.
--
-- Two obligations, one migration, because both are the same shape: something
-- a child or a parent did that today evaporates on the phone becomes a row
-- the service role can write and an operator can read. ReportSheet writes
-- localStorage and nothing leaves the device -- a report button that files
-- complaints into a drawer nobody opens. Enrolment has nowhere at all to put
-- "this parent said yes, and proved they hold this phone". This file is
-- where both go.
--
-- THE HOUSE RULE HOLDS THROUGHOUT: RLS on, ZERO policies, on every table
-- here. The only way in is the service role -- through a definer function
-- where Postgres has to compute an answer, directly where it does not -- and
-- a student holding the anon key can neither read another child's report nor
-- write anybody's consent. Reads are an operator's job through the service
-- role, exactly like usage_cost.

-- ---------------------------------------------------------------------------
-- 1. student_report: what a child said went wrong, kept exactly once.
--
-- THE NAME. PRD 3 requirement 22 calls this table `child_report`, and PRD 6's
-- triage job and PRD 3's admin predicate are written against that name. It is
-- `student_report` here and deliberately: every other table in this schema
-- names the person as a student (student_state, and the app's whole
-- vocabulary), and "child_report" reads as a report ABOUT a child rather than
-- one FROM one. THE DOWNSTREAM PHASES MUST USE THIS NAME; if the PRD's is
-- preferred, rename here while the table is still a file, not after.
--
-- The note is the child's words, PII-scrubbed on the CLIENT before it is
-- sent; the relay deliberately does not re-clean it (a second cleaner is a
-- second place for the words to be silently altered) and only holds the cap.
-- 2000 characters mirrors MAX_REPORT_NOTE_CHARS in packages/relay/src/
-- report.ts, and migrations.test.ts asserts the two are equal -- the same
-- drift check the day budget has, for the same reason.
-- ---------------------------------------------------------------------------
create table if not exists public.student_report (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- Nullable, filled by the 0018 trigger below; SET NULL so a report never
  -- blocks account deletion, the argument 0018 already made for these.
  org_id uuid references public.organization on delete set null,
  kind text not null check (kind in ('wrong', 'rude', 'unsafe', 'other')),
  note text not null check (char_length(note) <= 2000),
  lesson_id text not null,
  topic_ref text,
  beat_id text,
  spoken_line text,
  session_id uuid,
  release text,
  -- The two the app can be, exactly as PRD 1's ReportSubmission spells them.
  -- readStudentReport refuses anything else with a 400, so this constraint
  -- should never fire -- it is the fence behind the fence, like the phone.
  platform text check (platform in ('web', 'android')),
  -- Both clocks, like the ledger: the phone said when the child reported,
  -- the server says when it heard. A phone clock cannot be trusted alone,
  -- but `at` is also part of the idempotency key, so it is kept verbatim.
  at timestamptz not null,
  received_at timestamptz not null default now(),
  -- THE TRIAGE HALF, from PRD 3 requirement 22. Without these an operator
  -- can read the queue and cannot work it: no way to mark a report seen, no
  -- record of what was done, and PRD 6's 24-hour clock has nothing to
  -- measure. The relay never writes them -- keep_student_report does not
  -- take them and they keep their defaults -- so they exist for the triage
  -- surface PRD 6 owns, poured now because adding columns to a table with
  -- child safety reports in it is a worse afternoon than adding them to a
  -- file.
  status text not null default 'new' check (status in ('new', 'seen', 'actioned', 'dismissed')),
  actioned_at timestamptz,
  action_note text
);

-- THE IDEMPOTENCY KEY, HONESTLY. (user, lesson, beat, at) -- beat_id is
-- nullable and Postgres treats NULLs as distinct in a plain unique
-- constraint, so a report made outside any beat could be duplicated freely.
-- The expression index closes that: null and '' dedupe as one. The relay
-- retries a POST whose response was lost, and the retry must be the SAME
-- report in front of whoever reads the queue, not a second one.
create unique index if not exists student_report_dedupe
  on public.student_report (user_id, lesson_id, coalesce(beat_id, ''), at);

-- The queue is read newest-first by a person, and what a person actually
-- asks for is "what have I not dealt with" -- so the index is partial on the
-- unworked rows. A report's whole life in the queue is the few hours
-- between 'new' and 'actioned'; indexing the years afterwards buys nothing.
create index if not exists student_report_received
  on public.student_report (received_at desc) where status = 'new';

alter table public.student_report enable row level security;
revoke all on table public.student_report from anon, authenticated;

-- The same org attribution every relay-written table got in 0018, from the
-- same function, so a school pilot can answer "whose students reported".
drop trigger if exists student_report_fill_org on public.student_report;
create trigger student_report_fill_org
  before insert on public.student_report
  for each row execute function public.fill_org_id();

-- A DEFINER FUNCTION AND NOT A DIRECT INSERT, decided out loud: the retry
-- must come back with the SAME id, and only Postgres -- where the unique
-- index lives -- can do insert-or-fetch-the-survivor atomically in one round
-- trip. A plain PostgREST insert can ignore a duplicate but cannot say
-- "already there, and here is its id".
--
-- It returns `fresh` as well as the id, because the caller has one decision
-- to make with it: the ops alert fires only for a row this call created. A
-- client retrying through a flaky connection writes ONE report and must not
-- ring a person's phone five times about it -- an alert channel that cries
-- repeatedly is a channel somebody mutes, and this one is the only thing
-- that says a child's report exists.
create or replace function public.keep_student_report(
  p_user uuid,
  p_kind text,
  p_note text,
  p_lesson text,
  p_topic text,
  p_beat text,
  p_spoken text,
  p_session uuid,
  p_release text,
  p_platform text,
  p_at timestamptz
)
returns table (report_id uuid, fresh boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  kept uuid;
  was_fresh boolean := true;
begin
  if p_user is null or p_lesson is null or p_lesson = '' or p_at is null then
    raise exception 'a report needs a user, a lesson and a time';
  end if;

  insert into public.student_report
    (user_id, kind, note, lesson_id, topic_ref, beat_id, spoken_line, session_id, release, platform, at)
  values
    (p_user, p_kind, p_note, p_lesson, p_topic, p_beat, p_spoken, p_session, p_release, p_platform, p_at)
  on conflict (user_id, lesson_id, coalesce(beat_id, ''), at) do nothing
  returning id into kept;

  -- Lost the race, or a retry: the survivor's id is the answer either way,
  -- and either way this call did not create it.
  if kept is null then
    was_fresh := false;
    select r.id into kept
      from public.student_report r
     where r.user_id = p_user
       and r.lesson_id = p_lesson
       and coalesce(r.beat_id, '') = coalesce(p_beat, '')
       and r.at = p_at;
  end if;

  return query select kept, was_fresh;
end;
$$;

revoke all on function public.keep_student_report(uuid, text, text, text, text, text, text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.keep_student_report(uuid, text, text, text, text, text, text, uuid, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. consent_record: THE DPDP VERIFIABLE-PARENTAL-CONSENT ARTIFACT.
--
-- The users are children. India's DPDP Act wants consent from a parent that
-- can be shown to have happened, not inferred from a checkbox: this row says
-- WHICH parent (name and phone), WHEN they consented, HOW they proved they
-- hold the phone (otp_verified_at, stamped by the relay after the code came
-- back right), and through which door (contest or self-serve). It is the
-- artifact an auditor is shown.
--
-- ON DELETE CASCADE with the account, deliberately: once the account and
-- every record about the child are erased (0002), a consent covering data
-- we no longer hold would itself be retained parent PII with no basis.
-- Deleting the child's data deletes the permission slip with it.
--
-- A user may hold several rows -- a re-enrolment is a NEW consent, and
-- consent history is precisely what must not be overwritten in place.
-- ---------------------------------------------------------------------------
create table if not exists public.consent_record (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  parent_name text not null check (char_length(parent_name) <= 80),
  -- E.164, the one canonical shape, or per-phone limits fragment. The relay
  -- validates first; this is the fence behind the fence.
  parent_phone text not null check (parent_phone ~ '^\+[1-9][0-9]{7,14}$'),
  consent_at timestamptz not null default now(),
  source text not null check (source in ('contest', 'self_serve')),
  otp_verified_at timestamptz not null,
  contest_code text
);

create index if not exists consent_record_user on public.consent_record (user_id);

alter table public.consent_record enable row level security;
revoke all on table public.consent_record from anon, authenticated;

-- No definer function here, also decided out loud: nothing about a consent
-- needs computing in Postgres -- no idempotency read-back, no counter -- so
-- the relay inserts directly with the service role, the same door
-- keepClass's catalogue row uses, and there is one fewer function to audit.

-- ---------------------------------------------------------------------------
-- 3. otp_send and claim_otp_send: THE METER ON THE SMS BILL.
--
-- An OTP costs real money per send and identities are free, so the limit is
-- keyed on the PHONE first -- the thing that is actually billed -- and the
-- user second, so one account cannot spray codes across a phone book. It
-- lives in Postgres for exactly the ledger's reason: Edge Function
-- instances are many and short-lived, and a per-instance Map is no meter.
--
-- The constants mirror OTP_SENDS_PER_PHONE_BURST and friends in
-- packages/relay/src/enroll.ts, and migrations.test.ts asserts each pair
-- equal, like UNITS_PER_DAY.
-- ---------------------------------------------------------------------------
create table if not exists public.otp_send (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  phone text not null,
  sent_at timestamptz not null default now()
);

create index if not exists otp_send_phone_at on public.otp_send (phone, sent_at desc);
create index if not exists otp_send_user_at on public.otp_send (user_id, sent_at desc);

alter table public.otp_send enable row level security;
revoke all on table public.otp_send from anon, authenticated;

create or replace function public.claim_otp_send(p_user uuid, p_phone text)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  burst_per_phone constant integer := 3;
  burst_window_minutes constant integer := 10;
  day_per_phone constant integer := 10;
  day_per_user constant integer := 10;
  -- THE LINE UNDER ALL OF THEM. Identities are free, so per-phone and
  -- per-user caps together still bound nothing: N anonymous accounts times
  -- ten sends times distinct phones is an unbounded bill with every key
  -- inside its limit. Same hole UNITS_PER_DAY had, same answer. Mirrors
  -- OTP_SENDS_PER_DAY_PROJECT in packages/relay/src/enroll.ts.
  day_project constant integer := 200;
  now_at timestamptz := now();
  day_start timestamptz := date_trunc('day', now_at at time zone 'utc') at time zone 'utc';
  in_burst integer;
  burst_oldest timestamptz;
  phone_today integer;
  user_today integer;
  project_today integer;
  midnight_in integer;
begin
  if p_user is null or p_phone is null or p_phone = '' then
    raise exception 'claim_otp_send needs a user and a phone';
  end if;

  -- Serialised per phone for this transaction, so two simultaneous claims
  -- cannot both count two sends and both admit a fourth. Count-then-insert
  -- without this is a race, and the race is exactly one paid SMS wide.
  perform pg_advisory_xact_lock(hashtext(p_phone));

  select count(*)::integer, min(sent_at) into in_burst, burst_oldest
    from public.otp_send
   where phone = p_phone
     and sent_at > now_at - make_interval(mins => burst_window_minutes);
  if in_burst >= burst_per_phone then
    -- The REAL remainder, not a flat ten minutes. The memory gate computes
    -- exactly this (createMemoryOtpGate, enroll.ts), and a parent told to
    -- wait ten minutes when two are left is a parent who goes away.
    return query select
      false,
      greatest(
        1,
        ceil(extract(epoch from (
          burst_oldest + make_interval(mins => burst_window_minutes) - now_at
        )))::integer
      );
    return;
  end if;

  midnight_in := greatest(
    1,
    ceil(extract(epoch from (day_start + interval '1 day' - now_at)))::integer
  );

  select count(*)::integer into phone_today
    from public.otp_send where phone = p_phone and sent_at >= day_start;
  select count(*)::integer into user_today
    from public.otp_send where user_id = p_user and sent_at >= day_start;
  if phone_today >= day_per_phone or user_today >= day_per_user then
    return query select false, midnight_in;
    return;
  end if;

  -- Last because it is the rarest to hit, and unindexed on purpose: the
  -- daily caps above keep this table to a few hundred rows a day, which is
  -- a sequential count of nothing.
  select count(*)::integer into project_today
    from public.otp_send where sent_at >= day_start;
  if project_today >= day_project then
    return query select false, midnight_in;
    return;
  end if;

  insert into public.otp_send (user_id, phone) values (p_user, p_phone);
  return query select true, 0;
end;
$$;

revoke all on function public.claim_otp_send(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_otp_send(uuid, text) to service_role;

-- NOTHING SWEEPS otp_send YET, and that is a decision, not an oversight:
-- the daily caps bound its growth to at most a handful of rows per real
-- phone per day, yesterday's rows decide nothing after midnight, and 0009
-- owns the cron surface -- adding a second scheduled job for a table this
-- small buys nothing today. If it ever needs a window, that is one line in
-- purge_old_ledger's migration lineage, made by somebody who means it.

-- ---------------------------------------------------------------------------
-- 4. extend_prep_lock: THE HEARTBEAT 0017'S LOCK NEVER HAD.
--
-- 0017 sized the TTL at 180 seconds against a preparation measured at
-- ninety-six -- on a development machine. The stated device is a cheap
-- Android. A preparation that runs past the TTL loses its lock in silence:
-- the next take_prep_lock sweeps the expired row, a second student wins it,
-- and both preparations run and both are paid for in full. That is exactly
-- the N-1-wasted-preparations failure 0017 exists to prevent, reappearing on
-- the slow phone where losing a preparation costs most.
--
-- HOLDER ONLY, for release_prep_lock's reason exactly: a student who lost
-- the race must not extend the winner's deadline. A renew that matches
-- nothing is false, not an exception -- by the time a slow phone asks, the
-- sweep may already have taken it, and that false is the signal to stop
-- preparing and wait for the winner's class.
-- ---------------------------------------------------------------------------
create or replace function public.extend_prep_lock(
  p_topic text,
  p_user uuid,
  p_ttl_seconds integer default 180
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  extended integer;
begin
  if p_topic is null or p_topic = '' or p_user is null then
    raise exception 'extend_prep_lock needs a topic and a user';
  end if;

  -- `expires_at > now()` as well as the ownership: a lock that has already
  -- lapsed may belong to somebody else by now, and resurrecting it would
  -- hand the topic back to a holder who had already lost it.
  update public.prep_lock
     set expires_at = now() + make_interval(secs => p_ttl_seconds)
   where topic_ref = p_topic
     and user_id = p_user
     and expires_at > now();

  get diagnostics extended = row_count;
  return extended > 0;
end;
$$;

revoke all on function public.extend_prep_lock(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_prep_lock(text, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. record_usage grows p_prep_id, so a call can say which preparation it
-- served. 0018 poured usage_event.prep_id; nothing wrote it.
--
-- A DROP, WHICH 0011 TAUGHT US NOT TO DO CASUALLY -- so here is why it is
-- safe where dropping close_learning_session was not: the signature has to
-- change, and `create or replace` on a new signature would OVERLOAD instead
-- of replace, leaving two record_usage functions where a 13-argument call
-- becomes ambiguous the day the old one is finally removed. The migration
-- runs in one transaction, so no request ever sees the gap; and p_prep_id
-- DEFAULTS to null, so the currently deployed relay -- which still sends 13
-- arguments until its next deploy -- keeps working against the new function.
-- The grants are restated whole because the drop takes the ACL with it.
-- ---------------------------------------------------------------------------
drop function if exists public.record_usage(uuid, uuid, text, text, text, integer, integer, integer, integer, integer, integer, integer, integer);

create function public.record_usage(
  p_user uuid,
  p_session uuid,
  p_relay text,
  p_provider text,
  p_model text,
  p_status integer,
  p_prompt_tokens integer,
  p_output_tokens integer,
  p_thought_tokens integer,
  p_images integer,
  p_characters integer,
  p_audio_bytes integer,
  p_bytes integer,
  p_prep_id uuid default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage_event (
    user_id, session_id, relay, provider, model, status,
    prompt_tokens, output_tokens, thought_tokens, images, characters, audio_bytes, bytes,
    prep_id
  ) values (
    p_user, p_session, p_relay, p_provider, p_model, coalesce(p_status, 0),
    p_prompt_tokens, p_output_tokens, p_thought_tokens, p_images, p_characters, p_audio_bytes, p_bytes,
    p_prep_id
  );
$$;

revoke all on function public.record_usage(uuid, uuid, text, text, text, integer, integer, integer, integer, integer, integer, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, uuid, text, text, text, integer, integer, integer, integer, integer, integer, integer, integer, uuid) to service_role;
