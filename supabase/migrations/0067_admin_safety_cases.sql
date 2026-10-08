-- REPORT TRIAGE, CASES AND THE READ LOG (spec sections 6, 8 and 11, plan 5).
--
-- A child's report is triaged by its kind, its age and its status, never by
-- its words: no list, tile or overview here returns a note, a spoken line, a
-- session, a beat, a topic or a user id. The words leave the database through
-- one function only, admin.case_report: one report, inside an open case held
-- by the reader, opened with a fresh authenticator code and a typed reason
-- (admin.case_open). Every reading of the words, and of their context, is a
-- row in admin.read_log, which nobody can change or empty, and each member of
-- staff may make at most 30 such reads in an India day (ruling R10).
--
-- Ruling R7, the statuses as the console names them: new (Unread), seen
-- (Read: the first look), triaged (a case is open on it, or someone marked it
-- so), closed. 0019's 'actioned' becomes 'triaged' and 'dismissed' becomes
-- 'closed'; 'new' keeps its name, so admin.today(), public.alert_snapshot and
-- the health card, which count status = 'new', read as before.

-- ---------------------------------------------------------------------------
-- 1. Report statuses, as the console names them.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.student_report'::regclass and conname = 'student_report_status_check') then
    raise exception '0067: no check named student_report_status_check on public.student_report; find the live name and replace that one';
  end if;
end
$$;
alter table public.student_report drop constraint student_report_status_check;
update public.student_report set status = 'triaged' where status = 'actioned';
update public.student_report set status = 'closed' where status = 'dismissed';
alter table public.student_report add constraint student_report_status_check
  check (status in ('new', 'seen', 'triaged', 'closed'));
alter table public.student_report add column if not exists seen_at timestamptz;   -- the first look
alter table public.student_report add column if not exists closed_at timestamptz;
-- 0019's actioned_at is the time a report became triaged.
drop trigger if exists student_report_tripwire on public.student_report;
create trigger student_report_tripwire after update on public.student_report
  for each row execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- 2. A case: one report, opened by one member of staff with a reason.
-- ---------------------------------------------------------------------------
create table if not exists admin.case (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.student_report on delete set null,
  org_id uuid,
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'closed')),
  outcome text check (outcome in ('no-action', 'content-fixed', 'disclosed', 'referred', 'other')),
  closed_by uuid,
  closed_at timestamptz,
  close_reason text check (char_length(close_reason) <= 500),
  check ((status = 'closed') = (closed_at is not null))
);
create unique index if not exists case_one_open_per_report on admin.case (report_id) where status = 'open';
create unique index if not exists case_one_open_per_person on admin.case (opened_by) where status = 'open';
revoke all on admin.case from public, anon, authenticated, service_role;
alter table admin.case enable row level security;
drop trigger if exists case_tripwire on admin.case;
create trigger case_tripwire after insert or update or delete on admin.case
  for each row execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- 3. Every opening of a child's words or their context, insert-only.
-- ---------------------------------------------------------------------------
create table if not exists admin.read_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  staff uuid not null,
  staff_role text not null,
  case_id uuid not null,
  report_id uuid,
  what text not null check (what in ('report', 'context')),
  reason text not null check (char_length(reason) between 3 and 500)
);
revoke all on admin.read_log from public, anon, authenticated, service_role;
alter table admin.read_log enable row level security;
drop trigger if exists read_log_no_change on admin.read_log;
create trigger read_log_no_change before update or delete on admin.read_log
  for each row execute function admin.audit_immutable();
drop trigger if exists read_log_no_truncate on admin.read_log;
create trigger read_log_no_truncate before truncate on admin.read_log
  for each statement execute function admin.audit_immutable();

-- Reads by one member of staff since midnight in India.
create or replace function admin.reads_today(p_staff uuid)
returns integer
language sql stable security definer
set search_path = admin, lms, public
as $$
  select count(*)::int from admin.read_log r
   where r.staff = p_staff and r.at >= (lms.india_today()::timestamp at time zone 'Asia/Kolkata')
$$;
revoke all on function admin.reads_today(uuid) from public, anon, authenticated;

-- A school as the console shows it, or null for a child who came on their own.
create or replace function admin.school_ref(p_org uuid)
returns jsonb
language sql stable security definer
set search_path = admin, lms, public
as $$
  select jsonb_build_object('code', s.code, 'name', s.display_name) from lms.school s where s.org_id = p_org
