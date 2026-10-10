-- THE TUTOR'S ADMISSION OBEYS THE SCHOOL'S SWITCH; THE READS THE APPS AND
-- FINANCE NEED (plan 4).
--
-- 1. Spec section 8, Tutor row, and seam T3: public.claim_relay (the tutor's
--    admission, which the relay asks with the service role before it lets a
--    request through, a report included) refuses when the learner's effective
--    tutor.enabled is false: their school's own value, else the platform's,
--    else the safe default, and false while the school is suspended (plan 3,
--    0060), exactly as public.app_config says it to the apps. A learner with
--    no school reads the platform's value (R2). A school's teachers and its
--    admin are not learners and are not refused by it: their relay calls are
--    the teacher app's "Draft with AI" for homework, which a pause and a
--    suspension leave alone (spec section 10: "homework, marks and exports
--    stay"). The stop (relay_control) still refuses everyone.
--    The refusal reads 'halted' (R1): the deployed relay maps any reason it
--    does not know to a rate limit and would then also refuse a child's
--    report (packages/relay/src/gate.ts:234-235, 338-342), while 'halted' is
--    shown as a pause and lets a report through. So this works with the relay
--    that is live today; a distinct reason waits for a relay change. It is
--    checked after the per-minute window and counted in it, so a report the
--    relay lets through on 'halted' is still held to 120 a minute.
-- 2. public.my_app_config(): public.app_config for the caller's own school,
--    from their session, or the platform's. For the tutor app, which does not
--    know its learner's school (R3).
-- 3. lms.school_billing(): the school admin's licence state, grace's last
--    day, open invoices and what is still due (spec section 13), for the
--    school's admin only (R15).
-- 4. admin.stop_status(): whether the tutor is stopped, with the reason and
--    since when, for every staff role. Finance may stop the tutor (0061) and
--    may read no other status (R19).

-- Whether the tutor is on for this learner: their school's effective
-- tutor.enabled (its own value, else the platform's, else the safe default,
-- and false while the school is suspended), exactly as public.app_config says
-- it to the apps. A learner with no school reads the platform's value. True
-- for a school's teachers and admin, who are not learners (above).
create or replace function admin.tutor_enabled_for(p_user uuid)
returns boolean
language sql stable security definer
set search_path = admin, lms, public
as $$
  select exists (select 1 from lms.account a where a.user_id = p_user and a.kind in ('teacher', 'admin'))
      or (public.app_config((select s.code from lms.school s where s.org_id = public.org_of(p_user)))
          ->> 'tutor.enabled') is distinct from 'false'
$$;
revoke all on function admin.tutor_enabled_for(uuid) from public, anon, authenticated, service_role;

-- 0016's claim_relay, line for line, with one block added after the
-- per-minute window: the school's switch (above).
create or replace function public.claim_relay(
  p_user uuid,
  p_relay text,
  p_units integer
)
returns table (allowed boolean, reason text, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  requests_per_minute constant integer := 120;
  units_per_day constant integer := 12000;
  now_at timestamptz := now();
  today date := (now_at at time zone 'utc')::date;
  midnight_in integer;
  ceiling_units integer;
  is_halted boolean;
  row_units integer;
  row_window_start timestamptz;
  row_window_count integer;
  project_units integer;
begin
  if p_user is null or p_units is null or p_units < 0 then
    raise exception 'claim_relay needs a user and a non-negative cost';
  end if;

  -- One row, read once. It is a single page in shared buffers on every call
  -- after the first, which is the price of being able to move the ceiling
  -- without a deploy.
  select c.halted, c.global_units_per_day
    into is_halted, ceiling_units
    from public.relay_control c
   where c.id
   limit 1;

  -- A table somebody dropped a row from must not open the relay. Absent reads
  -- as halted, in the same spirit as the meter failing closed.
  if ceiling_units is null then
    return query select false, 'halted'::text, 60;
    return;
  end if;

  if is_halted then
    -- Minutes, not a day: somebody or an alarm did this on purpose and will
    -- undo it. Pointing at midnight would be a lie in both directions.
    return query select false, 'halted'::text, 300;
    return;
  end if;

  -- Seconds to the rollover of `today` above. Both budgets reset there, so both
  -- refusals point at it. Written "at time zone 'utc'" rather than a bare cast
  -- because a plain ::timestamptz reads the date in the SESSION's zone, which
  -- on a database not set to UTC came out negative and clamped to one second --
  -- a Retry-After that sent a client straight back into the same refusal.
  midnight_in := greatest(
    1,
    ceil(extract(epoch from (((today + 1)::timestamp at time zone 'utc') - now_at)))::integer
  );

  -- One statement, so two calls from two Edge Function instances cannot both
  -- read 119 and both write 120. The row is locked by the update itself.
  insert into public.relay_usage as u (user_id, day, day_units, window_start, window_count)
  values (p_user, today, 0, date_trunc('minute', now_at), 0)
  on conflict (user_id) do update
    set
      day = today,
      day_units = case when u.day = today then u.day_units else 0 end,
      window_start = case
        when now_at - u.window_start >= interval '1 minute' then date_trunc('minute', now_at)
        else u.window_start
      end,
      window_count = case
        when now_at - u.window_start >= interval '1 minute' then 0
        else u.window_count
      end
  returning u.day_units, u.window_start, u.window_count
  into row_units, row_window_start, row_window_count;

  if row_window_count >= requests_per_minute then
    return query select
      false,
      'rate'::text,
      greatest(1, ceil(extract(epoch from (row_window_start + interval '1 minute' - now_at)))::integer);
    return;
  end if;

  -- THE SCHOOL'S SWITCH (0064). Answered as 'halted' on purpose: the relay
  -- reads any reason it does not know as a rate limit and would then refuse a
  -- child's report (packages/relay/src/gate.ts), while 'halted' is shown as a
  -- pause and lets a report through. After the window, and counted in it, so
  -- a report let through on 'halted' is still held to requests_per_minute (a
  -- school can stay switched off or suspended for weeks, unlike the stop).
  -- Before the budgets, so a refusal here spends no units.
  if not admin.tutor_enabled_for(p_user) then
    update public.relay_usage
       set window_count = window_count + 1
     where user_id = p_user;
    return query select false, 'halted'::text, 300;
    return;
  end if;

  if row_units + p_units > units_per_day then
    return query select false, 'budget'::text, midnight_in;
    return;
  end if;

  -- THE PROJECT'S DAY, CLAIMED BEFORE THE STUDENT'S IS SPENT.
  --
  -- The guard is the WHERE of the upsert, so the test and the write are one
  -- locked statement rather than a read and a later update with a race in
  -- between. When the guard fails no row is returned, project_units stays null,
  -- and nothing was taken -- so a refusal here costs the student none of their
  -- own budget, which matters because it was not their doing.
  if p_units > ceiling_units then
    return query select false, 'capped'::text, midnight_in;
    return;
  end if;

  insert into public.relay_budget_day as b (day, units)
  values (today, p_units)
  on conflict (day) do update
     set units = b.units + p_units,
         updated_at = now_at
   where b.units + p_units <= ceiling_units
  returning b.units into project_units;

  if project_units is null then
    return query select false, 'capped'::text, midnight_in;
    return;
  end if;

  update public.relay_usage
     set day_units = day_units + p_units,
         window_count = window_count + 1
   where user_id = p_user;

  return query select true, null::text, 0;
end;
$$;

-- Restated because `create or replace` takes the whole body: the relay reaches
-- this with the service-role key and nobody else reaches it at all.
revoke all on function public.claim_relay(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_relay(uuid, text, integer) to service_role;

-- The config for whoever is calling: their school's when they belong to one,
-- else the platform's (signed out, a direct learner, staff).
create or replace function public.my_app_config()
returns jsonb
language sql stable security definer
set search_path = public, lms
as $$
  select public.app_config((select s.code from lms.school s where s.org_id = public.org_of(auth.uid())))
$$;
revoke all on function public.my_app_config() from public;
grant execute on function public.my_app_config() to anon, authenticated, service_role;

-- The school admin's licence and invoice state. state is coarse as in
-- app_config (ok, grace or suspended; ended reads suspended); graceUntil is
-- grace's last day while in grace; the invoices are those still unpaid or
-- partly paid, with what is still due on them and the earliest due day.
create or replace function lms.school_billing()
returns jsonb
language plpgsql stable security definer
set search_path = public, lms, billing
as $$
declare
  org uuid := lms.require_admin();
  st record;
begin
  select f.state, f.grace_until into st from billing.state_for(org, lms.india_today()) f;
  return jsonb_build_object(
    'state', case when st.state = 'grace' then 'grace'
                  when st.state in ('suspended', 'ended') then 'suspended' else 'ok' end,
    'graceUntil', case when st.state = 'grace' then to_char(st.grace_until, 'YYYY-MM-DD') end,
    'openInvoices', (select count(*)::int from billing.invoice i
                      where i.org_id = org and i.status in ('unpaid', 'partly_paid')),
    'duePaise', (select coalesce(sum(i.total_paise - i.paid_paise), 0) from billing.invoice i
                  where i.org_id = org and i.status in ('unpaid', 'partly_paid')),
    'earliestDueOn', (select to_char(min(i.due_on), 'YYYY-MM-DD') from billing.invoice i
                       where i.org_id = org and i.status in ('unpaid', 'partly_paid')));
end;
$$;
revoke all on function lms.school_billing() from public, anon;
grant execute on function lms.school_billing() to authenticated;

-- The stop's state, for every staff role: halted, why and since when. Nothing
-- else of relay_status (units, ceiling, children learning now).
create or replace function admin.stop_status()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['owner', 'ops', 'safety', 'finance']);
  rc record;
begin
  select c.halted, c.halted_reason, c.halted_at into rc from public.relay_control c where c.id;
  return jsonb_build_object('halted', coalesce(rc.halted, false), 'haltedReason', rc.halted_reason, 'haltedAt', rc.halted_at);
end;
$$;
revoke all on function admin.stop_status() from public, anon;
grant execute on function admin.stop_status() to authenticated;
