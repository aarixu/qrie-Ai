-- THE SCHEMA FLOOR, POURED WHILE THE TABLES ARE STILL EMPTY.
--
-- Every column a later phase needs, landed in one migration while the
-- per-student tables hold zero or near-zero rows. That window closes the day
-- the first real student arrives and never reopens: a column added afterwards
-- is a backfill across children's records, run in a hurry, by somebody who
-- would much rather not be running it.
--
-- THE CONSTRAINT ABOVE ALL OTHERS: ZERO BEHAVIOUR CHANGE. Every writer that
-- works today keeps working untouched -- the client upserts student_state
-- without org_id, claim_relay writes relay_usage without it, record_usage
-- writes usage_event without it, keepClass writes prepared_class without it.
-- So every column here is NULLable, every fill happens inside Postgres on the
-- way in, and NOT ONE row-security rule changes anywhere in this file.
-- Teacher visibility is a later, deliberate permission change made with its
-- own migration and its own reasoning; today this is data plumbing only, and
-- migrations.test.ts asserts the absence out loud.

-- ---------------------------------------------------------------------------
-- 1. org_id, on the four tables that never carried one.
--
-- learning_session, ledger_event (0006) and concept_state (0013) were born
-- with org_id. These four were born before 0005 existed or serve the relay
-- alone, and a school pilot cannot answer "whose students spent this"
-- without the column.
--
-- ON DELETE SET NULL, not cascade and not restrict, for one reason:
-- delete_own_account (0002) deletes auth.users and lets the cascades take
-- the student's rows; the last membership going then fires
-- on_membership_removed (0007), which deletes the now-empty solo org. A
-- `restrict` here would make that org delete -- and therefore account
-- deletion itself -- fail on the first table that still pointed at it. A
-- `cascade` would delete a shared prepared class because its first author
-- left. SET NULL keeps deletion clean in both directions: the student's own
-- rows are already gone with the user cascade, and anything shared survives
-- with its attribution blanked rather than its existence revoked.
-- ---------------------------------------------------------------------------
alter table public.student_state
  add column if not exists org_id uuid references public.organization on delete set null;

alter table public.relay_usage
  add column if not exists org_id uuid references public.organization on delete set null;

alter table public.usage_event
  add column if not exists org_id uuid references public.organization on delete set null;

alter table public.prepared_class
  add column if not exists org_id uuid references public.organization on delete set null;

-- Indexes on the referencing side, for the DELETION path first and any
-- future cost report second. ON DELETE SET NULL is enforced by Postgres
-- hunting the dying org's rows in every table that references it -- and an
-- org dies on EVERY account deletion (0002 deletes auth.users; the last
-- membership going fires on_membership_removed, 0007, which deletes the
-- empty solo org). Without these, that store-mandated, child-facing flow
-- pays four sequential scans inside the same transaction as the user
-- delete, the worst of them over usage_event, the fastest-growing table in
-- the schema. Poured now for this file's own reason: adding them later
-- means CREATE INDEX CONCURRENTLY against live tables. Partial, because
-- the enforcement query only ever looks for a concrete org_id, which a
-- null row can never match.
create index if not exists student_state_org
  on public.student_state (org_id) where org_id is not null;
create index if not exists relay_usage_org
  on public.relay_usage (org_id) where org_id is not null;
create index if not exists usage_event_org
  on public.usage_event (org_id) where org_id is not null;
create index if not exists prepared_class_org
  on public.prepared_class (org_id) where org_id is not null;

-- ---------------------------------------------------------------------------
-- 2. The fill. A BEFORE INSERT trigger, so no writer has to change.
--
-- Resolved inside Postgres for the same reason 0005 provisions the org there:
-- it is the only place that sees every write, whichever client or relay made
-- it. A row that arrives without an org_id gets one looked up; a row that
-- arrives WITH one keeps it, which is the door the LMS and the keep path walk
-- through later without this function changing.
--
-- SECURITY DEFINER with a pinned search_path, like every definer here: the
-- inserting role is sometimes a student under row security and sometimes the
-- relay, and the membership lookup must not depend on which. The cost is one
-- probe of the membership_user index per insert -- claim_relay pays it on its
-- upsert's insert arm too, where the conflicting update then simply ignores
-- the filled value, which is exactly the no-op it should be.
--
-- WHERE A USER HOLDS SEVERAL MEMBERSHIPS, the earliest created_at wins. That
-- tie-break is TEMPORARY and written down so it is a decision rather than an
-- accident: today every user holds exactly one solo membership, and the
-- school claim flow that will say which org a student acts under does not
-- exist yet. When it does, the caller's explicit org_id wins above and this
-- order-by decides nothing.
--
-- A user with NO membership leaves org_id null rather than raising. An
-- insert must never start being refused for a missing org: that would be a
-- behaviour change dressed up as tidiness, and null is an honest answer.
-- ---------------------------------------------------------------------------
create or replace function public.fill_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is null then
    select m.org_id
      into new.org_id
      from public.membership m
     where m.user_id = new.user_id
     order by m.created_at asc
     limit 1;
  end if;
  return new;
