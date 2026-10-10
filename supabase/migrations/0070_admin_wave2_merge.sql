-- WAVE 2 TOGETHER: PLAN 4 (THE APPS OBEY THE CONSOLE) AND PLAN 5 (SAFETY,
-- CLASSES AND PRIVACY).
--
-- TODAY READS THE DISTRESS CAPTURE. 0062 (plan 4) replaced admin.today() with
-- the contest read from admin.contest_rules(); 0065 (plan 5) added
-- admin.distress_capture() and did not touch admin.today() (its ruling R27).
-- With both applied, Today said 'not-captured' for distress even once flags
-- arrived or the owner recorded the day capture went live, which is untrue
-- (spec section 12: "grey 'not captured', never a green zero" cuts both ways).
--
-- This is 0062's admin.today(), line for line, with one change: the capture
-- object's distress reads admin.distress_capture()'s state ('captured' once a
-- flag has arrived or the owner recorded the day; 'not-captured' before).
-- lastPurge stays 'not-captured': no job records a purge time yet.

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
    'capture', jsonb_build_object('distress', admin.distress_capture() ->> 'state', 'lastPurge', 'not-captured')
  );
end;
$$;

revoke all on function admin.today() from public, anon;
grant execute on function admin.today() to authenticated;