$$;
revoke all on function admin.school_ref(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the Safety page reads: counts, ages and statuses only.
-- ---------------------------------------------------------------------------
create or replace function admin.safety_overview()
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  c record;
  k record;
  a record;
  f record;
  cs record;
begin
  select count(*) filter (where r.status = 'new')::int as unread,
         count(*) filter (where r.status = 'seen')::int as read,
         count(*) filter (where r.status = 'triaged')::int as triaged,
         count(*) filter (where r.status = 'closed')::int as closed
    into c from public.student_report r;
  select count(*) filter (where r.kind = 'wrong')::int as wrong,
         count(*) filter (where r.kind = 'rude')::int as rude,
         count(*) filter (where r.kind = 'unsafe')::int as unsafe,
         count(*) filter (where r.kind = 'other')::int as other
    into k from public.student_report r where r.status = 'new';
  select count(*) filter (where r.received_at > now() - interval '1 hour')::int as under_hour,
         count(*) filter (where r.received_at <= now() - interval '1 hour' and r.received_at > now() - interval '1 day')::int as under_day,
         count(*) filter (where r.received_at <= now() - interval '1 day' and r.received_at > now() - interval '7 days')::int as under_week,
         count(*) filter (where r.received_at <= now() - interval '7 days')::int as older
    into a from public.student_report r where r.status = 'new';
  select count(*)::int as reports,
         count(r.seen_at)::int as looked,
         floor(percentile_cont(0.5) within group (order by extract(epoch from r.seen_at - r.received_at) / 60)
                 filter (where r.seen_at is not null))::int as median_minutes,
         floor(max(extract(epoch from r.seen_at - r.received_at) / 60))::int as max_minutes
    into f from public.student_report r where r.received_at > now() - interval '30 days';
  select count(*)::int as open,
         count(*) filter (where x.opened_by = me.user_id)::int as mine
    into cs from admin.case x where x.status = 'open';
  return jsonb_build_object(
    'generatedAt', now(),
    'counts', jsonb_build_object('unread', c.unread, 'read', c.read, 'triaged', c.triaged, 'closed', c.closed),
    'unreadByKind', jsonb_build_object('wrong', k.wrong, 'rude', k.rude, 'unsafe', k.unsafe, 'other', k.other),
    'unreadAges', jsonb_build_object('underHour', a.under_hour, 'underDay', a.under_day,
                                     'underWeek', a.under_week, 'older', a.older),
    'firstLook', jsonb_build_object('reports30d', f.reports, 'looked30d', f.looked,
                                    'medianMinutes', f.median_minutes, 'maxMinutes', f.max_minutes),
    'cases', jsonb_build_object('open', cs.open, 'mineOpen', cs.mine),
    'capture', admin.distress_capture(),
    -- The same 30 as reads_per_day in case_report and case_context.
    'quota', jsonb_build_object('readsToday', admin.reads_today(me.user_id), 'perDay', 30)
  );
end;
$$;

-- The report list: unread first, oldest first; then the rest, newest first.
-- Each row is exactly the eleven fields below: never a note, a spoken line, a
-- session, a beat, a topic, a build or a user id.
create or replace function admin.safety_reports(
  p_status text default null, p_kind text default null, p_school text default null, p_limit integer default 100
)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  lim integer := greatest(1, least(coalesce(p_limit, 100), 500));
  org uuid;
  v_rows jsonb;
  n integer;
begin
  if p_status is not null and p_status not in ('new', 'seen', 'triaged', 'closed') then
    raise exception 'a status is new, seen, triaged or closed';
  end if;
  if p_kind is not null and p_kind not in ('wrong', 'rude', 'unsafe', 'other') then
    raise exception 'a kind is wrong, rude, unsafe or other';
  end if;
  if p_school is not null and lower(btrim(p_school)) <> 'direct' then
    org := admin.school_org(p_school);
  end if;
  select coalesce(jsonb_agg(x.row order by x.ord1, x.ord2 asc nulls last, x.ord3 desc nulls last), '[]'::jsonb), count(*)::int
    into v_rows, n
    from (
      select jsonb_build_object(
               'id', r.id,
               'kind', r.kind,
               'status', r.status,
               'receivedAt', r.received_at,
               'ageMinutes', floor(extract(epoch from now() - r.received_at) / 60)::int,
               'seenAt', r.seen_at,
               'firstLookMinutes', floor(extract(epoch from r.seen_at - r.received_at) / 60)::int,
               'school', admin.school_ref(r.org_id),
               'lessonId', r.lesson_id,
               'platform', r.platform,
               'openCaseId', (select c.id from admin.case c where c.report_id = r.id and c.status = 'open')) as row,
             case when r.status = 'new' then 0 else 1 end as ord1,
             case when r.status = 'new' then r.received_at end as ord2,
             case when r.status <> 'new' then r.received_at end as ord3
        from public.student_report r
       where (p_status is null or r.status = p_status)
         and (p_kind is null or r.kind = p_kind)
         and (p_school is null
              or (org is not null and r.org_id = org)
              or (org is null and not exists (select 1 from lms.school s where s.org_id = r.org_id)))
       order by ord1, ord2 asc nulls last, ord3 desc nulls last
       limit lim + 1
    ) x;
  -- The extra row only tells whether there is more; it is dropped here.
  if n > lim then
    v_rows := v_rows - lim;
  end if;
  return jsonb_build_object('rows', v_rows, 'more', n > lim);
end;
$$;

-- Moves a report forward without opening its words: read, triaged, closed.
create or replace function admin.report_mark(p_report uuid, p_status text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  r public.student_report;
  rank_of constant jsonb := '{"new": 0, "seen": 1, "triaged": 2, "closed": 3}';
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  select * into r from public.student_report where id = p_report for update;
  if r.id is null then
    raise exception 'there is no such report';
  end if;
  if p_status is null or p_status not in ('seen', 'triaged', 'closed') then
    raise exception 'a report is marked read, triaged or closed';
  end if;
  if (rank_of ->> p_status)::int <= (rank_of ->> r.status)::int then
    raise exception 'a report only moves forward: unread, read, triaged, closed';
  end if;
  if exists (select 1 from admin.case c where c.report_id = r.id and c.status = 'open') then
    raise exception 'this report has an open case; close the case instead';
  end if;
  perform set_config('admin.session', 'on', true);
  update public.student_report
     set status = p_status,
         seen_at = coalesce(seen_at, now()),
         actioned_at = case when p_status in ('triaged', 'closed') then coalesce(actioned_at, now()) else actioned_at end,
         closed_at = case when p_status = 'closed' then now() else closed_at end
   where id = r.id;
  perform admin.audit(me, 'report-marked', 'report', r.id::text, p_reason,
    jsonb_build_object('reportId', r.id, 'from', r.status, 'to', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Cases.
-- ---------------------------------------------------------------------------
create or replace function admin.case_open(p_report uuid, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  r public.student_report;
  new_id uuid;
  sc text;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  select * into r from public.student_report where id = p_report for update;
  if r.id is null then
    raise exception 'there is no such report';
  end if;
  if r.status = 'closed' then
    raise exception 'this report is closed';
  end if;
  if exists (select 1 from admin.case c where c.report_id = r.id and c.status = 'open') then
    raise exception 'this report already has an open case';
  end if;
  if exists (select 1 from admin.case c where c.opened_by = me.user_id and c.status = 'open') then
    raise exception 'close your open case first: one report at a time';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.case (report_id, org_id, opened_by, reason)
  values (r.id, r.org_id, me.user_id, btrim(p_reason))
  returning id into new_id;
  update public.student_report
     set seen_at = coalesce(seen_at, now()),
         actioned_at = coalesce(actioned_at, now()),
         status = case when status in ('new', 'seen') then 'triaged' else status end
   where id = r.id;
  select s.code into sc from lms.school s where s.org_id = r.org_id;
  perform admin.audit(me, 'case-opened', 'case', new_id::text, p_reason,
    jsonb_build_object('reportId', r.id, 'kind', r.kind, 'school', sc));
  return jsonb_build_object('caseId', new_id);
end;
$$;

-- THE ONLY FUNCTION THAT RETURNS A CHILD'S WORDS (the note and the tutor's
-- line beside it). One report, inside an open case, for the person who
-- opened it, within the day's quota, logged before it is returned.
create or replace function admin.case_report(p_case uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  reads_per_day constant integer := 30;
  c admin.case;
  r public.student_report;
begin
  select * into c from admin.case x where x.id = p_case;
  if c.id is null then
    raise exception 'there is no such case';
  end if;
  if c.status <> 'open' then
    raise exception 'this case is closed';
  end if;
  if c.opened_by <> me.user_id then
    raise exception 'only the person who opened this case can read it';
  end if;
  if admin.reads_today(me.user_id) >= reads_per_day then
    raise exception 'you have opened 30 records today, the most in one day';
  end if;
  select * into r from public.student_report x where x.id = c.report_id;
  if r.id is null then
    raise exception 'this report no longer exists';
  end if;
  insert into admin.read_log (staff, staff_role, case_id, report_id, what, reason)
  values (me.user_id, me.role, c.id, r.id, 'report', c.reason);
  return jsonb_build_object(
    'caseId', c.id,
    'report', jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'status', r.status, 'note', r.note,
      'lessonId', r.lesson_id, 'topicRef', r.topic_ref, 'beatId', r.beat_id, 'spokenLine', r.spoken_line,
      'platform', r.platform, 'release', r.release, 'at', r.at, 'receivedAt', r.received_at,
      'school', admin.school_ref(r.org_id)),
    'readsLeftToday', reads_per_day - admin.reads_today(me.user_id));
end;
$$;

-- The report's context: its class, its sitting's times, and counts. Nothing
-- else about the child (ruling R11). A read, with its own reason, logged.
create or replace function admin.case_context(p_case uuid, p_reason text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  reads_per_day constant integer := 30;
  c admin.case;
  r public.student_report;
  cls jsonb;
  sit jsonb;
  same record;
begin
  perform admin.require_reason(p_reason);
  select * into c from admin.case x where x.id = p_case;
  if c.id is null then
    raise exception 'there is no such case';
  end if;
  if c.status <> 'open' then
    raise exception 'this case is closed';
  end if;
  if c.opened_by <> me.user_id then
    raise exception 'only the person who opened this case can read it';
  end if;
  if admin.reads_today(me.user_id) >= reads_per_day then
    raise exception 'you have opened 30 records today, the most in one day';
  end if;
  select * into r from public.student_report x where x.id = c.report_id;
  if r.id is null then
    raise exception 'this report no longer exists';
  end if;
  insert into admin.read_log (staff, staff_role, case_id, report_id, what, reason)
  values (me.user_id, me.role, c.id, r.id, 'context', btrim(p_reason));
  select jsonb_build_object('id', p.id, 'title', p.title, 'status', p.review_status, 'version', p.version)
    into cls
    from public.prepared_class p
   where p.id = r.lesson_id or (r.topic_ref is not null and p.topic_ref = r.topic_ref)
   order by (p.id = r.lesson_id) desc
   limit 1;
  select jsonb_build_object('source', s.source, 'startedAt', s.started_at, 'endedAt', s.ended_at,
                            'activeMinutes', floor(s.active_ms / 60000.0)::int)
    into sit
    from public.learning_session s
   where r.session_id is not null and s.id = r.session_id;
  select count(*)::int as reports, count(*) filter (where x.kind = 'unsafe')::int as unsafe
    into same from public.student_report x where x.lesson_id = r.lesson_id;
  return jsonb_build_object(
    'caseId', c.id,
    'class', cls,
    'sitting', sit,
    'sameLesson', jsonb_build_object('reports', same.reports, 'unsafe', same.unsafe),
    'readsLeftToday', reads_per_day - admin.reads_today(me.user_id));
end;
$$;

create or replace function admin.case_close(p_case uuid, p_outcome text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  c admin.case;
  told text;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  select * into c from admin.case x where x.id = p_case for update;
  if c.id is null then
    raise exception 'there is no such case';
  end if;
  if c.status <> 'open' then
    raise exception 'this case is closed';
  end if;
  if c.opened_by <> me.user_id and me.role <> 'owner' then
    raise exception 'only the person who opened this case, or the owner, can close it';
  end if;
  if p_outcome is null or p_outcome not in ('no-action', 'content-fixed', 'disclosed', 'referred', 'other') then
    raise exception 'an outcome is no-action, content-fixed, disclosed, referred or other';
  end if;
  if p_outcome = 'disclosed' then
    if c.org_id is null or not exists (select 1 from lms.school s where s.org_id = c.org_id) then
      raise exception 'this child came on their own; who is told about them is not decided yet';
    end if;
    select p.recipient into told from admin.school_privacy p where p.org_id = c.org_id;
    if coalesce(told, 'undecided') = 'undecided' then
      raise exception 'who is told at this school is not decided yet; the owner records it on the Privacy page';
    end if;
  end if;
  perform set_config('admin.session', 'on', true);
  update admin.case
     set status = 'closed', outcome = p_outcome, closed_by = me.user_id, closed_at = now(),
         close_reason = left(btrim(p_reason), 500)
   where id = c.id;
  update public.student_report
     set status = 'closed', closed_at = now(),
         seen_at = coalesce(seen_at, now()), actioned_at = coalesce(actioned_at, now())
   where id = c.report_id;
  perform admin.audit(me, 'case-closed', 'case', c.id::text, p_reason,
    jsonb_build_object('caseId', c.id, 'reportId', c.report_id, 'outcome', p_outcome));
end;
$$;

-- Cases, newest first, at most 500. No reasons here: they are on the case page.
create or replace function admin.cases(p_open_only boolean default true)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
begin
  return coalesce((
    select jsonb_agg(x.row order by x.opened_at desc)
      from (
        select c.opened_at,
               jsonb_build_object(
                 'id', c.id, 'reportId', c.report_id, 'kind', r.kind, 'school', admin.school_ref(c.org_id),
                 'openedByName', coalesce(o.display_name, ''), 'openedAt', c.opened_at, 'status', c.status,
                 'outcome', c.outcome, 'closedAt', c.closed_at) as row
          from admin.case c
          left join public.student_report r on r.id = c.report_id
          left join admin.platform_staff o on o.user_id = c.opened_by
         where not coalesce(p_open_only, true) or c.status = 'open'
         order by c.opened_at desc
         limit 500
      ) x), '[]'::jsonb);
end;
$$;

-- One case: its reasons, who opened and closed it, its report's kind and
-- status (never the note), and every read of it.
create or replace function admin.case_detail(p_case uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  out jsonb;
begin
  select jsonb_build_object(
           'id', c.id, 'reportId', c.report_id, 'kind', r.kind, 'school', admin.school_ref(c.org_id),
           'openedByName', coalesce(o.display_name, ''), 'openedAt', c.opened_at, 'status', c.status,
           'outcome', c.outcome, 'closedAt', c.closed_at, 'reason', c.reason, 'closeReason', c.close_reason,
           'closedByName', cb.display_name, 'reportStatus', r.status, 'receivedAt', r.received_at,
           'reads', coalesce((
             select jsonb_agg(jsonb_build_object('at', l.at, 'staffName', coalesce(s.display_name, ''),
                                                 'what', l.what, 'reason', l.reason) order by l.id)
               from admin.read_log l
               left join admin.platform_staff s on s.user_id = l.staff
              where l.case_id = c.id), '[]'::jsonb))
    into out
    from admin.case c
    left join public.student_report r on r.id = c.report_id
    left join admin.platform_staff o on o.user_id = c.opened_by
    left join admin.platform_staff cb on cb.user_id = c.closed_by
   where c.id = p_case;
  if out is null then
    raise exception 'there is no such case';
  end if;
  return out;
end;
$$;

-- Every read, newest first: the owner's view of who opened what and why.
create or replace function admin.read_log_list(p_limit integer default 200)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  lim integer := greatest(1, least(coalesce(p_limit, 200), 1000));
begin
  return coalesce((
    select jsonb_agg(x.row order by x.id desc)
      from (
        select l.id,
               jsonb_build_object('at', l.at, 'staffName', coalesce(s.display_name, ''), 'staffRole', l.staff_role,
                                  'caseId', l.case_id, 'reportId', l.report_id, 'what', l.what, 'reason', l.reason) as row
          from admin.read_log l
          left join admin.platform_staff s on s.user_id = l.staff
         order by l.id desc
         limit lim
      ) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
revoke all on function admin.safety_overview() from public, anon;
revoke all on function admin.safety_reports(text, text, text, integer) from public, anon;
revoke all on function admin.report_mark(uuid, text, text, text) from public, anon;
revoke all on function admin.case_open(uuid, text, text) from public, anon;
revoke all on function admin.case_report(uuid) from public, anon;
revoke all on function admin.case_context(uuid, text) from public, anon;
revoke all on function admin.case_close(uuid, text, text, text) from public, anon;
revoke all on function admin.cases(boolean) from public, anon;
revoke all on function admin.case_detail(uuid) from public, anon;
revoke all on function admin.read_log_list(integer) from public, anon;

grant execute on function admin.safety_overview() to authenticated;
grant execute on function admin.safety_reports(text, text, text, integer) to authenticated;
grant execute on function admin.report_mark(uuid, text, text, text) to authenticated;
grant execute on function admin.case_open(uuid, text, text) to authenticated;
grant execute on function admin.case_report(uuid) to authenticated;
grant execute on function admin.case_context(uuid, text) to authenticated;
grant execute on function admin.case_close(uuid, text, text, text) to authenticated;
grant execute on function admin.cases(boolean) to authenticated;
grant execute on function admin.case_detail(uuid) to authenticated;
grant execute on function admin.read_log_list(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. A student's report from the student app (Task 7 of plan 5).
--
-- The Help sheet in apps/student files into the same queue as the tutor's
-- report button, through keep_student_report: the place in the app travels in
-- lesson_id as 'student-app/<place>', the homework's id in beat_id. A retry
-- with the same `at` is the same report (0019's key), and is answered before
-- the daily cap, so a retry of the tenth report is not refused as an eleventh.
-- Students only, who have not left; a note of at most 500 characters (scrubbed
-- on the phone); at most 10 a day (ruling R25).
-- ---------------------------------------------------------------------------
create or replace function lms.report_problem(
  p_kind text, p_note text, p_where text, p_item uuid, p_platform text, p_release text, p_at timestamptz
)
returns uuid
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  me lms.account;
  lesson text;
  stamp timestamptz := coalesce(p_at, now());
  kept uuid;
  sent_today integer;
begin
  select a.* into me from lms.account a
   where a.user_id = auth.uid() and a.left_at is null and a.kind = 'student';
  if me.user_id is null then
    raise exception 'only a student can send a report from here';
  end if;
  if p_kind is null or p_kind not in ('wrong', 'rude', 'unsafe', 'other') then
    raise exception 'a report is wrong, rude, unsafe or other';
  end if;
  if p_where is null or p_where not in ('home', 'work', 'homework', 'learn', 'practice', 'progress', 'notices') then
    raise exception 'say where in the app this happened';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'a report is at most 500 characters';
  end if;
  if p_platform is null or p_platform not in ('web', 'android') then
    raise exception 'say whether this is the web app or the Android app';
  end if;
  lesson := 'student-app/' || p_where;
  select r.id into kept from public.student_report r
   where r.user_id = me.user_id and r.lesson_id = lesson
     and coalesce(r.beat_id, '') = coalesce(p_item::text, '') and r.at = stamp;
  if kept is not null then
    return kept;
  end if;
  select count(*)::int into sent_today from public.student_report r
   where r.user_id = me.user_id and r.lesson_id like 'student-app/%'
     and r.received_at >= (lms.india_today()::timestamp at time zone 'Asia/Kolkata');
  if sent_today >= 10 then
    raise exception 'You have sent 10 reports today. Please tell a teacher, or call Childline on 1098 if you need help now.';
  end if;
  select k.report_id into kept
    from public.keep_student_report(me.user_id, p_kind, coalesce(p_note, ''), lesson, null, p_item::text, null, null,
                                    nullif(left(btrim(coalesce(p_release, '')), 100), ''), p_platform, stamp) k;
  return kept;
end;
$$;
revoke all on function lms.report_problem(text, text, text, uuid, text, text, timestamptz) from public, anon;
grant execute on function lms.report_problem(text, text, text, uuid, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The health card's grey safety sentence (0052) said the tutor is where the
-- report button is. The student app has one now, so the sentence changes; the
-- signal itself (grey while nobody at the school has used the tutor) does not.
-- create or replace with the same signature keeps the function's grants.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
  body text;
  seen integer := 0;
  old_line constant text := 'Nobody at this school has used the tutor, where the report button is.';
  new_line constant text := 'No unread reports, and nobody at this school has used the tutor yet.';
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'admin' and p.proname = 'school_health_for' loop
    seen := seen + 1;
    body := pg_get_functiondef(f.oid);
    if position(old_line in body) > 0 then
      execute replace(body, old_line, new_line);
    elsif position(new_line in body) = 0 then
      raise exception 'admin.school_health_for no longer says what 0067 expects: change its grey safety sentence by hand';
    end if;
  end loop;
  if seen = 0 then
    raise exception 'admin.school_health_for does not exist';
  end if;
end
$$;