end;
$$;

revoke all on function public.fill_org_id() from public, anon, authenticated;

drop trigger if exists student_state_fill_org on public.student_state;
create trigger student_state_fill_org
  before insert on public.student_state
  for each row execute function public.fill_org_id();

drop trigger if exists relay_usage_fill_org on public.relay_usage;
create trigger relay_usage_fill_org
  before insert on public.relay_usage
  for each row execute function public.fill_org_id();

drop trigger if exists usage_event_fill_org on public.usage_event;
create trigger usage_event_fill_org
  before insert on public.usage_event
  for each row execute function public.fill_org_id();

-- prepared_class deliberately gets NO trigger: the table carries no user_id
-- column, so there is no membership to resolve an org from. Its org_id stays
-- null until the keep path passes one explicitly -- a later change to that
-- writer, not to this schema -- and a null there reads as "kept before
-- attribution existed", which is the truth.

-- ---------------------------------------------------------------------------
-- The backfill, by the same rule the trigger uses. The tables are near-zero
-- today, so this touches almost nothing -- but the trigger cannot reach a
-- row that already exists. It DOES fire on every upsert attempt, conflicting
-- or not, and fills the proposed row; on the ON CONFLICT UPDATE arm that
-- fill lands only in EXCLUDED, and the client's set-list (supabase.ts
-- upserts user_id, key, value, updated_at -- no org_id) never copies it to
-- the stored row. So a pre-existing row's null would live forever without
-- this. Idempotent: only null rows are touched, so a re-run costs nothing.
-- ---------------------------------------------------------------------------
update public.student_state s
   set org_id = (
     select m.org_id from public.membership m
      where m.user_id = s.user_id
      order by m.created_at asc limit 1)
 where s.org_id is null;

update public.relay_usage r
   set org_id = (
     select m.org_id from public.membership m
      where m.user_id = r.user_id
      order by m.created_at asc limit 1)
 where r.org_id is null;

update public.usage_event e
   set org_id = (
     select m.org_id from public.membership m
      where m.user_id = e.user_id
      order by m.created_at asc limit 1)
 where e.org_id is null;

-- ---------------------------------------------------------------------------
-- 3. Prep attribution, for the cost books.
--
-- S -- how many students end up sharing one preparation -- is the whole cost
-- model; 0017's header does the arithmetic, Rs 496.5 a student-hour at S = 1.
-- Yet nothing today ties a usage row or a sitting to the preparation that
-- served it, so S can only be asserted, never measured. prep_id names one
-- preparation RUN. It is a bare uuid and NOT a foreign key, for the same
-- reason session_id on usage_event is not (0008): the prepared_class
-- catalogue keys by a text slug, its row may land AFTER the calls that made
-- it, and a usage row must never be refused for that.
--
-- bucket says which side of the cache a call served: 'live' paid to make a
-- class for the first student, 'warm' merely served the cached one to the
-- next. Null is every row written before today and every call that is
-- neither, which a report must read as "unattributed", not as either bucket.
-- ---------------------------------------------------------------------------
alter table public.usage_event
  add column if not exists prep_id uuid;

alter table public.learning_session
  add column if not exists prep_id uuid;

alter table public.usage_event
  add column if not exists bucket text check (bucket in ('live', 'warm'));

-- 'self' is the Piper box: speech synthesised on hardware we run ourselves,
-- where the marginal price is electricity. It still gets a usage row -- a
-- call that costs nearly nothing is still a call, and "nearly" is a number
-- the books must hold rather than assume. 0008 declared the check inline on
-- the column, so usage_event_provider_check is the name Postgres's
-- convention gives it -- asserted by the guard below rather than trusted; it
-- is dropped by that name and restated whole, because stacking a second
-- overlapping check would make every future widening have to touch two
-- constraints.
--
-- THE GUARD EXISTS BECAUSE A NAME MISS WOULD FAIL SILENTLY. If the live
-- constraint carried some other name, `drop constraint if exists` would
-- no-op, the `add` below would still SUCCEED, and both checks would coexist
-- -- the stale narrow one refusing the first provider = 'self' row at
-- runtime, long after the push reported clean. Raising here turns that
-- silent runtime refusal into a failed push, which is the loud version.
-- Idempotent: the recreated constraint carries the same name, so a re-run
-- passes the guard.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.usage_event'::regclass
       and conname = 'usage_event_provider_check'
  ) then
    raise exception '0018: no check named usage_event_provider_check on public.usage_event -- find the live name in pg_constraint and widen that one, or the narrower check survives and refuses the first provider=self row at runtime';
  end if;
end
$$;

alter table public.usage_event
  drop constraint if exists usage_event_provider_check;

alter table public.usage_event
  add constraint usage_event_provider_check
  check (provider in ('vertex', 'openrouter', 'storage', 'self'));

