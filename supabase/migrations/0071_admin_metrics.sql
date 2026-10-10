-- THE VISUALISER'S NUMBERS (spec sections 7 and 11, plan 6).
--
-- Every chart in the console reads admin.metric_daily: one whole number per
-- India day, metric, school (or the platform) and dimension. A dimension is a
-- fixed word (a relay, a model, a report kind, a status, a level) or a
-- curriculum label of a library question; no column can hold a person's id.
-- Roll-up functions (one per family, listed in admin.metric_family) fill it;
-- admin.metric_series is the only read. A learning figure for fewer than 10
-- children leaves the database as null; a source this database does not hold
-- is marked not captured with its reason; a day nobody rolled up has no point.

create table if not exists admin.metric_def (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  position integer not null,
  pages text[] not null check (cardinality(pages) > 0
    and pages <@ array['overview', 'money', 'schools', 'learning', 'content', 'reliability', 'funnel', 'safety']),
  label text not null check (char_length(label) between 1 and 80),
  unit text not null check (unit in ('count', 'paise', 'ms', 'minutes', 'units')),
  -- 'utc' only for the meter's units and the ceiling (ruling R4).
  day_kind text not null default 'india' check (day_kind in ('india', 'utc')),
  -- daily: that day; window: the 7 or 30 days ending that day (the key says
  -- which); snapshot: as seen by the nightly run, never recomputed (R7);
  -- cohort: people who entered that day, returned as window totals only (R19).
  kind text not null check (kind in ('daily', 'window', 'snapshot', 'cohort')),
  scope text not null check (scope in ('platform', 'school', 'both')),
  -- A figure about children's learning or use: suppressed under 10 (R2, R3).
  child_figure boolean not null default false,
  total text not null default 'none' check (total in ('sum', 'last', 'none')),
  -- False when this database has no source for it at all (R13).
  captured boolean not null default true,
  -- Said when the figure is not captured (static, or the dynamic checks in
  -- admin.metric_json).
  why text check (why is null or char_length(why) between 20 and 300),
  -- An admin.setting key holding the first day this figure exists.
  since_setting text
);

create table if not exists admin.metric_daily (
  id bigint generated always as identity primary key,
  day date not null,
  metric text not null references admin.metric_def (key) on delete cascade,
  org_id uuid references lms.school (org_id) on delete cascade,
  dim text not null default '' check (char_length(dim) <= 200),
  value bigint not null,
  -- How many children the figure describes; read only by admin.metric_json's
  -- small-group rule and never returned.
  children integer check (children is null or children >= 0),
  computed_at timestamptz not null default now()
);
create unique index if not exists metric_daily_one
  on admin.metric_daily (day, metric, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), dim);
create index if not exists metric_daily_metric_day on admin.metric_daily (metric, day);

create table if not exists admin.metric_run (
  id bigint generated always as identity primary key,
  from_day date not null,
  to_day date not null check (to_day >= from_day),
  nightly boolean not null,
  by_staff uuid,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz not null default clock_timestamp(),
  rows integer not null default 0
);

-- The roll-up functions, called in position order by admin.metric_compute.
-- Each is admin.metric_family_<name>(p_day date, p_nightly boolean) returns
-- integer (the rows it wrote).
create table if not exists admin.metric_family (
  name text primary key check (name ~ '^[a-z][a-z_]{1,30}$'),
  position integer not null unique,
  fn text not null check (fn ~ '^admin\.metric_family_[a-z_]{1,30}$')
);

revoke all on admin.metric_def, admin.metric_daily, admin.metric_run, admin.metric_family
  from public, anon, authenticated, service_role;
alter table admin.metric_def enable row level security;
alter table admin.metric_daily enable row level security;
alter table admin.metric_run enable row level security;
alter table admin.metric_family enable row level security;
-- Statement-level: one audit row per hand-made statement, not one per row.
drop trigger if exists metric_daily_tripwire on admin.metric_daily;
create trigger metric_daily_tripwire after insert or update or delete on admin.metric_daily
  for each statement execute function admin.tripwire();
