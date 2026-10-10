-- SWITCHES YOU CAN TRUST, AND THE CONTEST OBEYS THEM (plan 4).
--
-- 1. Two more kinds of switch. A minimum build is a VERSION: three whole
--    numbers such as 0.1.0, so a typo (0.1, 1.0.0-beta, v1.2.3) cannot be
--    stored and lock an app out (M13); each app also ignores a malformed value.
--    A COUNT is a whole number from 1 to 100000.
-- 2. The contest's daily limit, a constant in record_contest_signup since 0020
--    and repeated in admin.today (0049), becomes the switch contest.daily_limit
--    (guarded, safe default 2000, 0020's number). Both the signup and the home
--    page read it, and contest.entries_open, from one internal function,
--    admin.contest_rules.
-- 3. contest.entries_open is enforced in the signup itself: a NEW entry is
--    refused while it is off (errcode 55000); an entrant can still correct
--    their own entry, as 0020 already allows when the day is full.
-- 4. The contest's day becomes India's day (it was UTC in 0020 and 0049), as
--    "a day" is everywhere else in this repository (R9).

-- 1. Two more kinds.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'admin.flag_def'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table admin.flag_def drop constraint %I', c);
  end loop;
end
$$;
alter table admin.flag_def add constraint flag_def_kind_check
  check (kind in ('bool', 'text', 'tone', 'version', 'count'));

update admin.flag_def
   set kind = 'version',
       description = case key
         when 'app.min_version.classroom' then 'Oldest tutor build allowed to run, as three numbers such as 0.1.0; 0.0.0 for none.'
         when 'app.min_version.student' then 'Oldest student-app build allowed to run, as three numbers such as 0.1.0; 0.0.0 for none.'
         else 'Oldest teacher-app build allowed to run, as three numbers such as 2.3.0; 0.0.0 for none.'
       end
 where key in ('app.min_version.classroom', 'app.min_version.student', 'app.min_version.lms');

insert into admin.flag_def (key, kind, safe_default, school_scoped, guarded, description) values
  ('contest.daily_limit', 'count', '2000', false, true,
   'New contest entries taken in one India day; the next new one that day is refused.')
on conflict (key) do nothing;

-- 0050's validator with the two new kinds. CASE, not AND: Postgres does not
-- promise to evaluate AND left to right, and the cast must never see a value
-- the pattern refused.
create or replace function admin.flag_valid(p_kind text, p_value jsonb)
returns boolean
language sql immutable
as $$
  select case p_kind
    when 'bool' then jsonb_typeof(p_value) = 'boolean'
    when 'text' then jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') <= 280
    when 'tone' then jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') in ('info', 'warning')
    when 'version' then jsonb_typeof(p_value) = 'string'
                        and (p_value #>> '{}') ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
    when 'count' then case when jsonb_typeof(p_value) = 'number' and (p_value #>> '{}') ~ '^[0-9]{1,6}$'
                           then (p_value #>> '{}')::integer between 1 and 100000
                           else false end
    else false
  end
$$;
revoke all on function admin.flag_valid(text, jsonb) from public, anon, authenticated;

-- 2. The contest's rules, in one place: what public.app_config says (so a
--    switch nobody has set reads its safe default), and where India's day
--    starts. Internal: only the definer functions below call it.
create or replace function admin.contest_rules()
returns table (entries_open boolean, daily_limit integer, day_start timestamptz)
language sql stable security definer
set search_path = admin, lms, public
as $$
  select coalesce((c.v ->> 'contest.entries_open')::boolean, false),
         coalesce((c.v ->> 'contest.daily_limit')::integer, 2000),
         (lms.india_today())::timestamp at time zone 'Asia/Kolkata'
    from (select public.app_config(null) as v) c
$$;
revoke all on function admin.contest_rules() from public, anon, authenticated, service_role;

-- 3. 0020's record_contest_signup, line for line, with four changes only: the
--    constant day_project and the UTC day_start are gone; the rules are read
--    from admin.contest_rules once the caller is known; a new entry is refused
--    while entries are closed (55000); and the count is from India's day start
--    against the switch's limit (same message and errcode 53400 as before).
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
  -- The fence's height is now the switch contest.daily_limit (0062), safe
  -- default 2000: chosen against the contest rather than against the cost, so
  -- a real day never comes near it, and a day that does is either a success
  -- worth being woken up for or an attack worth stopping. Raise it
  -- deliberately, not reflexively.
  rules record;
  caller uuid := auth.uid();
  existing boolean;
  today integer;
begin
  -- No session, no entry. A definer function runs with the owner's rights, so
  -- this is the check that stops it being an open write for the whole world.
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select * into rules from admin.contest_rules();

  select true into existing from public.contest_signup where user_id = caller;

  -- Only a NEW entry is counted. A parent fixing a typo in their own entry
  -- must not be turned away because strangers filled today's quota, and an
  -- update adds no row to bound.
  if existing is null then
    -- contest.entries_open off: no new entry (0062). A correction still goes
    -- through, below.
    if not rules.entries_open then
      raise exception 'the contest is not taking entries' using errcode = '55000';
    end if;
    -- Serialised for this transaction so two simultaneous entries cannot both
    -- read 1999 and both be admitted. Count-then-insert without it is a race,
    -- and the race is as wide as the traffic.
    perform pg_advisory_xact_lock(hashtext('contest_signup_day'));
    select count(*)::integer into today
      from public.contest_signup where created_at >= rules.day_start;
    if today >= rules.daily_limit then
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

revoke all on function public.record_contest_signup(text, integer, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.record_contest_signup(text, integer, text, text, boolean, text, text, text) to authenticated;

-- 4. 0049's admin.today, line for line, with these changes only: the UTC
--    day_start is gone; the contest's entries are counted from India's day
--    start and its limit is the switch, both from admin.contest_rules; and the
--    contest object also says whether entries are open. utc_day stays: it is
--    the relay's day (relay_budget_day).
create or replace function admin.today()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
  utc_day date := (now() at time zone 'utc')::date;
  rules record;
  rc record;
  units integer;
  students integer;
  rep record;
  cls record;
  entries integer;
  schools jsonb;
  price_rows bigint;
  alert_seen text;
begin
  select c.halted, c.halted_reason, c.global_units_per_day into rc from public.relay_control c where c.id;
  select coalesce(max(b.units), 0) into units from public.relay_budget_day b where b.day = utc_day;
  select count(distinct e.user_id)::int into students from public.usage_event e where e.at > now() - interval '10 minutes';

  select count(*) filter (where r.status = 'new')::int as new_count,
         count(*) filter (where r.status = 'new' and r.kind = 'unsafe')::int as unsafe_new,
         coalesce(floor(extract(epoch from now() - min(r.received_at) filter (where r.status = 'new')) / 60), 0)::int as oldest_minutes
    into rep from public.student_report r;

  select count(*) filter (where p.review_status = 'pending')::int as pending,
         coalesce(floor(extract(epoch from now() - min(p.created_at) filter (where p.review_status = 'pending')) / 3600), 0)::int as oldest_hours
    into cls from public.prepared_class p;

  select * into rules from admin.contest_rules();
  select count(*)::int into entries from public.contest_signup s where s.created_at >= rules.day_start;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', f.code, 'name', f.school_name, 'plan', f.plan, 'seats', f.seats,
           'seatsUsed', f.seats_used, 'daysLeft', f.days_left) order by f.days_left nulls last), '[]'::jsonb)
    into schools
    from lms.founder_schools() f
   where (f.days_left is not null and f.days_left <= 30)
      or (f.seats is not null and f.seats > 0 and f.seats_used * 10 >= f.seats * 9);

  select count(*) into price_rows from public.model_price;
  select s.value #>> '{}' into alert_seen from admin.setting s where s.key = 'alert_last_seen';

  return jsonb_build_object(
    'environment', admin.environment(),
    'generatedAt', now(),
    'relay', jsonb_build_object(
      'halted', coalesce(rc.halted, false), 'haltedReason', rc.halted_reason,
      'ceilingUnits', rc.global_units_per_day, 'unitsToday', units, 'studentsNow', students),
    'reports', jsonb_build_object(
      'newCount', rep.new_count, 'unsafeNew', rep.unsafe_new, 'oldestNewMinutes', rep.oldest_minutes),
    'classes', jsonb_build_object('pendingCount', cls.pending, 'oldestPendingHours', cls.oldest_hours),
    'contest', jsonb_build_object('entriesToday', entries, 'dailyCap', rules.daily_limit, 'entriesOpen', rules.entries_open),
    'schools', schools,
    'prices', jsonb_build_object('modelPriceRows', price_rows),
    'alarm', jsonb_build_object(
      'lastCheckMinutesAgo',
      case when alert_seen is null then null
           else floor(extract(epoch from now() - alert_seen::timestamptz) / 60)::int end),
    'capture', jsonb_build_object('distress', 'not-captured', 'lastPurge', 'not-captured')
  );
end;
$$;

revoke all on function admin.today() from public, anon;
grant execute on function admin.today() to authenticated;
