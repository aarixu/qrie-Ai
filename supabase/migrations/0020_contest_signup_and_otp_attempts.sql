-- THE CONTEST DOOR THAT COMES BEFORE THE APP, AND THE ATTEMPT LIMIT A VENDOR
-- TURNED OUT NOT TO PROMISE.
--
-- Two things, one migration, because the contest form is what makes the second
-- one urgent: it is the first door in the funnel, it is where a parent's phone
-- is actually verified, and it sits on a public marketing site rather than
-- behind the app's identity.
--
-- THE HOUSE RULE HOLDS: RLS on, ZERO policies, on both tables. The only way in
-- is the service role, through a definer function where Postgres has to compute
-- an answer and directly where it does not. A visitor holding the anon key can
-- neither read a signup nor write one.

-- ---------------------------------------------------------------------------
-- 1. contest_signup — what the landing page collects, kept OFF consent_record.
-- ---------------------------------------------------------------------------
--
-- WHY A SECOND TABLE RATHER THAN MORE COLUMNS ON consent_record. That table is
-- deliberately thin: parent name, parent phone, when, source, whether the OTP
-- was verified. Enrol.tsx's own docblock says why -- "every extra field is a
-- data-protection liability on a form filled in by children" -- and a consent
-- artifact that also carries a child's home address is a worse artifact, not a
-- fuller one. The contest needs fields the app refuses, so they live apart and
-- the consent stays what it is.
--
-- The two are joined by user_id, so an operator ranking contest entries reads
-- this, and an auditor asking "did a parent consent" reads that.
--
-- WHAT IS NOT HERE, ON PURPOSE: no marks, no score, no ranking. The contest is
-- tracked "on different parameters" through the ledger the app already writes;
-- this table is the entry form and nothing else. A leaderboard column here
-- would be a second source of truth about a child's performance.
create table if not exists public.contest_signup (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  student_name text not null check (char_length(student_name) <= 80),
  klass integer not null check (klass between 6 and 12),
  -- E.164, the same one canonical shape consent_record fences, for the same
  -- reason: two spellings of one number are two students to everybody counting.
  student_phone text check (student_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- The address is the field this table exists for, and the one worth being
  -- uncomfortable about. Bounded, optional at the database, and never read by
  -- the app -- only by a person posting a prize.
  address text check (char_length(address) <= 300),
  takes_tuition boolean,
  city text check (char_length(city) <= 80),
  school_name text check (char_length(school_name) <= 120),
  campaign text check (char_length(campaign) <= 40),
  -- THE PARENT, AS TYPED, AND NOT AS CONSENT.
  --
  -- consent_record.otp_verified_at is NOT NULL, deliberately: that table can
  -- only hold a consent somebody actually proved. There is no SMS vendor yet,
  -- so nothing can be proved, and the landing form still asks for a parent's
  -- name and number because the contest needs somebody to ring about a prize.
  --
  -- Those two facts have to live somewhere that cannot be mistaken for the
  -- first one. Here, on the entry form, under names that say what they are: a
  -- string a child typed into a box. NOT a verified parent, NOT permission to
  -- contact anybody, and never to be read as either. When an OTP vendor
  -- exists, a verify writes consent_record and THAT is the record that counts;
  -- this column stays what it always was.
  parent_name_unverified text check (char_length(parent_name_unverified) <= 80),
  parent_phone_unverified text check (parent_phone_unverified ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now()
);

-- One entry per identity. A parent who submits twice corrects their entry
-- rather than creating a second one, and a retry after a dropped response does
-- not enter the same child twice.
create unique index if not exists contest_signup_user on public.contest_signup (user_id);

alter table public.contest_signup enable row level security;
revoke all on table public.contest_signup from anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_contest_signup — the one door in, and it does not take a user id.
-- ---------------------------------------------------------------------------
--
-- WHY A DEFINER FUNCTION RATHER THAN A SERVICE-ROLE ROUTE. The obvious build
-- is a server route on the marketing site holding the service key and passing
-- the user id along. Two things are wrong with it. The service key becomes a
-- SECOND thing that can write any row in this database, sitting in a Vercel
-- project whose whole job is to serve strangers HTML; and the user id arrives
-- in an argument, so whoever can call that route can write into anybody's
-- entry — on a contest with prizes, that is the entire attack.
--
-- Here there is no argument to forge. `auth.uid()` is read out of the caller's
-- own verified JWT by Postgres, so an entry can only ever be the caller's own,
-- and the marketing site holds nothing but the published anon key.
--
-- The column CHECKs are the validation. They are already written above and
-- they are the ones that actually hold, so this does not restate them; a
-- rejected phone or an out-of-range class raises and the caller shows it.
--
-- ON CONFLICT rather than insert: contest_signup_user is unique on user_id, so
-- a parent who submits twice is correcting their entry, and a retry after a
-- dropped response does not enter the same child a second time.
create or replace function public.record_contest_signup(
  p_student_name text,
  p_klass integer,
  p_student_phone text,
  p_address text,
  p_takes_tuition boolean,
  p_parent_name text,
  p_parent_phone text,
  p_campaign text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE LINE UNDER THE WHOLE THING, and it is the same one 0019 drew.
  --
  -- This function is granted to `authenticated`, and a marketing page mints an
  -- anonymous identity for every visitor — so identities are FREE. A unique
  -- index on user_id bounds rows per identity and therefore bounds nothing at
  -- all: a script that signs in anonymously in a loop has one unlimited write
  -- path into a table of children's home addresses.
  --
  -- claim_otp_send answered exactly this hole with day_project (0019), and its
  -- comment says why in as many words: "Identities are free, so per-phone and
  -- per-user caps together still bound nothing." The same sentence is true
  -- here with 'phone' crossed out, so the same fence goes up.
  --
  -- 2000 is chosen against the contest rather than against the cost: the plan
  -- is a first-500 push, so a real day never comes near it, and a day that
  -- does is either a success worth being woken up for or an attack worth
  -- stopping. Raise it deliberately, not reflexively.
  day_project constant integer := 2000;
  caller uuid := auth.uid();
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  existing boolean;
  today integer;
begin
  -- No session, no entry. A definer function runs with the owner's rights, so
  -- this is the check that stops it being an open write for the whole world.
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select true into existing from public.contest_signup where user_id = caller;

  -- Only a NEW entry is counted. A parent fixing a typo in their own entry
  -- must not be turned away because strangers filled today's quota, and an
  -- update adds no row to bound.
  if existing is null then
    -- Serialised for this transaction so two simultaneous entries cannot both
    -- read 1999 and both be admitted. Count-then-insert without it is a race,
    -- and the race is as wide as the traffic.
    perform pg_advisory_xact_lock(hashtext('contest_signup_day'));
    select count(*)::integer into today
      from public.contest_signup where created_at >= day_start;
    if today >= day_project then
      raise exception 'entries are closed for today' using errcode = '53400';
    end if;
  end if;

  insert into public.contest_signup as c (
    user_id, student_name, klass, student_phone, address,
    takes_tuition, parent_name_unverified, parent_phone_unverified, campaign
  )
  values (
    caller, p_student_name, p_klass, p_student_phone, p_address,
    p_takes_tuition, p_parent_name, p_parent_phone, p_campaign
  )
  on conflict (user_id) do update set
    student_name = excluded.student_name,
    klass = excluded.klass,
    student_phone = excluded.student_phone,
    address = excluded.address,
    takes_tuition = excluded.takes_tuition,
    parent_name_unverified = excluded.parent_name_unverified,
    parent_phone_unverified = excluded.parent_phone_unverified,
    campaign = excluded.campaign;
end;
$$;

-- Readable by nobody. A signed-in visitor may WRITE their own entry and can
-- still not SELECT one, which is the point of the table having no policies:
-- the address of every child who entered is not a thing a browser may list.
revoke all on function public.record_contest_signup(text, integer, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.record_contest_signup(text, integer, text, text, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The verify gate — the binding the vendor does not do, and the attempt
--    limit the vendor does not promise.
-- ---------------------------------------------------------------------------
--
-- TWO HOLES, ONE FUNCTION, and neither is hypothetical.
--
-- THE FIRST: MSG91 BINDS A CODE TO A PHONE, NOT TO A PERSON. Its verify call
-- takes the mobile and the code and nothing else. packages/relay/src/enroll.ts
-- states the requirement in capitals -- "userId IS PART OF THE KEY, not
-- telemetry... on a shared device, a kiosk at a contest, the exact door this
-- route was built for, a second person can walk up and spend the first
-- person's verified code against THEIR OWN account". The vendor cannot enforce
-- a pairing it is never told about, so it is enforced here: a verify is only
-- allowed against a send THIS user made for THIS phone.
--
-- THE SECOND: THE ATTEMPT LIMIT WAS ASSUMED, AND THE ASSUMPTION DID NOT HOLD.
-- That same docblock says an implementation MUST burn the code after a few
-- wrong guesses, and adds that the shortlisted vendors "enforce this
-- themselves -- this line is here so whoever picks one checks rather than
-- assumes". Checked: MSG91's published documentation does not state a default
-- wrong-attempt limit or a lockout, and what is written about it describes
-- integrator-side configuration. So it is NOT VERIFIED that the vendor burns
-- anything, and a four-to-six digit code behind a 120-a-minute window is a
-- few days of guessing. This function refuses to be the place that trusts it.
--
-- Five attempts, then the send is spent whatever the code was. Five is enough
-- for a parent fumbling a code on a bus and nothing like enough to search a
-- six-digit space.
--
-- CONSUMED ON SUCCESS TOO, which is the "exactly once" half of the contract:
-- a code that verified cannot verify again, so a second person watching the
-- same screen cannot replay it.
alter table public.otp_send
  add column if not exists attempts integer not null default 0,
  add column if not exists consumed_at timestamptz;

create index if not exists otp_send_user_phone_at
  on public.otp_send (user_id, phone, sent_at desc);

-- How long a sent code may still be answered. MSG91's own expiry is set per
-- send; this is the fence behind that fence, and the shorter of the two wins.
create or replace function public.claim_otp_verify(p_user uuid, p_phone text)
returns table (allowed boolean, why text)
language plpgsql
security definer
set search_path = public
as $$
declare
  max_attempts constant integer := 5;
  expiry_minutes constant integer := 10;
  row_id uuid;
  row_attempts integer;
begin
  -- The most recent unconsumed send this user made for this phone, inside the
  -- window. FOR UPDATE because two verifies racing on one code must not each
  -- read four attempts and both be allowed.
  select id, attempts
    into row_id, row_attempts
    from public.otp_send
   where user_id = p_user
     and phone = p_phone
     and consumed_at is null
     and sent_at > now() - make_interval(mins => expiry_minutes)
   order by sent_at desc
   limit 1
     for update;

  -- No send, or none this user made, or it expired. All three are the same
  -- answer to the caller ON PURPOSE: telling them which would say whether
  -- somebody else has a live code for that number.
  if row_id is null then
    return query select false, 'no-send'::text;
    return;
  end if;

  if row_attempts >= max_attempts then
    update public.otp_send set consumed_at = now() where id = row_id;
    return query select false, 'burnt'::text;
    return;
  end if;

  update public.otp_send set attempts = attempts + 1 where id = row_id;
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.claim_otp_verify(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_otp_verify(uuid, text) to service_role;

-- Called only after the vendor says the code was right, so the same code can
-- never be spent twice. Separate from the claim above because the vendor sits
-- between them: claim, ask MSG91, and only then consume.
create or replace function public.consume_otp_send(p_user uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.otp_send
     set consumed_at = now()
   where id = (
     select id from public.otp_send
      where user_id = p_user and phone = p_phone and consumed_at is null
      order by sent_at desc
      limit 1
   );
end;
$$;

revoke all on function public.consume_otp_send(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_otp_send(uuid, text) to service_role;