drop trigger if exists metric_def_tripwire on admin.metric_def;
create trigger metric_def_tripwire after insert or update or delete on admin.metric_def
  for each statement execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- Helpers. Internal.
-- ---------------------------------------------------------------------------

-- The instant an India day begins.
create or replace function admin.ist_start(p_day date)
returns timestamptz
language sql stable
set search_path = admin, public
as $$
  select p_day::timestamp at time zone 'Asia/Kolkata'
$$;

-- The roles besides the owner that may read a chart page (ruling R9). An
-- unknown page gives none: only the owner gets past require_staff, and is then
-- told the page does not exist.
create or replace function admin.chart_roles(p_page text)
returns text[]
language sql immutable
set search_path = admin, public
as $$
  select case
    when p_page = 'money' then array['ops', 'finance']
    when p_page = 'safety' then array['safety']
    when p_page in ('overview', 'schools', 'learning', 'content', 'reliability', 'funnel') then array['ops']
    else array[]::text[]
  end
$$;

-- Whether this database's auth.users has a sign-in time (the hosted project's
-- auth.users has last_sign_in_at; the test harness's has none). Read from the
-- catalogue, which does not depend on the caller's column privileges.
create or replace function admin.signins_readable()
returns boolean
language sql stable security definer
set search_path = admin, public
as $$
  select exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = to_regclass('auth.users')
       and a.attname = 'last_sign_in_at'
       and a.attnum > 0
       and not a.attisdropped
  )
$$;

-- One metric's figures between two days, as the console draws them. A UTC
-- metric's window ends a day earlier (R4). A child figure whose group is
-- under 10 comes back null and suppressed (R2); the group size itself is
-- never returned. A cohort comes back as its total only (R19).
create or replace function admin.metric_json(d admin.metric_def, p_from date, p_to date, p_org uuid, p_one_school boolean)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  f date := case when d.day_kind = 'utc' then p_from - 1 else p_from end;
  t date := case when d.day_kind = 'utc' then p_to - 1 else p_to end;
  since date;
  ok boolean := d.captured;
  pts jsonb;
  tot jsonb;
begin
  if d.since_setting is not null then
    select (s.value #>> '{}')::date into since from admin.setting s where s.key = d.since_setting;
    ok := ok and since is not null;
  end if;
  if d.key = 'school.signins' then
    ok := ok and admin.signins_readable();
  end if;
  if not ok then
    return jsonb_build_object('key', d.key, 'label', d.label, 'unit', d.unit, 'dayKind', d.day_kind, 'kind', d.kind,
      'captured', false, 'why', d.why, 'capturedSince', null, 'from', f, 'to', t, 'total', null, 'points', '[]'::jsonb);
  end if;
  with r as (
    select m.day, m.dim, s.code as school, m.value, m.children,
           d.child_figure and coalesce(m.children, 0) < 10 as hidden
      from admin.metric_daily m
      left join lms.school s on s.org_id = m.org_id
     where m.metric = d.key and m.day between f and t
       and (since is null or m.day >= since)
       and case when p_one_school then m.org_id = p_org
                when d.scope = 'school' then m.org_id is not null
                else m.org_id is null end
  )
  select
    case when d.kind = 'cohort' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('day', r.day, 'dim', r.dim, 'school', r.school,
               'value', case when r.hidden then null else r.value end, 'suppressed', r.hidden)
             order by r.day, r.school nulls first, r.dim)
        from r), '[]'::jsonb) end,
    case d.total
      when 'none' then null
      when 'sum' then (
        select jsonb_build_object(
                 'value', case when d.child_figure and coalesce(sum(r.children), 0) < 10 then null else coalesce(sum(r.value), 0) end,
                 'suppressed', d.child_figure and coalesce(sum(r.children), 0) < 10)
          from r where r.dim = '')
      else (
        select jsonb_build_object(
                 'value', case when d.child_figure and coalesce(sum(r.children), 0) < 10 then null else sum(r.value) end,
                 'suppressed', d.child_figure and coalesce(sum(r.children), 0) < 10)
          from r where r.dim = '' and r.day = (select max(x.day) from r x where x.dim = ''))
    end
  into pts, tot;
  return jsonb_build_object('key', d.key, 'label', d.label, 'unit', d.unit, 'dayKind', d.day_kind, 'kind', d.kind,
    'captured', true, 'why', null, 'capturedSince', since, 'from', f, 'to', t, 'total', tot, 'points', pts);
