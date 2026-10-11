-- THE ALARM: A SNAPSHOT AN OUTSIDE CHECKER CAN READ WITH ONE TOKEN.
--
-- An alarm that lives inside the project it watches goes quiet exactly when the
-- project does. So the checker runs elsewhere (a scheduled job on a different
-- host) and asks the database one question through public.alert_snapshot. It
-- holds the public anon key and one long random token, nothing else: no
-- service-role key leaves the project for this.
--
-- The token is stored only as its SHA-256. The snapshot returns a fixed set of
-- counts, ages and booleans, never a name, note, school or word, so a stolen
-- token reveals how busy Qrie is and nothing about any child. Wrong tokens are
-- counted, and a burst of them is refused. Every successful call records the
-- time, which the Today page shows as "the alarm last checked N minutes ago":
-- a checker that has died is visible.

create table if not exists admin.alert_token (
  id boolean primary key default true check (id),
  token_hash text not null,
  rotated_at timestamptz not null default now()
);
revoke all on admin.alert_token from public, anon, authenticated;
alter table admin.alert_token enable row level security;

create table if not exists admin.alert_miss (
  at timestamptz not null default now()
);
revoke all on admin.alert_miss from public, anon, authenticated;
alter table admin.alert_miss enable row level security;

create or replace function admin.alert_token_set(p_token text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'the alarm token is at least 32 characters';
  end if;
  insert into admin.alert_token (id, token_hash)
  values (true, encode(sha256(convert_to(p_token, 'utf8')), 'hex'))
  on conflict (id) do update set token_hash = excluded.token_hash, rotated_at = now();
  perform admin.audit_service('alarm-token-rotated', 'setting', 'alert_token', '', '{}'::jsonb);
end;
$$;

create or replace function public.alert_snapshot(p_token text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  expected text;
  misses integer;
  utc_day date := (now() at time zone 'utc')::date;
  rc record;
  units integer;
  rep record;
  cls integer;
  recent integer;
  failed integer;
begin
  -- A wrong token is ANSWERED, not raised: an exception would roll back the
  -- insert below, and a counter that never counts stops nothing.
  select count(*)::int into misses from admin.alert_miss m where m.at > now() - interval '1 minute';
  if misses >= 20 then
    return jsonb_build_object('error', 'busy');
  end if;
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
    'relayFailures5m', failed
  );
end;
$$;

revoke all on function admin.alert_token_set(text) from public, anon, authenticated;
revoke all on function public.alert_snapshot(text) from public;

grant execute on function admin.alert_token_set(text) to service_role;
grant execute on function public.alert_snapshot(text) to anon, authenticated, service_role;