-- ---------------------------------------------------------------------------
-- The cost books must be able to SEE these columns, and today they cannot.
--
-- `select e.*` in a view is a column snapshot taken at CREATE time: the 0008
-- view captured usage_event's columns as they stood and does not grow with
-- the table, so without this rebuild prep_id, bucket and org_id would stay
-- invisible to the very reports this section exists for. And the later fix
-- would not be a plain create-or-replace: the new columns land BEFORE the
-- computed inr/unpriced columns inside e.*, and replace refuses to reorder
-- an existing view's columns. So: DROP, then CREATE with 0008's body
-- verbatim, then the 0010 ritual restated whole -- security_invoker and the
-- full regrant -- because a recreated view is a NEW object that Supabase
-- grants to anon and authenticated by default, which is the exact leak 0010
-- measured (five other students' rows through a definer-rights view). Zero
-- behaviour change: the view is service_role-only per 0010, its one reader
-- is the operator's report, and extra columns break no existing query.
-- ---------------------------------------------------------------------------
drop view if exists public.usage_cost;

-- Audio arrives as 16 kHz, 16-bit, mono WAV from the ear - 32,000 bytes per
-- second. If the ear ever changes its format this constant is the one place
-- that has to follow it. (Body verbatim from 0008; e.* now carries prep_id,
-- bucket and org_id because the table does.)
create view public.usage_cost as
select
  e.*,
  (
    coalesce(e.prompt_tokens  * public.price_at(e.provider, e.model, 'prompt_token',  e.at), 0)
  + coalesce(e.output_tokens  * public.price_at(e.provider, e.model, 'output_token',  e.at), 0)
  + coalesce(e.thought_tokens * public.price_at(e.provider, e.model, 'thought_token', e.at), 0)
  + coalesce(e.images         * public.price_at(e.provider, e.model, 'image',         e.at), 0)
  + coalesce(e.characters     * public.price_at(e.provider, e.model, 'character',     e.at), 0)
  + coalesce((e.audio_bytes / 32000.0) * public.price_at(e.provider, e.model, 'audio_second', e.at), 0)
  + coalesce(e.bytes          * public.price_at(e.provider, e.model, 'byte',          e.at), 0)
  ) as inr,
  -- True when at least one quantity on this row has no price yet, so a report
  -- can say "this total is a floor" instead of presenting a hole as a saving.
  (
    (e.prompt_tokens  is not null and public.price_at(e.provider, e.model, 'prompt_token',  e.at) is null) or
    (e.output_tokens  is not null and public.price_at(e.provider, e.model, 'output_token',  e.at) is null) or
    (e.images         is not null and public.price_at(e.provider, e.model, 'image',         e.at) is null) or
    (e.characters     is not null and public.price_at(e.provider, e.model, 'character',     e.at) is null) or
    (e.audio_bytes    is not null and public.price_at(e.provider, e.model, 'audio_second',  e.at) is null)
  ) as unpriced
from public.usage_event e;

-- The 0010 ritual, restated whole. Runs as its CALLER, so row security
-- applies to it like anything else; and revoked from students outright,
-- because it is an operator's report and was never meant to be reachable
-- from a browser at all.
alter view public.usage_cost set (security_invoker = true);

revoke all on public.usage_cost from public, anon, authenticated;
grant select on public.usage_cost to service_role;

-- ---------------------------------------------------------------------------
-- 4. Review columns on prepared_class, per the reconciled contract.
--
-- DEFAULT 'published' IS DELIBERATE, AND THE FLIP IS A LATER, CONSCIOUS
-- CHANGE. The reviewer that would earn a 'pending' default does not exist
-- yet (phase E, wave 2). Defaulting to 'pending' today would hide every
-- class already on the live project, and every class today's live-prep
-- keeps, the moment this migration ran -- the exact behaviour change this
-- file exists to not make. When the reviewer ships, flipping this default is
-- a one-line migration made by somebody who means it, with the reviewer
-- standing there to work the queue it creates. The select rule on the table
-- is untouched for the same reason: what a student can see today, they can
-- see tomorrow.
--
-- version starts at 1 and counts republications of the same topic_ref, so a
-- retraction can say WHICH preparation it retracts rather than pointing at a
-- slug that has since been re-prepared.
-- ---------------------------------------------------------------------------
alter table public.prepared_class
  add column if not exists review_status text not null default 'published'
    check (review_status in ('pending', 'published', 'retracted'));

alter table public.prepared_class
  add column if not exists published_at timestamptz;

alter table public.prepared_class
  add column if not exists review_note text;

alter table public.prepared_class
  add column if not exists version integer not null default 1;

alter table public.prepared_class
  add column if not exists retracted_at timestamptz;

-- A pre-reviewer class was de facto published the moment it was kept, so
-- created_at is the honest retro-date -- without it, the first phase-E query
-- that says "published since X" or orders a review queue by published_at
-- would silently drop the exact rows the 'published' default above was
-- chosen to protect. Idempotent: only null rows are touched. A published_at
-- still null AFTER this reads as "kept after 0018, before the reviewer
-- existed" -- the same era-marker convention as the org_id and bucket nulls
-- above -- because the keep path does not stamp it yet; the reviewer that
-- will is phase E's.
update public.prepared_class
   set published_at = created_at
 where review_status = 'published'
   and published_at is null;
