-- WHO STOPS SEEING WHAT, AND A LOG OF WHO CHANGED IT.
--
-- Found by the professional-readiness review (A5, A6, B6, B7):
--
-- 1. LEAVERS. The admin marks a student or a teacher as left. A student's
--    enrolment closes, so no teacher sees them; a teacher's classes are taken
--    away; and either one's membership of the school goes, so every check
--    built on it (current_org_id, is_staff, is_admin) fails closed. The
--    account and its records stay for the admin. restore_account undoes it
--    (a teacher's classes are given back one by one with set_teaching).
-- 2. CLASSES MOVE between teachers through set_teaching, the admin's only.
-- 3. LAST YEAR. A teacher sees only children in their classes of the
--    school's current year (current_year: the one today falls in, else the
--    latest), so last year's classes give nothing this year.
-- 4. EVIDENCE. Homework, test and practice answers reach the ledger only
--    through the school's own functions (submit_mcq, finalize_tests,
--    check_practice_answer): a phone may no longer insert its own sessions
--    or events with those sources. The tutor's own sources are unchanged.
-- 5. THE GRADING JOB (finalize_tests, every school's tests) is the cron's
--    and the server's, not a signed-in browser's.
-- 6. PRACTICE never offers a question that is on any test of the class, even
--    a finished one: practice shows the answer.
-- 7. THE ACTIVITY LOG: every leaving, restoring and moving of a class, and
--    every change of photo, logo or colours, with who did it and when.
--
-- Written against packages/lms-client/tests/safety.test.ts and
-- supabase/tests/lms-invariants.test.ts, first.

alter table lms.account add column if not exists left_at timestamptz;

-- ---------------------------------------------------------------------------
-- The log.
-- ---------------------------------------------------------------------------

create table if not exists lms.audit_event (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  actor uuid references auth.users on delete set null,
  action text not null check (char_length(action) between 1 and 40),
  target text not null default '' check (char_length(target) <= 200),
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default clock_timestamp()
);
create index if not exists audit_event_school_time on lms.audit_event (org_id, at desc);

revoke all on lms.audit_event from public, anon, authenticated;
grant all on lms.audit_event to service_role;
alter table lms.audit_event enable row level security;

create or replace function lms.audit(p_org uuid, p_action text, p_target text, p_details jsonb default '{}'::jsonb)
returns void
language sql volatile security definer
set search_path = public, lms
as $$
  insert into lms.audit_event (org_id, actor, action, target, details)
  values (p_org, auth.uid(), p_action, left(coalesce(p_target, ''), 200), coalesce(p_details, '{}'::jsonb));
$$;

create or replace function lms.audit_log(p_limit integer default 100)
returns table (at timestamptz, actor_name text, action text, target text, details jsonb)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select e.at, a.display_name, e.action, e.target, e.details
      from lms.audit_event e
      left join lms.account a on a.user_id = e.actor
     where e.org_id = org
     order by e.at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- Photos, the logo and the colours are logged as they change, whoever's
-- function changed them.
create or replace function lms.log_photo()
returns trigger
language plpgsql security definer
set search_path = public, lms
as $$
declare
  row_ lms.account_photo := coalesce(new, old);
begin
  perform lms.audit(
    row_.org_id,
    case when tg_op = 'DELETE' then 'photo-removed' else 'photo-set' end,
    (select login_id from lms.account where user_id = row_.user_id)
  );
  return null;
end;
$$;
drop trigger if exists log_photo on lms.account_photo;
create trigger log_photo after insert or update or delete on lms.account_photo
  for each row execute function lms.log_photo();

create or replace function lms.log_logo()
returns trigger
language plpgsql security definer
set search_path = public, lms
as $$
begin
  perform lms.audit(coalesce(new.org_id, old.org_id), case when tg_op = 'DELETE' then 'logo-removed' else 'logo-set' end, '');
  return null;
end;
$$;
drop trigger if exists log_logo on lms.school_logo;
create trigger log_logo after insert or update or delete on lms.school_logo
  for each row execute function lms.log_logo();

create or replace function lms.log_brand()
returns trigger
language plpgsql security definer
set search_path = public, lms
as $$
begin
  if new.brand is distinct from old.brand then
    perform lms.audit(new.org_id, 'colours-set', '', jsonb_build_object('brand', new.brand));
  end if;
  return null;
end;
$$;
drop trigger if exists log_brand on lms.school;
create trigger log_brand after update on lms.school
  for each row execute function lms.log_brand();

-- ---------------------------------------------------------------------------
-- 3. This year.
-- ---------------------------------------------------------------------------

create or replace function lms.current_year(p_org uuid)
returns uuid
language sql stable security definer
set search_path = public, lms
as $$
  select y.id from lms.academic_year y
   where y.org_id = p_org
   order by (current_date between y.starts_on and y.ends_on) desc, y.starts_on desc
   limit 1;
$$;

create or replace function lms.teaches_section(p_section uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
     where ta.section_id = p_section and ta.teacher_user_id = auth.uid()
       and sec.academic_year_id = lms.current_year(sec.org_id)
  );
$$;

create or replace function lms.teaches_class(p_section uuid, p_subject uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
     where ta.section_id = p_section and ta.subject_id = p_subject and ta.teacher_user_id = auth.uid()
       and sec.academic_year_id = lms.current_year(sec.org_id)
  );
$$;

create or replace function lms.teaches_student(p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1
      from lms.enrolment e
      join lms.teaching_assignment ta on ta.section_id = e.section_id
      join lms.section sec on sec.id = e.section_id
     where e.student_user_id = p_student
       and e.left_on is null
       and ta.teacher_user_id = auth.uid()
       and sec.academic_year_id = lms.current_year(sec.org_id)
  );
$$;

create or replace function lms.teaches(p_teacher uuid, p_student uuid, p_subject uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1
      from lms.teaching_assignment ta
      join lms.enrolment e on e.section_id = ta.section_id
      join lms.section sec on sec.id = ta.section_id
     where ta.teacher_user_id = p_teacher
       and ta.subject_id = p_subject
       and e.student_user_id = p_student
       and e.left_on is null
       and sec.academic_year_id = lms.current_year(sec.org_id)
  );
$$;

-- This year's classes only (0026's listed every year's).
create or replace function lms.my_classes()
returns table (
  section_id uuid, grade smallint, section_name text,
  subject_id uuid, subject_name text, students integer
)
language sql stable security invoker
set search_path = public, lms
as $$
  select sec.id, sec.grade, sec.name, sub.id, sub.name,
         (select count(*)::int from lms.enrolment e
           where e.section_id = sec.id and e.left_on is null)
    from lms.teaching_assignment ta
    join lms.section sec on sec.id = ta.section_id
    join lms.subject sub on sub.id = ta.subject_id
   where ta.teacher_user_id = auth.uid()
     and lms.teaches_class(sec.id, sub.id)
   order by sec.grade, sec.name, sub.name;
$$;

-- ---------------------------------------------------------------------------
-- 1. Leavers, and 2. classes moving.
-- ---------------------------------------------------------------------------

create or replace function lms.account_in_school(p_org uuid, p_login_id text)
returns lms.account
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  found lms.account;
begin
  select * into found from lms.account
   where org_id = p_org and login_id = upper(btrim(coalesce(p_login_id, '')));
  if found.user_id is null then
    raise exception 'there is no one in your school with the ID %', coalesce(p_login_id, '(none)');
  end if;
  return found;
end;
$$;

create or replace function lms.mark_left(p_login_id text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  who lms.account := lms.account_in_school(org, p_login_id);
  classes jsonb;
begin
  if who.user_id = auth.uid() then
    raise exception 'you cannot mark yourself as left; another admin can';
  end if;
  if who.left_at is not null then
    return;
  end if;
  update lms.account set left_at = now() where user_id = who.user_id;
  delete from public.membership where org_id = org and user_id = who.user_id;
  if who.kind = 'student' then
    update lms.enrolment set left_on = current_date where student_user_id = who.user_id and left_on is null;
    perform lms.audit(org, 'left', who.login_id);
  else
    select coalesce(jsonb_agg(sec.grade || sec.name || ' ' || sub.name), '[]'::jsonb) into classes
      from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
      join lms.subject sub on sub.id = ta.subject_id
     where ta.teacher_user_id = who.user_id;
    delete from lms.teaching_assignment where teacher_user_id = who.user_id and org_id = org;
    perform lms.audit(org, 'left', who.login_id, jsonb_build_object('classes', classes));
  end if;
end;
$$;

create or replace function lms.restore_account(p_login_id text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  who lms.account := lms.account_in_school(org, p_login_id);
begin
  if who.left_at is null then
    return;
  end if;
  insert into public.membership (org_id, user_id, role) values (org, who.user_id, who.kind)
  on conflict do nothing;
  if who.kind = 'student' then
    -- Back into the class they left this year, if it is still this year's.
    update lms.enrolment e set left_on = null
      from lms.section sec
     where e.section_id = sec.id and e.student_user_id = who.user_id
       and e.left_on = who.left_at::date
       and sec.academic_year_id = lms.current_year(org);
  end if;
  update lms.account set left_at = null where user_id = who.user_id;
  perform lms.audit(org, 'restored', who.login_id);
end;
$$;

create or replace function lms.set_teaching(p_section uuid, p_subject uuid, p_teacher_login_id text, p_teaches boolean)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  who lms.account := lms.account_in_school(org, p_teacher_login_id);
  sec lms.section;
  sub lms.subject;
  label text;
begin
  if who.kind not in ('teacher', 'admin') or who.left_at is not null then
    raise exception '% is not a teacher at your school', who.login_id;
  end if;
  select * into sec from lms.section where id = p_section and org_id = org;
  select * into sub from lms.subject where id = p_subject and org_id = org;
  if sec.id is null or sub.id is null then
    raise exception 'that class is not in your school';
  end if;
  label := who.login_id || ' ' || sec.grade || sec.name || ' ' || sub.name;
  if coalesce(p_teaches, false) then
    insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id)
    values (org, sec.id, sub.id, who.user_id)
    on conflict (section_id, subject_id, teacher_user_id) do nothing;
    perform lms.audit(org, 'teaching-added', label);
  else
    delete from lms.teaching_assignment
     where section_id = sec.id and subject_id = sub.id and teacher_user_id = who.user_id;
    perform lms.audit(org, 'teaching-removed', label);
  end if;
end;
$$;

-- Everyone who has left, for the admin to find and, if it was a mistake, restore.
create or replace function lms.school_left()
returns table (user_id uuid, display_name text, login_id text, kind text, left_at timestamptz)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select a.user_id, a.display_name, a.login_id, a.kind, a.left_at
      from lms.account a
     where a.org_id = org and a.left_at is not null
     order by a.left_at desc, a.display_name;
end;
$$;

revoke all on function lms.school_left() from public, anon;
grant execute on function lms.school_left() to authenticated, service_role;

-- The school portal leaves out people who have left, and counts this year.
create or replace function lms.school_overview()
returns table (
  school_name text, students integer, teachers integer, classes integer, subjects integer,
  work_set_30d integer, handin_rate_30d float8, average_score_30d float8,
  active_students_7d integer, mastery float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    with f as (
      select * from lms.work_facts(org) wf
       where wf.due_at <= now() and wf.due_at > now() - interval '30 days' and not wf.absent
    )
    select s.display_name,
           (select count(*)::int from lms.account a where a.org_id = org and a.kind = 'student' and a.left_at is null),
           (select count(*)::int from lms.account a where a.org_id = org and a.kind = 'teacher' and a.left_at is null),
           (select count(*)::int from lms.section sec where sec.org_id = org and sec.academic_year_id = lms.current_year(org)),
           (select count(*)::int from lms.subject sub where sub.org_id = org),
           (select count(*)::int from lms.assignment a
             where a.org_id = org and a.published_at > now() - interval '30 days'),
           (select (count(*) filter (where f.handed_in))::float8 / nullif(count(*), 0) from f),
           (select avg(f.score) from f),
           (select count(distinct le.user_id)::int from public.ledger_event le
             where le.org_id = org and le.at > now() - interval '7 days'),
           (select avg(cs.mastery)::float8 from public.concept_state cs
             where cs.org_id = org and cs.answer_observations > 0)
      from lms.school s
     where s.org_id = org;
end;
$$;

-- Now with the teacher's school ID, so the portal can move the class.
drop function if exists lms.school_classes();
create function lms.school_classes()
returns table (
  section_id uuid, subject_id uuid, class_name text, grade smallint, subject_name text, teacher_name text,
  teacher_login_id text, students integer, work_set integer, handin_rate float8, average_score float8, mastery float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    with f as (select * from lms.work_facts(org) wf where wf.due_at <= now() and not wf.absent)
    select sec.id, sub.id, sec.grade || sec.name, sec.grade, sub.name, acc.display_name, acc.login_id,
           (select count(*)::int from lms.enrolment e where e.section_id = sec.id and e.left_on is null),
           (select count(*)::int from lms.assignment a
             where a.section_id = sec.id and a.subject_id = sub.id and a.published_at is not null),
           (select (count(*) filter (where f.handed_in))::float8 / nullif(count(*), 0)
              from f where f.section_id = sec.id and f.subject_id = sub.id),
           (select avg(f.score) from f where f.section_id = sec.id and f.subject_id = sub.id),
           (select avg(cs.mastery)::float8
              from lms.enrolment e
              join public.concept_state cs on cs.user_id = e.student_user_id and cs.answer_observations > 0
              join lms.outcome o on o.id = cs.outcome_id
             where e.section_id = sec.id and e.left_on is null
               and o.grade = sec.grade and o.subject = coalesce(sub.syllabus_subject, sub.name))
      from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
      join lms.subject sub on sub.id = ta.subject_id
      join lms.account acc on acc.user_id = ta.teacher_user_id
     where ta.org_id = org and sec.academic_year_id = lms.current_year(org)
     order by sec.grade, sec.name, sub.name;
end;
$$;

create or replace function lms.school_teachers()
returns table (
  user_id uuid, display_name text, login_id text, kind text, classes integer,
  work_set integer, work_set_30d integer, photos_to_mark integer, tests_to_release integer
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select acc.user_id, acc.display_name, acc.login_id, acc.kind,
           (select count(*)::int from lms.teaching_assignment ta
              join lms.section sec on sec.id = ta.section_id
             where ta.teacher_user_id = acc.user_id and sec.academic_year_id = lms.current_year(org)),
           (select count(*)::int from lms.assignment a where a.created_by = acc.user_id and a.published_at is not null),
           (select count(*)::int from lms.assignment a
             where a.created_by = acc.user_id and a.published_at > now() - interval '30 days'),
           (select count(*)::int from lms.assignment a
              join lms.submission s on s.assignment_id = a.id and s.kind = 'photo'
              join lms.mark m on m.submission_id = s.id and m.teacher_score is null
             where a.created_by = acc.user_id),
           (select count(*)::int from lms.assignment a
             where a.created_by = acc.user_id and a.kind = 'test' and a.published_at is not null
               and a.due_at <= now() and a.results_released_at is null)
      from lms.account acc
     where acc.org_id = org and acc.kind in ('teacher', 'admin') and acc.left_at is null
     order by acc.kind desc, acc.display_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Evidence the phone may write: the tutor's sources only.
-- ---------------------------------------------------------------------------

drop policy if exists "append your own sessions" on public.learning_session;
create policy "append your own sessions" on public.learning_session
  for insert with check (
    auth.uid() = user_id and public.is_member(org_id) and source not in ('homework', 'test', 'practice')
  );

drop policy if exists "append your own events" on public.ledger_event;
create policy "append your own events" on public.ledger_event
  for insert with check (
    auth.uid() = user_id and public.is_member(org_id) and source not in ('homework', 'test', 'practice')
  );

-- ---------------------------------------------------------------------------
-- 5. The grading job is not a browser's to run.
-- ---------------------------------------------------------------------------

revoke execute on function lms.finalize_tests(uuid) from authenticated;

-- A teacher releasing one test still hands in its expired attempts first
-- (0030), through this: their own test only.
create or replace function lms.finalize_my_test(p_assignment uuid)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
begin
  if p_assignment is null or not lms.can_manage_assignment(p_assignment) then
    raise exception 'this is not your class';
  end if;
  perform lms.finalize_tests(p_assignment);
end;
$$;

create or replace function lms.release_results(p_assignment uuid)
returns void
language plpgsql volatile security invoker
set search_path = public, lms
as $$
begin
  if not lms.can_manage_assignment(p_assignment) then
    raise exception 'this is not your class';
  end if;
  perform lms.finalize_my_test(p_assignment);
  update lms.assignment set results_released_at = coalesce(results_released_at, now())
   where id = p_assignment;
end;
$$;

revoke all on function lms.finalize_my_test(uuid) from public, anon;
grant execute on function lms.finalize_my_test(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Practice: approved questions of the child's class and subjects, on no
--    open or unpublished work of the class and on no test of it at all.
--    This year's class first, should an old enrolment be left open.
-- ---------------------------------------------------------------------------

create or replace function lms.practice_pool(p_student uuid)
returns table (item_id uuid, subject text, chapter text)
language sql stable security definer
set search_path = public, lms
as $$
  with me as (
    select e.section_id, sec.grade, sec.org_id
      from lms.enrolment e join lms.section sec on sec.id = e.section_id
     where e.student_user_id = p_student and e.left_on is null
     order by (sec.academic_year_id = lms.current_year(sec.org_id)) desc
     limit 1
  )
  select i.id, i.subject, (select o.chapter from lms.outcome o where o.id = any (i.outcome_ids) limit 1)
    from me
    join lms.item i on i.grade = me.grade and i.kind = 'mcq'
   where exists (select 1 from lms.item_approval ap where ap.org_id = me.org_id and ap.item_id = i.id)
     and exists (
       select 1 from lms.teaching_assignment ta join lms.subject sub on sub.id = ta.subject_id
        where ta.section_id = me.section_id and coalesce(sub.syllabus_subject, sub.name) = i.subject
     )
     and not exists (
       select 1 from lms.assignment_item ai join lms.assignment a on a.id = ai.assignment_id
        where ai.item_id = i.id and a.section_id = me.section_id
          and (a.kind = 'test' or a.published_at is null or a.due_at > now())
     );
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function lms.audit(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function lms.log_photo() from public, anon, authenticated;
revoke all on function lms.log_logo() from public, anon, authenticated;
revoke all on function lms.log_brand() from public, anon, authenticated;
revoke all on function lms.current_year(uuid) from public, anon;
revoke all on function lms.account_in_school(uuid, text) from public, anon, authenticated;
revoke all on function lms.audit_log(integer) from public, anon;
revoke all on function lms.mark_left(text) from public, anon;
revoke all on function lms.restore_account(text) from public, anon;
revoke all on function lms.set_teaching(uuid, uuid, text, boolean) from public, anon;
revoke all on function lms.my_classes() from public, anon;
revoke all on function lms.teaches_section(uuid) from public, anon;
revoke all on function lms.teaches_class(uuid, uuid) from public, anon;
revoke all on function lms.teaches_student(uuid) from public, anon;
revoke all on function lms.teaches(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function lms.school_overview() from public, anon;
revoke all on function lms.school_classes() from public, anon;
revoke all on function lms.school_teachers() from public, anon;
revoke all on function lms.practice_pool(uuid) from public, anon, authenticated;

grant execute on function lms.audit(uuid, text, text, jsonb) to service_role;
grant execute on function lms.current_year(uuid) to authenticated, service_role;
grant execute on function lms.audit_log(integer) to authenticated, service_role;
grant execute on function lms.mark_left(text) to authenticated, service_role;
grant execute on function lms.restore_account(text) to authenticated, service_role;
grant execute on function lms.set_teaching(uuid, uuid, text, boolean) to authenticated, service_role;
grant execute on function lms.my_classes() to authenticated, service_role;
grant execute on function lms.teaches_section(uuid) to authenticated, service_role;
grant execute on function lms.teaches_class(uuid, uuid) to authenticated, service_role;
grant execute on function lms.teaches_student(uuid) to authenticated, service_role;
grant execute on function lms.teaches(uuid, uuid, uuid) to service_role;
grant execute on function lms.school_overview() to authenticated, service_role;
grant execute on function lms.school_classes() to authenticated, service_role;
grant execute on function lms.school_teachers() to authenticated, service_role;
grant execute on function lms.practice_pool(uuid) to service_role;
