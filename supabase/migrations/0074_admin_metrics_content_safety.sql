-- CONTENT AND SAFETY OVER TIME (plan 6, the Content, Safety and Overview
-- chart pages).
--
-- content.classes  prepared classes by review status, and "removed": classes
--   retracted or rejected whose catalogue row is gone (snapshot, R22).
-- content.bank  the question bank: library questions, a school's own
--   questions approved or waiting, and teachers' drafts (snapshot, R22).
-- reports.new  reports by the India day they arrived, in all and by kind.
-- reports.open  reports open at the end of each India day, in all and by the
--   state they were in then, rebuilt from seen_at, actioned_at (the time a
--   report became triaged) and closed_at (R20). A report closed before 0067
--   has no closed_at and counts as closed on every day.
-- reports.looked / reports.first_look_median  of the reports that arrived
--   each day, those looked at, and the median minutes to the first look
--   (written only when at least one was looked at).
-- safety.flags  distress flags by the India day they arrived, in all and by
--   direction; only on and after distress_capture_since, and for the
--   platform only (R21). Before that day there is no figure, and
--   admin.metric_json reads the metric not captured while the setting is unset.
--
-- admin.content_view: classes by status and the bank now, and the ten most
-- reported and the ten costliest classes to date (plan 5's class_reports and
-- class_cost_for): counts and rupees only.

-- Classes by status and the question bank, as they are now. Internal.
create or replace function admin.content_counts()
returns jsonb
language sql stable security definer
set search_path = admin, lms, public
as $$
  select jsonb_build_object(
    'classes', jsonb_build_object(
      'pending', (select count(*)::int from public.prepared_class p where p.review_status = 'pending'),
      'published', (select count(*)::int from public.prepared_class p where p.review_status = 'published'),
      'retracted', (select count(*)::int from public.prepared_class p where p.review_status = 'retracted'),
      'removed', (select count(distinct cr.class_id)::int from admin.class_review cr
                   where cr.action in ('retracted', 'rejected')
                     and not exists (select 1 from public.prepared_class p where p.id = cr.class_id))),
    'bank', jsonb_build_object(
      'library', (select count(*)::int from lms.item i where i.org_id is null),
      'schoolApproved', (select count(*)::int from lms.item i
                          where i.org_id is not null
                            and exists (select 1 from lms.item_approval ap where ap.item_id = i.id and ap.org_id = i.org_id)),
      'schoolWaiting', (select count(*)::int from lms.item i
                         where i.org_id is not null
                           and not exists (select 1 from lms.item_approval ap where ap.item_id = i.id and ap.org_id = i.org_id)),
      'drafts', (select count(*)::int from lms.item_draft d)))
$$;

