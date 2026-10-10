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

-- Whether this database's auth.users has a sign-in time column,
-- last_sign_in_at (Supabase's auth.users documents one, UNVERIFIED on Qrie's
-- project; the test harness's has none). Read from the catalogue, which does
-- not depend on the caller's column privileges.
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

-- ---------------------------------------------------------------------------
-- Running the roll-ups.
-- ---------------------------------------------------------------------------

-- Rolls up one India day. Rows of that day that a recompute may rebuild are
-- deleted first (daily and window figures on the India day; daily UTC figures
-- on the day before, because the run for India day D writes UTC day D - 1:
-- ruling R4); snapshots are deleted and rewritten only by the nightly run
-- (R7). Cohorts are each family's own (the funnel's, 0073). Returns the rows
-- written.
create or replace function admin.metric_compute(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  f record;
  n integer;
  total integer := 0;
begin
  perform set_config('admin.session', 'on', true);
  delete from admin.metric_daily m using admin.metric_def d
   where d.key = m.metric
     and ((d.day_kind = 'india' and d.kind in ('daily', 'window') and m.day = p_day)
       or (d.day_kind = 'utc' and d.kind = 'daily' and m.day = p_day - 1)
       or (p_nightly and d.kind = 'snapshot' and m.day = p_day));
  for f in select x.fn from admin.metric_family x order by x.position loop
    execute format('select %s($1, $2)', f.fn) into n using p_day, p_nightly;
    total := total + coalesce(n, 0);
  end loop;
  return total;
end;
$$;

-- pg_cron, 18:50 UTC (00:20 in India): yesterday with its snapshots, then the
-- six days before without them (sittings close and devices sync late).
create or replace function admin.metric_nightly()
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  t0 timestamptz := clock_timestamp();
  yesterday date := lms.india_today() - 1;
  n integer := 0;
  i integer;
begin
  perform pg_advisory_xact_lock(hashtext('admin.metric_daily'));
  n := admin.metric_compute(yesterday, true);
  for i in 1 .. 6 loop
    n := n + admin.metric_compute(yesterday - i, false);
  end loop;
  insert into admin.metric_run (from_day, to_day, nightly, rows, started_at)
  values (yesterday - 6, yesterday, true, n, t0);
  return jsonb_build_object('day', yesterday, 'rows', n);
end;
$$;

select cron.schedule('admin-metrics-nightly', '50 18 * * *', $job$ select admin.metric_nightly(); $job$);

-- The owner works out the figures of up to 92 days ending yesterday again,
-- from the records as they are now (R8). Snapshots are left as they were (R7).
create or replace function admin.metric_recompute(p_from date, p_to date, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  t0 timestamptz := clock_timestamp();
  n integer := 0;
  i integer;
  result jsonb;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_from is null or p_to is null or p_from > p_to or p_to >= lms.india_today() or p_to - p_from > 91 then
    raise exception 'pick up to 92 days, ending yesterday or earlier';
  end if;
  perform pg_advisory_xact_lock(hashtext('admin.metric_daily'));
  for i in 0 .. (p_to - p_from) loop
    n := n + admin.metric_compute(p_from + i, false);
  end loop;
  perform set_config('admin.session', 'on', true);
  insert into admin.metric_run (from_day, to_day, nightly, by_staff, rows, started_at)
  values (p_from, p_to, false, me.user_id, n, t0);
  result := jsonb_build_object('from', p_from, 'to', p_to, 'days', p_to - p_from + 1, 'rows', n);
  perform admin.audit(me, 'metrics-recomputed', 'metrics', '', p_reason, result);
  return result;
end;
$$;

-- The ceiling in force when a UTC day ended (R5): the latest change made
-- before that moment, else the value the earliest later change started from,
-- else the ceiling now. Only admin.set_caps and admin.revert_caps change it,
-- and both write an audit row (0048); a change made by hand in SQL is not seen.
create or replace function admin.ceiling_on(p_utc_day date)
returns integer
language sql stable security definer
set search_path = admin, public
as $$
  select coalesce(
    (select (a.details ->> 'to')::int from admin.audit_event a
      where a.action in ('ceiling-set', 'ceiling-reverted')
        and a.at < (p_utc_day + 1)::timestamp at time zone 'UTC'
      order by a.at desc, a.id desc limit 1),
    (select (a.details ->> 'from')::int from admin.audit_event a
      where a.action = 'ceiling-set'
        and a.at >= (p_utc_day + 1)::timestamp at time zone 'UTC'
      order by a.at, a.id limit 1),
    (select c.global_units_per_day from public.relay_control c where c.id))
$$;

-- ---------------------------------------------------------------------------
-- The tutor's families. Each writes its platform rows with dim '' even when
-- nothing happened (a computed 0), and returns the rows it wrote.
-- ---------------------------------------------------------------------------

-- Learners (R11): anyone with a sitting or an answer the server received that
-- India day, once, split by whether their organisation is a school. Minutes
-- on task, classes served, and the cost of closed sittings with measured
-- time, as public.cost_per_student_hour counts them (0008, R10).
create or replace function admin.metric_family_tutor(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  day_start timestamptz := admin.ist_start(p_day);
  day_end timestamptz := admin.ist_start(p_day + 1);
  n integer;
  total integer := 0;
begin
  with who as (
    select ls.user_id, ls.org_id from public.learning_session ls where ls.received_at >= day_start and ls.received_at < day_end
    union
    select le.user_id, le.org_id from public.ledger_event le where le.received_at >= day_start and le.received_at < day_end
  ), tagged as (
    select w.user_id, exists (select 1 from lms.school sc where sc.org_id = w.org_id) as at_school from who w
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, 'tutor.learners', x.dim, x.n from (
    select '' as dim, count(distinct user_id) as n from tagged
    union all select 'school', count(distinct user_id) filter (where at_school) from tagged
    union all select 'direct', count(distinct user_id) filter (where not at_school) from tagged) x;
  get diagnostics n = row_count;
  total := total + n;

  with closed as (
    select ls.id, ls.active_ms
      from public.learning_session ls
     where ls.received_at >= day_start and ls.received_at < day_end
       and ls.ended_at is not null
       and ls.active_ms is not null and ls.active_ms > 0
  ), spend as (
    select c.id, c.active_ms, coalesce(sum(u.inr), 0) as inr,
           count(u.id) as calls, count(u.id) filter (where u.unpriced) as unpriced
      from closed c
      left join public.usage_cost u on u.session_id = c.id
     group by c.id, c.active_ms
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, x.metric, '', x.value from (
    select 'tutor.minutes' as metric, coalesce(sum(sp.active_ms), 0)::bigint as value from spend sp
    union all select 'cost.sitting_paise', round(coalesce(sum(sp.inr), 0) * 100)::bigint from spend sp
    union all select 'cost.active_ms', coalesce(sum(sp.active_ms), 0)::bigint from spend sp
    union all select 'cost.sitting_calls', coalesce(sum(sp.calls), 0)::bigint from spend sp
    union all select 'cost.sitting_unpriced_calls', coalesce(sum(sp.unpriced), 0)::bigint from spend sp
    union all select 'tutor.classes', count(*)::bigint
                from public.learning_session ls
               where ls.received_at >= day_start and ls.received_at < day_end and ls.source = 'class') x;
  get diagnostics n = row_count;
  return total + n;
end;
$$;

-- AI spend by the time of the call (usage_event.at, the server's clock): in
-- all, by relay, model, bucket, and whether the caller's organisation is a
-- school; per school (a 0 for a school that spent nothing); preparing classes
-- (live calls with a preparation id, R17); pictures (images at the image price).
create or replace function admin.metric_family_spend(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  day_start timestamptz := admin.ist_start(p_day);
  day_end timestamptz := admin.ist_start(p_day + 1);
  n integer;
  total integer := 0;
begin
  with u as materialized (
    select c.relay, c.model, c.bucket, c.prep_id, c.provider, c.at, c.images, c.inr, c.unpriced,
           exists (select 1 from lms.school sc where sc.org_id = c.org_id) as at_school,
           case when coalesce(c.images, 0) > 0 then public.price_at(c.provider, c.model, 'image', c.at) end as image_price
      from public.usage_cost c
     where c.at >= day_start and c.at < day_end
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, x.metric, x.dim, x.value from (
    select 'spend.paise' as metric, '' as dim, round(coalesce(sum(u.inr), 0) * 100)::bigint as value from u
    union all select 'spend.paise', 'relay:' || u.relay, round(coalesce(sum(u.inr), 0) * 100)::bigint from u group by u.relay
    union all select 'spend.paise', 'model:' || left(coalesce(u.model, 'none'), 190), round(coalesce(sum(u.inr), 0) * 100)::bigint
                from u group by left(coalesce(u.model, 'none'), 190)
    union all select 'spend.paise', 'bucket:' || coalesce(u.bucket, 'none'), round(coalesce(sum(u.inr), 0) * 100)::bigint
                from u group by coalesce(u.bucket, 'none')
    union all select 'spend.paise', case when u.at_school then 'who:school' else 'who:direct' end,
                     round(coalesce(sum(u.inr), 0) * 100)::bigint
                from u group by u.at_school
    union all select 'spend.calls', '', count(*)::bigint from u
    union all select 'spend.unpriced_calls', '', (count(*) filter (where u.unpriced))::bigint from u
    union all select 'prep.count', '', (count(distinct u.prep_id) filter (where u.bucket = 'live' and u.prep_id is not null))::bigint from u
    union all select 'prep.paise', '',
                     round(coalesce(sum(u.inr) filter (where u.bucket = 'live' and u.prep_id is not null), 0) * 100)::bigint from u
    union all select 'prep.unpriced_calls', '',
                     (count(*) filter (where u.bucket = 'live' and u.prep_id is not null and u.unpriced))::bigint from u
    union all select 'pictures.count', '', coalesce(sum(u.images), 0)::bigint from u
    union all select 'pictures.paise', '',
                     round(coalesce(sum(u.images * u.image_price) filter (where u.images > 0), 0) * 100)::bigint from u
    union all select 'pictures.unpriced_calls', '',
                     (count(*) filter (where u.images > 0 and u.image_price is null))::bigint from u) x;
  get diagnostics n = row_count;
  total := total + n;

  with per as (
    select c.org_id, round(coalesce(sum(c.inr), 0) * 100)::bigint as paise,
           (count(*) filter (where c.unpriced))::bigint as unpriced
      from public.usage_cost c
     where c.at >= day_start and c.at < day_end and c.org_id is not null
     group by c.org_id
  )
  insert into admin.metric_daily (day, metric, org_id, dim, value)
  select p_day, 'spend.school_paise', sc.org_id, '', coalesce(per.paise, 0)
    from lms.school sc left join per on per.org_id = sc.org_id
  union all
  select p_day, 'spend.school_unpriced_calls', sc.org_id, '', coalesce(per.unpriced, 0)
    from lms.school sc left join per on per.org_id = sc.org_id;
  get diagnostics n = row_count;
  return total + n;
end;
$$;

-- The meter's units and the ceiling, by UTC day (R4): the run for India day D
-- writes UTC day D - 1, the last UTC day that has ended by 00:20 in India.
create or replace function admin.metric_family_relay(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  x date := p_day - 1;
  n integer;
begin
  insert into admin.metric_daily (day, metric, dim, value) values
    (x, 'relay.units', '', coalesce((select b.units from public.relay_budget_day b where b.day = x), 0)),
    (x, 'relay.ceiling', '', admin.ceiling_on(x));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Calls by upstream status (R12): answered (2xx-3xx), refused upstream (4xx),
-- failed upstream (5xx), no visible outcome (0, a stream the host carried),
-- anything else; in all, by class, and by relay and class.
create or replace function admin.metric_family_calls(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  day_start timestamptz := admin.ist_start(p_day);
  day_end timestamptz := admin.ist_start(p_day + 1);
  n integer;
begin
  with c as materialized (
    select ue.relay,
           case when ue.status = 0 then 'none'
                when ue.status between 200 and 399 then 'ok'
                when ue.status between 400 and 499 then 'client'
                when ue.status >= 500 then 'server'
                else 'other' end as k
      from public.usage_event ue
     where ue.at >= day_start and ue.at < day_end
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, 'calls.outcome', x.dim, x.value from (
    select '' as dim, count(*)::bigint as value from c
    union all select c.k, count(*)::bigint from c group by c.k
    union all select c.relay || ':' || c.k, count(*)::bigint from c group by c.relay, c.k) x;
  get diagnostics n = row_count;
  return n;
end;
$$;

insert into admin.metric_family (name, position, fn) values
  ('tutor', 10, 'admin.metric_family_tutor'),
  ('spend', 20, 'admin.metric_family_spend'),
  ('relay', 30, 'admin.metric_family_relay'),
  ('calls', 40, 'admin.metric_family_calls')
on conflict (name) do update set position = excluded.position, fn = excluded.fn;

do $cat$
begin
perform set_config('admin.session', 'on', true);
insert into admin.metric_def (key, position, pages, label, unit, day_kind, kind, scope, child_figure, total)
values
  ('tutor.learners', 10, array['overview'], 'Learners per day', 'count', 'india', 'daily', 'platform', false, 'none'),
  ('tutor.minutes', 20, array['overview'], 'Minutes on task', 'ms', 'india', 'daily', 'platform', false, 'sum'),
  ('tutor.classes', 30, array['overview'], 'Classes served', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('relay.units', 40, array['overview'], 'Meter units used (UTC day)', 'units', 'utc', 'daily', 'platform', false, 'none'),
  ('relay.ceiling', 41, array['overview'], 'The ceiling (UTC day)', 'units', 'utc', 'daily', 'platform', false, 'none'),
  ('cost.sitting_paise', 50, array['overview'], 'Spend of closed sittings', 'paise', 'india', 'daily', 'platform', false, 'sum'),
  ('cost.active_ms', 51, array['overview'], 'Time on task of those sittings', 'ms', 'india', 'daily', 'platform', false, 'sum'),
  ('cost.sitting_calls', 52, array['overview'], 'Calls in those sittings', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('cost.sitting_unpriced_calls', 53, array['overview'], 'Unpriced calls in those sittings', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('spend.paise', 100, array['money', 'content'], 'AI spend', 'paise', 'india', 'daily', 'platform', false, 'sum'),
  ('spend.calls', 101, array['money'], 'Calls', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('spend.unpriced_calls', 102, array['money'], 'Unpriced calls', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('spend.school_paise', 110, array['money'], 'AI spend by school', 'paise', 'india', 'daily', 'school', false, 'sum'),
  ('spend.school_unpriced_calls', 111, array['money'], 'Unpriced calls by school', 'count', 'india', 'daily', 'school', false, 'sum'),
  ('prep.count', 120, array['money'], 'Classes prepared', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('prep.paise', 121, array['money'], 'Spend preparing them', 'paise', 'india', 'daily', 'platform', false, 'sum'),
  ('prep.unpriced_calls', 122, array['money'], 'Unpriced preparing calls', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('pictures.count', 130, array['content'], 'Pictures made', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('pictures.paise', 131, array['content'], 'Spend on pictures', 'paise', 'india', 'daily', 'platform', false, 'sum'),
  ('pictures.unpriced_calls', 132, array['content'], 'Unpriced picture calls', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('calls.outcome', 500, array['reliability'], 'Calls by outcome', 'count', 'india', 'daily', 'platform', false, 'sum')
on conflict (key) do update set position = excluded.position, pages = excluded.pages, label = excluded.label,
  unit = excluded.unit, day_kind = excluded.day_kind, kind = excluded.kind, scope = excluded.scope,
  child_figure = excluded.child_figure, total = excluded.total;
perform set_config('admin.session', '', true);
end;
$cat$;

revoke all on function admin.metric_compute(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.ceiling_on(date) from public, anon, authenticated, service_role;
revoke all on function admin.metric_family_tutor(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.metric_family_spend(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.metric_family_relay(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.metric_family_calls(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.metric_nightly() from public, anon, authenticated;
grant execute on function admin.metric_nightly() to service_role;
revoke all on function admin.metric_recompute(date, date, text, text) from public, anon;
grant execute on function admin.metric_recompute(date, date, text, text) to authenticated;