end;
$$;

-- ---------------------------------------------------------------------------
-- The one read. Browser-callable; checks the page's roles itself.
-- ---------------------------------------------------------------------------

-- A chart page's figures for the 7 or 30 India days ending yesterday, for the
-- platform or (Schools and Learning only) one school.
create or replace function admin.metric_series(p_page text, p_days integer, p_school text default null)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(admin.chart_roles(p_page));
  org uuid;
  last_day date;
  first_day date;
  sch jsonb;
  run jsonb;
  ms jsonb;
begin
  if cardinality(admin.chart_roles(p_page)) = 0 then
    raise exception 'there is no chart page called %', coalesce(p_page, '(none)');
  end if;
  if p_days is null or p_days not in (7, 30) then
    raise exception 'days is 7 or 30';
  end if;
  if p_school is not null then
    if p_page not in ('schools', 'learning') then
      raise exception 'this page has no view of one school';
    end if;
    org := admin.school_org(p_school);
    select jsonb_build_object('code', s.code, 'name', s.display_name) into sch from lms.school s where s.org_id = org;
  end if;
  last_day := lms.india_today() - 1;
  first_day := last_day - p_days + 1;
  select jsonb_build_object('through', r.to_day, 'finishedAt', r.finished_at, 'nightly', r.nightly) into run
    from admin.metric_run r order by r.finished_at desc, r.id desc limit 1;
  select coalesce(jsonb_agg(admin.metric_json(d, first_day, last_day, org, p_school is not null) order by d.position, d.key), '[]'::jsonb)
    into ms
    from admin.metric_def d
   where p_page = any (d.pages)
     and (p_school is null or d.scope <> 'platform');
  return jsonb_build_object('page', p_page, 'days', p_days, 'from', first_day, 'to', last_day,
    'school', sch, 'lastRun', run, 'metrics', ms);
end;
$$;

-- ---------------------------------------------------------------------------
-- What this database cannot see on this branch (ruling R13).
-- ---------------------------------------------------------------------------

-- Catalogue rows are written inside a DO block with admin.session on, so the
-- migration itself leaves no unmanaged-change row.
do $cat$
begin
perform set_config('admin.session', 'on', true);
insert into admin.metric_def (key, position, pages, label, unit, day_kind, kind, scope, child_figure, total, captured, why)
values
  ('relay.refusals', 600, array['reliability'], 'Refusals by reason', 'count', 'india', 'daily', 'platform', false, 'none', false,
   'The relay''s refusals (stopped, the ceiling, a child''s day used up, too fast) are answered by claim_relay, which keeps no record of them.'),
  ('calls.latency', 610, array['reliability'], 'Latency', 'ms', 'india', 'daily', 'platform', false, 'none', false,
   'No call''s duration is recorded: usage_event has no column for it.'),
  ('alarm.history', 620, array['reliability'], 'Alarm checks over time', 'count', 'india', 'daily', 'platform', false, 'none', false,
   'Only the alarm''s last check is kept (one setting, overwritten by every check), so there is no history to draw.')
on conflict (key) do update set position = excluded.position, pages = excluded.pages, label = excluded.label,
  unit = excluded.unit, day_kind = excluded.day_kind, kind = excluded.kind, scope = excluded.scope,
  child_figure = excluded.child_figure, total = excluded.total, captured = excluded.captured, why = excluded.why;
perform set_config('admin.session', '', true);
end;
$cat$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function admin.ist_start(date) from public, anon, authenticated, service_role;
revoke all on function admin.chart_roles(text) from public, anon, authenticated, service_role;
revoke all on function admin.signins_readable() from public, anon, authenticated, service_role;
revoke all on function admin.metric_json(admin.metric_def, date, date, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.metric_series(text, integer, text) from public, anon;
grant execute on function admin.metric_series(text, integer, text) to authenticated;