create or replace function admin.metric_family_content(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  c jsonb;
  n integer;
begin
  if not p_nightly then
    return 0;
  end if;
  c := admin.content_counts();
  insert into admin.metric_daily (day, metric, dim, value) values
    (p_day, 'content.classes', 'pending', (c #>> '{classes,pending}')::bigint),
    (p_day, 'content.classes', 'published', (c #>> '{classes,published}')::bigint),
    (p_day, 'content.classes', 'retracted', (c #>> '{classes,retracted}')::bigint),
    (p_day, 'content.classes', 'removed', (c #>> '{classes,removed}')::bigint),
    (p_day, 'content.bank', 'library', (c #>> '{bank,library}')::bigint),
    (p_day, 'content.bank', 'school_approved', (c #>> '{bank,schoolApproved}')::bigint),
    (p_day, 'content.bank', 'school_waiting', (c #>> '{bank,schoolWaiting}')::bigint),
    (p_day, 'content.bank', 'drafts', (c #>> '{bank,drafts}')::bigint);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function admin.metric_family_safety(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  day_start timestamptz := admin.ist_start(p_day);
  day_end timestamptz := admin.ist_start(p_day + 1);
  since date;
  n integer;
  total integer := 0;
begin
  -- New reports, by kind.
  with r as materialized (
    select sr.kind from public.student_report sr where sr.received_at >= day_start and sr.received_at < day_end
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, 'reports.new', x.dim, x.value from (
    select '' as dim, count(*)::bigint as value from r
    union all select r.kind, count(*)::bigint from r group by r.kind) x;
  get diagnostics n = row_count;
  total := total + n;

  -- Open at the day's end, by the state each was in then.
  with o as materialized (
    select case when sr.actioned_at < day_end then 'triaged'
                when sr.seen_at < day_end then 'seen'
                else 'new' end as state
      from public.student_report sr
     where sr.received_at < day_end
       and not (sr.status = 'closed' and (sr.closed_at is null or sr.closed_at < day_end))
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, 'reports.open', x.dim, x.value from (
    select '' as dim, count(*)::bigint as value from o
    union all select o.state, count(*)::bigint from o group by o.state) x;
  get diagnostics n = row_count;
  total := total + n;

  -- The first look, for the reports that arrived that day.
  with l as materialized (
    select extract(epoch from sr.seen_at - sr.received_at) / 60 as minutes
      from public.student_report sr
     where sr.received_at >= day_start and sr.received_at < day_end and sr.seen_at is not null
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, 'reports.looked', '', count(*)::bigint from l
  union all
  select p_day, 'reports.first_look_median', '', floor(percentile_cont(0.5) within group (order by l.minutes))::bigint
    from l having count(*) > 0;
  get diagnostics n = row_count;
  total := total + n;

  -- Distress flags, from the day capture went live.
  select (s.value #>> '{}')::date into since from admin.setting s where s.key = 'distress_capture_since';
  if since is not null and p_day >= since then
    with f as materialized (
      select e.direction from admin.safety_event e where e.received_at >= day_start and e.received_at < day_end
    )
    insert into admin.metric_daily (day, metric, dim, value)
    select p_day, 'safety.flags', x.dim, x.value from (
      select '' as dim, count(*)::bigint as value from f
      union all select f.direction, count(*)::bigint from f group by f.direction) x;
    get diagnostics n = row_count;
    total := total + n;
  end if;
  return total;
end;
$$;

-- Classes and the bank now, and the most reported and costliest classes to
-- date. Owner and ops (ruling R9).
create or replace function admin.content_view()
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  c jsonb := admin.content_counts();
begin
  return jsonb_build_object(
    'classes', c -> 'classes',
    'bank', c -> 'bank',
    'mostReported', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'topicRef', x.topic_ref, 'reports', x.r)
                       order by (x.r ->> 'total')::int desc, x.id)
        from (
          select p.id, p.title, p.topic_ref, admin.class_reports(p.id, p.topic_ref) as r
            from public.prepared_class p
           where (admin.class_reports(p.id, p.topic_ref) ->> 'total')::int > 0
           order by (admin.class_reports(p.id, p.topic_ref) ->> 'total')::int desc, p.id
           limit 10
        ) x), '[]'::jsonb),
    'mostCost', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'topicRef', x.topic_ref, 'cost', x.k)
                       order by (x.k ->> 'inr')::numeric desc, x.id)
        from (
          select y.id, y.title, y.topic_ref, y.k
            from (select p.id, p.title, p.topic_ref, admin.class_cost_for(p.topic_ref) as k
                    from public.prepared_class p) y
           where (y.k ->> 'calls')::int > 0
           order by (y.k ->> 'inr')::numeric desc, y.id
           limit 10
        ) x), '[]'::jsonb));
end;
$$;

insert into admin.metric_family (name, position, fn) values
  ('content', 100, 'admin.metric_family_content'),
  ('safety', 110, 'admin.metric_family_safety')
on conflict (name) do update set position = excluded.position, fn = excluded.fn;

do $cat$
begin
perform set_config('admin.session', 'on', true);
insert into admin.metric_def (key, position, pages, label, unit, day_kind, kind, scope, child_figure, total, since_setting, why)
values
  ('content.classes', 140, array['content'], 'Classes by status', 'count', 'india', 'snapshot', 'platform', false, 'none', null, null),
  ('content.bank', 150, array['content'], 'Question bank', 'count', 'india', 'snapshot', 'platform', false, 'none', null, null),
  ('reports.new', 60, array['overview', 'safety'], 'New reports', 'count', 'india', 'daily', 'platform', false, 'sum', null, null),
  ('reports.open', 61, array['overview', 'safety'], 'Open reports at the day''s end', 'count', 'india', 'daily', 'platform', false, 'last', null, null),
  ('reports.looked', 62, array['safety'], 'Reports looked at, by the day they arrived', 'count', 'india', 'daily', 'platform', false, 'sum', null, null),
  ('reports.first_look_median', 63, array['safety'], 'Median minutes to the first look', 'minutes', 'india', 'daily', 'platform', false, 'none', null, null),
  ('safety.flags', 70, array['safety'], 'Distress flags', 'count', 'india', 'daily', 'platform', false, 'sum', 'distress_capture_since',
   'Distress flags are not captured yet: none has arrived and the day capture went live is not recorded.')
on conflict (key) do update set position = excluded.position, pages = excluded.pages, label = excluded.label,
  unit = excluded.unit, day_kind = excluded.day_kind, kind = excluded.kind, scope = excluded.scope,
  child_figure = excluded.child_figure, total = excluded.total, since_setting = excluded.since_setting, why = excluded.why;
perform set_config('admin.session', '', true);
end;
$cat$;

revoke all on function admin.content_counts() from public, anon, authenticated, service_role;
revoke all on function admin.metric_family_content(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.metric_family_safety(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.content_view() from public, anon;
grant execute on function admin.content_view() to authenticated;
