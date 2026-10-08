-- DISTRESS FLAGS, CAPTURED ON THE SERVER (spec sections 7 and 11, plan 5).
--
-- The tutor's screen (packages/safety) recognises a child in distress on the
-- device and, until now, wrote that only to a local log. The relay's /api/flag
-- route sends each flag here through keep_safety_event. A flag holds what
-- happened (distress), whose words matched (the child's, or the tutor's own
-- line), the child's school when the child belongs to one, the build, and two
-- times. It holds no user id, no session, no lesson and no words: the user id
-- is used once, inside keep_safety_event, to find the school, and is not kept.

create table if not exists admin.safety_event (
  id uuid primary key,
  category text not null check (category in ('distress')),
  direction text not null check (direction in ('from-student', 'to-student')),
  org_id uuid references lms.school on delete set null,
  platform text check (platform in ('web', 'android')),
  release text check (char_length(release) <= 100),
  at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists safety_event_received on admin.safety_event (received_at desc);
revoke all on admin.safety_event from public, anon, authenticated, service_role;
alter table admin.safety_event enable row level security;
drop trigger if exists safety_event_tripwire on admin.safety_event;
create trigger safety_event_tripwire after insert or update or delete on admin.safety_event
  for each row execute function admin.tripwire();

-- The relay's door, service role only. true: kept now; false: already kept (a
-- retry); null: 1000 or more flags arrived in the last hour, so this one is
-- refused and the app keeps it to send again (ruling R5).
create or replace function public.keep_safety_event(
  p_user uuid, p_id uuid, p_category text, p_direction text, p_platform text, p_release text, p_at timestamptz
)
returns boolean
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  school uuid;
  kept uuid;
  last_hour integer;
begin
  if p_user is null or p_id is null or p_at is null
     or p_category is distinct from 'distress'
     or coalesce(p_direction, '') not in ('from-student', 'to-student') then
    raise exception 'a flag needs a user, an id, a time, the category distress and a direction';
  end if;
  if exists (select 1 from admin.safety_event e where e.id = p_id) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('admin.safety_event'));
  select count(*)::int into last_hour from admin.safety_event e where e.received_at > now() - interval '1 hour';
  if last_hour >= 1000 then
    return null;
  end if;
  -- A school only: a direct user's solo organisation would name the child.
  select m.org_id into school
    from public.membership m
    join lms.school s on s.org_id = m.org_id
   where m.user_id = p_user
   order by m.created_at
   limit 1;
  perform set_config('admin.session', 'on', true);
  insert into admin.safety_event (id, category, direction, org_id, platform, release, at)
  values (p_id, 'distress', p_direction, school,
          case when p_platform in ('web', 'android') then p_platform end,
          nullif(left(btrim(coalesce(p_release, '')), 100), ''), p_at)
  on conflict (id) do nothing
  returning id into kept;
  if kept is null then
    return false;
  end if;
  insert into admin.setting (key, value)
  values ('distress_capture_since', to_jsonb(to_char(lms.india_today(), 'YYYY-MM-DD')))
  on conflict (key) do nothing;
  return true;
end;
$$;
revoke all on function public.keep_safety_event(uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.keep_safety_event(uuid, uuid, text, text, text, text, timestamptz) to service_role;

-- What the console says about capture: "not captured" until a flag has arrived
-- or the owner has recorded the day capture went live, never a bare zero.
create or replace function admin.distress_capture()
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  select case
    when s.since is null then
      jsonb_build_object('state', 'not-captured', 'since', null, 'last24h', null, 'last7d', null)
    else jsonb_build_object(
      'state', 'captured', 'since', s.since,
      'last24h', (select count(*)::int from admin.safety_event e where e.received_at > now() - interval '24 hours'),
      'last7d', (select count(*)::int from admin.safety_event e where e.received_at > now() - interval '7 days'))
  end
  from (select (select st.value #>> '{}' from admin.setting st where st.key = 'distress_capture_since') as since) s
$$;
revoke all on function admin.distress_capture() from public, anon, authenticated;

-- The owner records the India day capture went live (once the relay and the
-- tutor app that send flags are deployed), so the console reads "captured"
-- from that day even before the first flag arrives.
create or replace function admin.safety_capture_set(p_on date, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_on is null or p_on > lms.india_today() or p_on < lms.india_today() - 365 then
    raise exception 'the day capture went live is in the last year, not in the future';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.setting (key, value)
  values ('distress_capture_since', to_jsonb(to_char(p_on, 'YYYY-MM-DD')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin.audit(me, 'distress-capture-since-set', 'setting', 'distress_capture_since', p_reason,
    jsonb_build_object('on', to_char(p_on, 'YYYY-MM-DD')));
end;
$$;
revoke all on function admin.safety_capture_set(date, text, text) from public, anon;
grant execute on function admin.safety_capture_set(date, text, text) to authenticated;

-- THE ALARM'S SNAPSHOT, AGAIN: 0051's body unchanged, plus one count,
-- distressFlags15m (flags received in the last 15 minutes). The snapshot
-- carries counts, ages and booleans only: never a name, note, school or word.
create or replace function public.alert_snapshot(p_token text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  expected text;
  utc_day date := (now() at time zone 'utc')::date;
  rc record;
  units integer;
  rep record;
  cls integer;
  recent integer;
  failed integer;
  distress integer;
begin
  -- A wrong token is ANSWERED, not raised: an exception would roll back the
  -- insert below, and the count of misses is how an attack becomes visible.
  select t.token_hash into expected from admin.alert_token t where t.id;
  if expected is null or p_token is null
     or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> expected then
    insert into admin.alert_miss default values;
    delete from admin.alert_miss m where m.at < now() - interval '1 hour';
    return jsonb_build_object('error', 'not-allowed');
  end if;

  select c.halted, c.global_units_per_day into rc from public.relay_control c where c.id;
  select coalesce(max(b.units), 0) into units from public.relay_budget_day b where b.day = utc_day;
  select count(*) filter (where r.status = 'new')::int as new_count,
         count(*) filter (where r.status = 'new' and r.kind = 'unsafe')::int as unsafe_new,
         coalesce(floor(extract(epoch from now() - min(r.received_at) filter (where r.status = 'new')) / 60), 0)::int as oldest_minutes
    into rep from public.student_report r;
  select count(*)::int into cls from public.prepared_class p where p.review_status = 'pending';
  select count(*)::int, count(*) filter (where e.status = 0 or e.status >= 500)::int
    into recent, failed from public.usage_event e where e.at > now() - interval '5 minutes';
  select count(*)::int into distress from admin.safety_event e where e.received_at > now() - interval '15 minutes';

  insert into admin.setting (key, value) values ('alert_last_seen', to_jsonb(now()::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object(
    'at', now(),
    'halted', coalesce(rc.halted, false),
    'ceilingUnits', rc.global_units_per_day,
    'unitsToday', units,
    'newReports', rep.new_count,
    'unsafeNewReports', rep.unsafe_new,
    'oldestNewReportMinutes', rep.oldest_minutes,
    'pendingClasses', cls,
    'relayEvents5m', recent,
    'relayFailures5m', failed,
    'distressFlags15m', distress
  );
end;
$$;

revoke all on function public.alert_snapshot(text) from public;
grant execute on function public.alert_snapshot(text) to anon, authenticated, service_role;
