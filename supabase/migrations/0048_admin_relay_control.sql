-- THE STOP SWITCH AND THE SPEND CEILING, AS AUDITED FUNCTIONS.
--
-- Until now halting the tutor was two raw UPDATE statements run in the SQL
-- editor (docs/ops/runbook.md), and the ceiling had no bounds at all. These
-- functions are the same two levers, with a reason, a name and a log line on
-- every change:
--
--   set_halt(true, ...)   any active staff member, one tap. Stopping money or
--                         harm must never wait for a second person.
--   set_halt(false, ...)  owner only, with the second factor re-verified.
--   set_caps(units, ...)  owner only, with the second factor re-verified. A
--                         RAISE reverts by itself at the next UTC midnight, so
--                         a forgotten emergency raise cannot become permanent.
--
-- /api/report stays exempt from a halt in the relay (a child can always
-- report something); nothing here changes that.
--
-- WHAT THIS DOES NOT TOUCH: RELAY_DISABLED, the environment variable, stays a
-- secret set from a laptop. It is the second, independent stop, and it is
-- deliberately not reachable from this panel or from the database.

alter table public.relay_control add column if not exists halted_at timestamptz;
alter table public.relay_control add column if not exists halted_by text;

-- The bound is checked against the row that is there now, and the migration
-- stops with a plain message if that row is outside it. A CHECK is evaluated on
-- every update of the row, whatever column changes, so an out-of-bounds ceiling
-- left in place would make the next STOP fail; it must be fixed here, at push
-- time, not discovered by the stop button.
do $$
declare
  units integer;
begin
  select c.global_units_per_day into units from public.relay_control c where c.id;
  if units is not null and units not between 1000 and 1000000 then
    raise exception 'relay_control.global_units_per_day is %, outside 1000 to 1000000: set it inside that range, then apply this migration', units;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relay_control_ceiling_bounds') then
    alter table public.relay_control
      add constraint relay_control_ceiling_bounds
      check (global_units_per_day between 1000 and 1000000);
  end if;
end
$$;

create table if not exists admin.cap_override (
  id boolean primary key default true check (id),
  previous_units integer not null,
  revert_on date not null,
  set_by uuid
);
revoke all on admin.cap_override from public, anon, authenticated;
alter table admin.cap_override enable row level security;

drop trigger if exists relay_control_tripwire on public.relay_control;
create trigger relay_control_tripwire
  after insert or update or delete on public.relay_control
  for each row execute function admin.tripwire();

create or replace function admin.relay_status()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
  utc_day date := (now() at time zone 'utc')::date;
  rc record;
  units integer;
  students integer;
  ov record;
begin
  select c.halted, c.halted_reason, c.halted_at, c.global_units_per_day, c.max_concurrent_preps
    into rc from public.relay_control c where c.id;
  select coalesce(max(b.units), 0) into units from public.relay_budget_day b where b.day = utc_day;
  select count(distinct e.user_id)::int into students from public.usage_event e where e.at > now() - interval '10 minutes';
  select o.previous_units, o.revert_on into ov from admin.cap_override o where o.id;
  return jsonb_build_object(
    'halted', coalesce(rc.halted, false),
    'haltedReason', rc.halted_reason,
    'haltedAt', rc.halted_at,
    'ceilingUnits', rc.global_units_per_day,
    'unitsToday', units,
    'maxConcurrentPreps', rc.max_concurrent_preps,
    'studentsNow', students,
    'utcDay', utc_day,
    'capOverride', case when ov.revert_on is null then null
                        else jsonb_build_object('previousUnits', ov.previous_units, 'revertOn', ov.revert_on) end
  );
end;
$$;

create or replace function admin.set_halt(p_halted boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff;
  students integer;
begin
  if p_halted is null then
    raise exception 'say whether to stop or resume';
  end if;
  if p_halted then
    me := admin.require_staff();
  else
    me := admin.require_staff(array[]::text[]);
    perform admin.require_fresh_mfa(10);
  end if;
  perform admin.check_environment(p_env);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why, in a few words';
  end if;
  select count(distinct e.user_id)::int into students from public.usage_event e where e.at > now() - interval '10 minutes';
  perform set_config('admin.session', 'on', true);
  update public.relay_control
     set halted = p_halted,
         halted_reason = case when p_halted then btrim(p_reason) else null end,
         halted_at = case when p_halted then now() else null end,
         halted_by = case when p_halted then me.display_name else null end,
         updated_at = now()
   where id;
  perform admin.audit(me, case when p_halted then 'tutor-stopped' else 'tutor-resumed' end,
    'relay', 'relay_control', p_reason, jsonb_build_object('studentsNow', students));
end;
$$;

create or replace function admin.set_caps(p_units integer, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  utc_day date := (now() at time zone 'utc')::date;
  rc record;
  spent integer;
  prev integer;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  if p_units is null or p_units not between 1000 and 1000000 then
    raise exception 'the daily ceiling is between 1000 and 1000000 units';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why, in a few words';
  end if;
  select c.halted, c.global_units_per_day into rc from public.relay_control c where c.id;
  select coalesce(max(b.units), 0) into spent from public.relay_budget_day b where b.day = utc_day;
  if p_units <= spent and not rc.halted then
    raise exception 'that is at or below today''s spend (% units); stop the tutor first', spent;
  end if;
  perform set_config('admin.session', 'on', true);
  if p_units > rc.global_units_per_day then
    select o.previous_units into prev from admin.cap_override o where o.id;
    insert into admin.cap_override (id, previous_units, revert_on, set_by)
    values (true, coalesce(prev, rc.global_units_per_day), utc_day + 1, me.user_id)
    on conflict (id) do update set revert_on = excluded.revert_on, set_by = excluded.set_by;
  end if;
  -- A cut to or below the ceiling a raise would revert to ends that raise: the
  -- midnight revert must never lift a ceiling somebody lowered on purpose.
  delete from admin.cap_override o where o.id and p_units <= o.previous_units;
  update public.relay_control set global_units_per_day = p_units, updated_at = now() where id;
  perform admin.audit(me, 'ceiling-set', 'relay', 'relay_control', p_reason,
    jsonb_build_object('from', rc.global_units_per_day, 'to', p_units, 'spentToday', spent));
end;
$$;

-- Run by cron at 00:05 UTC: a raise made for one day does not outlive it.
create or replace function admin.revert_caps()
returns integer
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  ov record;
begin
  select o.previous_units, o.revert_on into ov from admin.cap_override o where o.id;
  if ov.revert_on is null or ov.revert_on > (now() at time zone 'utc')::date then
    return 0;
  end if;
  perform set_config('admin.session', 'on', true);
  -- least(): the revert only ever lowers.
  update public.relay_control
     set global_units_per_day = least(ov.previous_units, global_units_per_day), updated_at = now()
   where id;
  delete from admin.cap_override where id;
  perform admin.audit_service('ceiling-reverted', 'relay', 'relay_control', 'the one-day raise ended',
    jsonb_build_object('to', ov.previous_units));
  return 1;
end;
$$;

select cron.schedule('admin-revert-caps', '5 0 * * *', $job$ select admin.revert_caps(); $job$);

revoke all on function admin.relay_status() from public, anon;
revoke all on function admin.set_halt(boolean, text, text) from public, anon;
revoke all on function admin.set_caps(integer, text, text) from public, anon;
revoke all on function admin.revert_caps() from public, anon, authenticated;

grant execute on function admin.relay_status() to authenticated;
grant execute on function admin.set_halt(boolean, text, text) to authenticated;
grant execute on function admin.set_caps(integer, text, text) to authenticated;
grant execute on function admin.revert_caps() to service_role;
