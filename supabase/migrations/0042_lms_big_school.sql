-- READY FOR A SCHOOL OF 1,500: THE SAME ANSWERS, WORKED OUT FOR LESS.
--
-- Found by timing a school of 1,500 students, 50 sections and 60 teachers
-- (tools/lms-demo/tests/load.test.ts, LMS_LOAD=1): 0031's work_facts worked
-- out every fact of the whole school, each with its own lookups, and every
-- report then kept the few rows it wanted. A child's Home (student_subjects)
-- worked out the whole school's to show one child's.
--
-- 1. work_facts TAKES ITS SCOPE — a section, a subject, some children, a
--    window of due dates — and cuts the work and the children to it before
--    any fact is worked out. It works out the facts together (each child's
--    hand-ins, marks, ticks and absences joined once) rather than looking
--    each up row by row. Called with only the school, it is 0040's
--    work_facts: the same rows, the same rule for who the work is for.
-- 2. EVERY REPORT ASKS FOR ITS OWN SCOPE: a child's subjects and timeline
--    their own facts, a class's trend its section and subject, the school's
--    numbers the last 30 days' work, and the lists the facts due so far.
-- 3. THE SCHOOL PORTAL'S LISTS (school_students, school_classes) total the
--    facts once, per child or per class, instead of reading all of them
--    again for every row; school_classes totals its children's mastery once
--    per section, grade and subject the same way.
-- 4. A CHILD'S LIST OF WORK (my_assignments) reads only the work of the
--    classes they are in, so the checks on who may read a piece of work can
--    run on those rows alone, not on every school's.
-- 5. INDEXES for the reads that went through a whole table: a child's
--    submissions (student_misconceptions, and a child's facts), a teacher's
--    work (school_teachers) and the school's ledger by time
--    (school_overview's active children).
--
-- Nothing anyone sees changes. Every test in packages/lms-client/tests
-- written before it passes unchanged; packages/lms-client/tests/
-- big-school.test.ts pins, for a small school worked out by hand, the
-- numbers every rewritten report gave before it; and the load test (with
-- LMS_LOAD_FROM=0041) builds the big school on 0041, applies this migration
-- to the same data and compares every answer.

-- ---------------------------------------------------------------------------
-- 1. The facts, cut to a scope.
-- ---------------------------------------------------------------------------

-- One row per published piece of work and child it is set for in its class
-- (0040), within the scope given: work of p_section and of p_subject, the
-- children in p_students, work due after p_due_after and by p_due_by. A
-- null leaves that part of the scope open; an empty p_students is nobody.
-- Planned afresh for every call (plan_cache_mode): on the load test's
-- school, the one plan Postgres keeps for reuse once a few children's calls
-- have run had not finished the whole school's after ten minutes. Internal —
-- reached only through the checked functions below.
drop function if exists lms.work_facts(uuid);
create function lms.work_facts(
  p_org uuid,
  p_section uuid default null,
  p_subject uuid default null,
  p_students uuid[] default null,
  p_due_after timestamptz default null,
  p_due_by timestamptz default null
)
returns table (
  assignment_id uuid, section_id uuid, subject_id uuid, kind text, title text, due_at timestamptz,
  student_user_id uuid, handed_in boolean, late boolean, absent boolean, score float8, released boolean
)
language plpgsql stable security definer
set search_path = public, lms
set plan_cache_mode = force_custom_plan
as $$
begin
  return query
    -- The work in scope, once each: whether it names some children only,
    -- and how many tasks it has.
    with work as materialized (
      select a.id, a.section_id, a.subject_id, a.kind, a.title, a.due_at,
             a.kind <> 'test' or a.results_released_at is not null as released,
             exists (select 1 from lms.assignment_student t where t.assignment_id = a.id) as for_some,
             (select count(*) from lms.assignment_task t where t.assignment_id = a.id) as tasks
        from lms.assignment a
       where a.org_id = p_org and a.published_at is not null
         and (p_section is null or a.section_id = p_section)
         and (p_subject is null or a.subject_id = p_subject)
         and (p_due_after is null or a.due_at > p_due_after)
         and (p_due_by is null or a.due_at <= p_due_by)
         and (p_students is null or a.section_id in (
               select e.section_id from lms.enrolment e
                where e.student_user_id = any (p_students) and e.left_on is null))
    ),
    -- What was handed in for it, per child: late if any of it was; the
    -- teacher's latest mark where given, and the latest MCQ try's.
    handed as (
      select s.assignment_id, s.student_user_id,
             bool_or(s.late) as late,
             (array_agg((m.teacher_score / nullif(m.teacher_max, 0))::float8 order by m.marked_at desc nulls last)
                filter (where m.teacher_score is not null))[1] as teacher_score,
             (array_agg((m.machine_correct::float8 / nullif(m.machine_total, 0)) order by s.attempt desc)
                filter (where s.kind = 'mcq' and m.submission_id is not null))[1] as mcq_score
        from work w
        join lms.submission s on s.assignment_id = w.id
        left join lms.mark m on m.submission_id = s.id
       where p_students is null or s.student_user_id = any (p_students)
       group by s.assignment_id, s.student_user_id
    ),
    -- How many of its tasks each child ticked.
    ticked as (
      select t.assignment_id, d.student_user_id, count(*) as done
        from work w
        join lms.assignment_task t on t.assignment_id = w.id
        join lms.task_done d on d.task_id = t.id
       where w.tasks > 0 and (p_students is null or d.student_user_id = any (p_students))
       group by t.assignment_id, d.student_user_id
    )
    -- Each piece of work and child in its class it is set for (0040's
    -- rule). Handed in: anything handed in, or every task ticked.
    select w.id, w.section_id, w.subject_id, w.kind, w.title, w.due_at, e.student_user_id,
           h.assignment_id is not null or (w.tasks > 0 and coalesce(tk.done, 0) = w.tasks),
           coalesce(h.late, false),
           ws.assignment_id is not null,
           coalesce(h.teacher_score, h.mcq_score),
           w.released
      from work w
      join lms.enrolment e on e.section_id = w.section_id and e.left_on is null
      left join handed h on h.assignment_id = w.id and h.student_user_id = e.student_user_id
      left join ticked tk on tk.assignment_id = w.id and tk.student_user_id = e.student_user_id
      left join lms.work_status ws
        on ws.assignment_id = w.id and ws.student_user_id = e.student_user_id and ws.status = 'absent'
     where (p_students is null or e.student_user_id = any (p_students))
       and (not w.for_some
            or exists (select 1 from lms.assignment_student t
                        where t.assignment_id = w.id and t.student_user_id = e.student_user_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A student's report (0031's): their own facts only.
-- ---------------------------------------------------------------------------

create or replace function lms.student_subjects(p_student uuid)
returns table (
  subject_id uuid, subject_name text, teacher_name text, work_due integer, handed_in integer,
  handin_rate float8, average_score float8, mastery float8, chapters_seen integer
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid;
  sec lms.section;
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  select a.org_id into org from lms.account a where a.user_id = p_student;
  select s.* into sec from lms.enrolment e join lms.section s on s.id = e.section_id
   where e.student_user_id = p_student and e.left_on is null limit 1;
  return query
    with f as (
      select * from lms.work_facts(org, p_students => array[p_student], p_due_by => now()) wf where not wf.absent
    ),
    cs as (
      select o.subject, o.chapter, cs.mastery
        from public.concept_state cs join lms.outcome o on o.id = cs.outcome_id
       where cs.user_id = p_student and cs.answer_observations > 0 and o.grade = sec.grade
    )
    select sub.id, sub.name,
           (select acc.display_name from lms.teaching_assignment ta2 join lms.account acc on acc.user_id = ta2.teacher_user_id
             where ta2.section_id = sec.id and ta2.subject_id = sub.id limit 1),
           (select count(*)::int from f where f.subject_id = sub.id),
           (select count(*)::int from f where f.subject_id = sub.id and f.handed_in),
           (select (count(*) filter (where f.handed_in))::float8 / nullif(count(*), 0) from f where f.subject_id = sub.id),
           (select avg(f.score) from f where f.subject_id = sub.id and (f.released or p_student <> auth.uid())),
           (select avg(c.mastery)::float8 from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name)),
           (select count(distinct c.chapter)::int from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name))
      from lms.teaching_assignment ta
      join lms.subject sub on sub.id = ta.subject_id
     where ta.section_id = sec.id and lms.may_see_subject(p_student, sub.id)
     group by sub.id, sub.name, sub.syllabus_subject
     order by sub.name;
end;
$$;

create or replace function lms.student_timeline(p_student uuid)
returns table (
  assignment_id uuid, title text, kind text, subject_name text, due_at timestamptz,
  handed_in boolean, late boolean, absent boolean, score float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid;
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  select a.org_id into org from lms.account a where a.user_id = p_student;
  return query
    select f.assignment_id, f.title, f.kind, sub.name, f.due_at, f.handed_in, f.late, f.absent,
           case when f.released or p_student <> auth.uid() then f.score end
      from lms.work_facts(org, p_students => array[p_student]) f
      join lms.subject sub on sub.id = f.subject_id
     where lms.may_see_subject(p_student, f.subject_id)
     order by f.due_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A class's trend (0031's): its section and subject only.
-- ---------------------------------------------------------------------------

create or replace function lms.class_trend(p_section uuid, p_subject uuid)
returns table (
  assignment_id uuid, title text, kind text, due_at timestamptz,
  students integer, handed_in integer, late integer, average_score float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  sec lms.section;
begin
  select * into sec from lms.section where id = p_section;
  if sec.id is null or not (lms.teaches_class(p_section, p_subject) or lms.is_admin(sec.org_id)) then
    raise exception 'this is not your class';
  end if;
  return query
    select f.assignment_id, f.title, f.kind, f.due_at,
           (count(*) filter (where not f.absent))::int,
           (count(*) filter (where f.handed_in and not f.absent))::int,
           (count(*) filter (where f.late))::int,
           avg(f.score) filter (where not f.absent)
      from lms.work_facts(sec.org_id, p_section => p_section, p_subject => p_subject) f
     group by f.assignment_id, f.title, f.kind, f.due_at
     order by f.due_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The school portal (0034's), totalled once.
-- ---------------------------------------------------------------------------

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
      select * from lms.work_facts(org, p_due_after => now() - interval '30 days', p_due_by => now()) wf
       where not wf.absent
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

create or replace function lms.school_classes()
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
    with f as (
      select wf.section_id, wf.subject_id,
             (count(*) filter (where wf.handed_in))::float8 / nullif(count(*), 0) as handin_rate,
             avg(wf.score) as average_score
        from lms.work_facts(org, p_due_by => now()) wf
       where not wf.absent
       group by wf.section_id, wf.subject_id
    ),
    -- The brain's belief over the outcomes each section's children have
    -- answered, per grade and subject of the curriculum.
    ms as (
      select e.section_id, o.grade, o.subject, avg(cs.mastery)::float8 as mastery
        from lms.enrolment e
        join public.concept_state cs on cs.user_id = e.student_user_id and cs.answer_observations > 0
        join lms.outcome o on o.id = cs.outcome_id
       where e.org_id = org and e.left_on is null
       group by e.section_id, o.grade, o.subject
    )
    select sec.id, sub.id, sec.grade || sec.name, sec.grade, sub.name, acc.display_name, acc.login_id,
           (select count(*)::int from lms.enrolment e where e.section_id = sec.id and e.left_on is null),
           (select count(*)::int from lms.assignment a
             where a.section_id = sec.id and a.subject_id = sub.id and a.published_at is not null),
           f.handin_rate,
           f.average_score,
           ms.mastery
      from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
      join lms.subject sub on sub.id = ta.subject_id
      join lms.account acc on acc.user_id = ta.teacher_user_id
      left join f on f.section_id = sec.id and f.subject_id = sub.id
      left join ms on ms.section_id = sec.id and ms.grade = sec.grade
                  and ms.subject = coalesce(sub.syllabus_subject, sub.name)
     where ta.org_id = org and sec.academic_year_id = lms.current_year(org)
     order by sec.grade, sec.name, sub.name;
end;
$$;

-- A section's list totals the facts of its children only.
create or replace function lms.school_students(p_section uuid default null)
returns table (
  user_id uuid, display_name text, login_id text, section_id uuid, class_name text, roll_number text,
  work_due integer, handin_rate float8, average_score float8, mastery float8, last_active timestamptz
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  children uuid[];
begin
  if p_section is not null then
    select coalesce(array_agg(e.student_user_id), '{}') into children
      from lms.enrolment e
     where e.section_id = p_section and e.left_on is null;
  end if;
  return query
    with f as (
      select wf.student_user_id, count(*)::int as work_due,
             (count(*) filter (where wf.handed_in))::float8 / nullif(count(*), 0) as handin_rate,
             avg(wf.score) as average_score
        from lms.work_facts(org, p_students => children, p_due_by => now()) wf
       where not wf.absent
       group by wf.student_user_id
    )
    select a.user_id, a.display_name, a.login_id, sec.id, sec.grade || sec.name, e.roll_number,
           coalesce(f.work_due, 0),
           f.handin_rate,
           f.average_score,
           (select avg(cs.mastery)::float8 from public.concept_state cs
             where cs.user_id = a.user_id and cs.answer_observations > 0),
           (select max(le.at) from public.ledger_event le where le.user_id = a.user_id)
      from lms.account a
      join lms.enrolment e on e.student_user_id = a.user_id and e.left_on is null
      join lms.section sec on sec.id = e.section_id
      left join f on f.student_user_id = a.user_id
     where a.org_id = org and a.kind = 'student' and (p_section is null or sec.id = p_section)
     order by sec.grade, sec.name,
              case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last, a.display_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A child's list of work (0030's): the work of their own classes.
-- ---------------------------------------------------------------------------

create or replace function lms.my_assignments()
returns table (
  id uuid, kind text, title text, instructions text, due_at timestamptz, published_at timestamptz,
  subject_id uuid, subject_name text, answer_types text[], attempts_allowed smallint, questions integer,
  mcq_attempts_used integer, best_correct integer, best_total integer,
  photo_submitted boolean, teacher_score float8, teacher_max float8, marked_at timestamptz,
  opens_at timestamptz, time_limit_minutes smallint, max_marks float8, results_released boolean,
  tasks_total integer, tasks_done integer, started_at timestamptz, ends_at timestamptz,
  teacher_status text
)
language sql stable security invoker
set search_path = public, lms
as $$
  select a.id, a.kind, a.title, a.instructions, a.due_at, a.published_at,
         sub.id, sub.name, a.answer_types, a.attempts_allowed,
         lms.question_count(a.id),
         (select count(*)::int from lms.submission s
           where s.assignment_id = a.id and s.student_user_id = auth.uid() and s.kind = 'mcq'),
         case when released.yes then best.machine_correct::int end,
         case when released.yes then best.machine_total::int end,
         exists (select 1 from lms.submission s
                  where s.assignment_id = a.id and s.student_user_id = auth.uid() and s.kind = 'photo'),
         case when released.yes then tm.teacher_score::float8 end,
         case when released.yes then tm.teacher_max::float8 end,
         case when released.yes then tm.marked_at end,
         a.opens_at, a.time_limit_minutes, a.max_marks::float8, released.yes,
         (select count(*)::int from lms.assignment_task t where t.assignment_id = a.id),
         (select count(*)::int from lms.assignment_task t
            join lms.task_done d on d.task_id = t.id and d.student_user_id = auth.uid()
           where t.assignment_id = a.id),
         ts.started_at,
         case when ts.started_at is not null then lms.test_ends_at(a, ts.started_at) end,
         ws.status
    from lms.assignment a
    join lms.subject sub on sub.id = a.subject_id
    cross join lateral (select a.kind <> 'test' or a.results_released_at is not null as yes) released
    left join lms.test_start ts on ts.assignment_id = a.id and ts.student_user_id = auth.uid()
    left join lms.work_status ws on ws.assignment_id = a.id and ws.student_user_id = auth.uid()
    left join lateral (
      select m.machine_correct, m.machine_total
        from lms.submission s join lms.mark m on m.submission_id = s.id
       where s.assignment_id = a.id and s.student_user_id = auth.uid() and s.kind = 'mcq'
       order by m.machine_correct desc, s.attempt desc limit 1
    ) best on true
    left join lateral (
      select m.teacher_score, m.teacher_max, m.marked_at
        from lms.submission s join lms.mark m on m.submission_id = s.id
       where s.assignment_id = a.id and s.student_user_id = auth.uid() and m.marked_at is not null
       order by m.marked_at desc limit 1
    ) tm on true
   where a.published_at is not null
     and a.section_id in (select e.section_id from lms.enrolment e
                           where e.student_user_id = auth.uid() and e.left_on is null)
     and lms.in_section(a.section_id)
   order by a.due_at, a.title;
$$;

-- ---------------------------------------------------------------------------
-- 6. Indexes.
-- ---------------------------------------------------------------------------

create index if not exists submission_student on lms.submission (student_user_id);
create index if not exists assignment_created_by on lms.assignment (created_by);
create index if not exists ledger_event_org_at on public.ledger_event (org_id, at);

-- ---------------------------------------------------------------------------
-- Grants. work_facts stays internal (0031).
-- ---------------------------------------------------------------------------

revoke all on function lms.work_facts(uuid, uuid, uuid, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function lms.student_subjects(uuid) from public, anon;
revoke all on function lms.student_timeline(uuid) from public, anon;
revoke all on function lms.class_trend(uuid, uuid) from public, anon;
revoke all on function lms.school_overview() from public, anon;
revoke all on function lms.school_classes() from public, anon;
revoke all on function lms.school_students(uuid) from public, anon;
revoke all on function lms.my_assignments() from public, anon;

grant execute on function lms.work_facts(uuid, uuid, uuid, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function lms.student_subjects(uuid) to authenticated, service_role;
grant execute on function lms.student_timeline(uuid) to authenticated, service_role;
grant execute on function lms.class_trend(uuid, uuid) to authenticated, service_role;
grant execute on function lms.school_overview() to authenticated, service_role;
grant execute on function lms.school_classes() to authenticated, service_role;
grant execute on function lms.school_students(uuid) to authenticated, service_role;
grant execute on function lms.my_assignments() to authenticated, service_role;
