-- ANALYTICS, THE SCHOOL PORTAL, AND LEARN — after the founder's review.
--
-- 1. A STUDENT'S REPORT (card, subjects, timeline, chapters, mistakes) for
--    the student, their teachers — only the subjects each teaches them —
--    and the school's admin. A test's score stays hidden from the student
--    until it is released, here as everywhere (0029).
-- 2. THE SCHOOL PORTAL: the school's numbers, classes, students and
--    teachers, and its colour — for the admin only.
-- 3. A CLASS'S TREND, work by work, for its teacher (the teacher's graphs).
-- 4. LEARN: chapter-wise practice. Only questions the school has approved
--    (0023's rule: nothing unreviewed reaches a child), and never one that
--    is on open or upcoming work of the child's class — practice shows the
--    answer at once. Every answer goes to the ledger as 'practice', rung 0,
--    so the brain learns from it (0027).
--
-- Written against packages/lms-client/tests/analytics.test.ts, first.

-- ---------------------------------------------------------------------------
-- The facts every report is built from: one row per published piece of work
-- and student in its class. Internal — reached only through the checked
-- functions below.
-- ---------------------------------------------------------------------------

create or replace function lms.work_facts(p_org uuid)
returns table (
  assignment_id uuid, section_id uuid, subject_id uuid, kind text, title text, due_at timestamptz,
  student_user_id uuid, handed_in boolean, late boolean, absent boolean, score float8, released boolean
)
language sql stable security definer
set search_path = public, lms
as $$
  select a.id, a.section_id, a.subject_id, a.kind, a.title, a.due_at, e.student_user_id,
         exists (select 1 from lms.submission s where s.assignment_id = a.id and s.student_user_id = e.student_user_id)
           or (
             exists (select 1 from lms.assignment_task t where t.assignment_id = a.id)
             and not exists (
               select 1 from lms.assignment_task t
                where t.assignment_id = a.id
                  and not exists (select 1 from lms.task_done d where d.task_id = t.id and d.student_user_id = e.student_user_id)
             )
           ),
         exists (select 1 from lms.submission s
                  where s.assignment_id = a.id and s.student_user_id = e.student_user_id and s.late),
         exists (select 1 from lms.work_status w
                  where w.assignment_id = a.id and w.student_user_id = e.student_user_id and w.status = 'absent'),
         -- The teacher's latest mark where given, else the latest MCQ try.
         coalesce(
           (select (m.teacher_score / nullif(m.teacher_max, 0))::float8
              from lms.submission s join lms.mark m on m.submission_id = s.id
             where s.assignment_id = a.id and s.student_user_id = e.student_user_id and m.teacher_score is not null
             order by m.marked_at desc nulls last limit 1),
           (select (m.machine_correct::float8 / nullif(m.machine_total, 0))
              from lms.submission s join lms.mark m on m.submission_id = s.id
             where s.assignment_id = a.id and s.student_user_id = e.student_user_id and s.kind = 'mcq'
             order by s.attempt desc limit 1)
         ),
         a.kind <> 'test' or a.results_released_at is not null
    from lms.assignment a
    join lms.enrolment e on e.section_id = a.section_id and e.left_on is null
   where a.org_id = p_org and a.published_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- 1. A student's report.
-- ---------------------------------------------------------------------------

-- Who may see this student at all: themselves, the school's admin, or a
-- teacher who teaches them something.
create or replace function lms.may_see_student(p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select p_student = auth.uid()
      or exists (select 1 from lms.account a where a.user_id = p_student and lms.is_admin(a.org_id))
      or lms.teaches_student(p_student);
$$;

-- Whether the caller may see this student's work in this subject: the
-- student, the admin, or a teacher of that subject to them.
create or replace function lms.may_see_subject(p_student uuid, p_subject uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select p_student = auth.uid()
      or exists (select 1 from lms.account a where a.user_id = p_student and lms.is_admin(a.org_id))
      or lms.i_teach(p_student, p_subject);
$$;

create or replace function lms.student_card(p_student uuid)
returns table (
  user_id uuid, display_name text, login_id text, roll_number text, section_id uuid,
  grade smallint, class_name text, school_name text
)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  return query
    select a.user_id, a.display_name, a.login_id, e.roll_number, sec.id, sec.grade, sec.grade || sec.name, s.display_name
      from lms.account a
      join lms.school s on s.org_id = a.org_id
      left join lms.enrolment e on e.student_user_id = a.user_id and e.left_on is null
      left join lms.section sec on sec.id = e.section_id
     where a.user_id = p_student
     limit 1;
end;
$$;

-- Per subject of the student's class: work due so far, handed in, average,
-- and the brain's belief over the chapters answered. Scores of unreleased
-- tests are left out for the student themselves.
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
      select * from lms.work_facts(org) wf where wf.student_user_id = p_student and wf.due_at <= now() and not wf.absent
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

-- Every published piece of work of the student's, newest due first.
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
      from lms.work_facts(org) f
      join lms.subject sub on sub.id = f.subject_id
     where f.student_user_id = p_student and lms.may_see_subject(p_student, f.subject_id)
     order by f.due_at desc;
end;
$$;

-- The brain's belief, per chapter the student has answered questions on,
-- in the subjects the caller may see.
create or replace function lms.student_chapters(p_student uuid)
returns table (subject text, chapter text, outcomes_seen integer, answers integer, mastery float8)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  sec lms.section;
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  select s.* into sec from lms.enrolment e join lms.section s on s.id = e.section_id
   where e.student_user_id = p_student and e.left_on is null limit 1;
  return query
    select o.subject, o.chapter, count(*)::int, sum(cs.answer_observations)::int, avg(cs.mastery)::float8
      from public.concept_state cs
      join lms.outcome o on o.id = cs.outcome_id
     where cs.user_id = p_student and cs.answer_observations > 0 and o.grade = sec.grade
       and exists (
         select 1 from lms.teaching_assignment ta join lms.subject sub on sub.id = ta.subject_id
          where ta.section_id = sec.id and coalesce(sub.syllabus_subject, sub.name) = o.subject
            and lms.may_see_subject(p_student, sub.id)
       )
     group by o.subject, o.chapter
     order by o.subject, min(o.position);
end;
$$;

-- The mistakes the student's own wrong answers point to, most repeated first.
create or replace function lms.student_misconceptions(p_student uuid)
returns table (subject text, chapter text, label text, times integer)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  return query
    select i.subject, (select o.chapter from lms.outcome o where o.id = any (i.outcome_ids) limit 1),
           nullif(btrim(i.misconceptions ->> sa.chosen_index::int), ''), count(*)::int
      from lms.submission s
      join lms.assignment a on a.id = s.assignment_id
      join lms.submission_answer sa on sa.submission_id = s.id and not sa.correct and sa.chosen_index is not null
      join lms.item i on i.id = sa.item_id
     where s.student_user_id = p_student and s.kind = 'mcq'
       and (a.kind <> 'test' or a.results_released_at is not null or p_student <> auth.uid())
       and lms.may_see_subject(p_student, a.subject_id)
       and nullif(btrim(i.misconceptions ->> sa.chosen_index::int), '') is not null
     group by i.subject, 2, 3
     order by count(*) desc, 3
     limit 20;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The school portal: the admin's view of everything.
-- ---------------------------------------------------------------------------

create or replace function lms.require_admin()
returns uuid
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := public.current_org_id();
begin
  if org is null or not lms.is_admin(org) then
    raise exception 'only the school admin can see this';
  end if;
  return org;
end;
$$;

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
           (select count(*)::int from lms.account a where a.org_id = org and a.kind = 'student'),
           (select count(*)::int from lms.account a where a.org_id = org and a.kind = 'teacher'),
           (select count(*)::int from lms.section sec where sec.org_id = org),
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
  students integer, work_set integer, handin_rate float8, average_score float8, mastery float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    with f as (select * from lms.work_facts(org) wf where wf.due_at <= now() and not wf.absent)
    select sec.id, sub.id, sec.grade || sec.name, sec.grade, sub.name, acc.display_name,
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
     where ta.org_id = org
     order by sec.grade, sec.name, sub.name;
end;
$$;

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
begin
  return query
    with f as (select * from lms.work_facts(org) wf where wf.due_at <= now() and not wf.absent)
    select a.user_id, a.display_name, a.login_id, sec.id, sec.grade || sec.name, e.roll_number,
           (select count(*)::int from f where f.student_user_id = a.user_id),
           (select (count(*) filter (where f.handed_in))::float8 / nullif(count(*), 0) from f where f.student_user_id = a.user_id),
           (select avg(f.score) from f where f.student_user_id = a.user_id),
           (select avg(cs.mastery)::float8 from public.concept_state cs
             where cs.user_id = a.user_id and cs.answer_observations > 0),
           (select max(le.at) from public.ledger_event le where le.user_id = a.user_id)
      from lms.account a
      join lms.enrolment e on e.student_user_id = a.user_id and e.left_on is null
      join lms.section sec on sec.id = e.section_id
     where a.org_id = org and a.kind = 'student' and (p_section is null or sec.id = p_section)
     order by sec.grade, sec.name,
              case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last, a.display_name;
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
           (select count(*)::int from lms.teaching_assignment ta where ta.teacher_user_id = acc.user_id),
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
     where acc.org_id = org and acc.kind in ('teacher', 'admin')
     order by acc.kind desc, acc.display_name;
end;
$$;

-- The school's colour, worn by the student app (applyBrand). Only a
-- #rrggbb colour is kept: the brand is written into a page's styles.
create or replace function lms.set_school_brand(p_brand jsonb)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  primary_colour text := p_brand ->> 'primary';
begin
  if primary_colour is not null and primary_colour !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'a colour is written #rrggbb';
  end if;
  update lms.school
     set brand = case when primary_colour is null then '{}'::jsonb
                      else jsonb_build_object('primary', lower(primary_colour)) end
   where org_id = org;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A class's trend: each published piece of work, oldest due first.
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
      from lms.work_facts(sec.org_id) f
     where f.section_id = p_section and f.subject_id = p_subject
     group by f.assignment_id, f.title, f.kind, f.due_at
     order by f.due_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Learn: chapter-wise practice.
-- ---------------------------------------------------------------------------

-- Approve every library question on a chapter for the teacher's school.
-- Invoker: 0026's approval rules apply to each row. Returns how many were new.
create or replace function lms.approve_chapter(p_grade integer, p_subject text, p_chapter text)
returns integer
language plpgsql volatile security invoker
set search_path = public, lms
as $$
declare
  n integer;
begin
  if not lms.is_staff(public.current_org_id()) then
    raise exception 'only a teacher can approve questions';
  end if;
  with fresh as (
    insert into lms.item_approval (org_id, item_id, approved_by)
    select public.current_org_id(), i.id, auth.uid()
      from lms.item i
     where i.grade = p_grade and i.subject = p_subject and i.kind = 'mcq'
       and (i.org_id is null or i.org_id = public.current_org_id())
       and exists (select 1 from lms.outcome o where o.id = any (i.outcome_ids) and o.chapter = p_chapter)
    on conflict do nothing
    returning 1
  )
  select count(*)::int into n from fresh;
  return n;
end;
$$;

-- The questions a child may practise: approved for their school, of their
-- class and a subject taught to their class, and on no open or upcoming work
-- of their class (practice shows the answer).
create or replace function lms.practice_pool(p_student uuid)
returns table (item_id uuid, subject text, chapter text)
language sql stable security definer
set search_path = public, lms
as $$
  with me as (
    select e.section_id, sec.grade, sec.org_id
      from lms.enrolment e join lms.section sec on sec.id = e.section_id
     where e.student_user_id = p_student and e.left_on is null
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
        where ai.item_id = i.id and a.section_id = me.section_id and (a.published_at is null or a.due_at > now())
     );
$$;

create or replace function lms.practice_chapters()
returns table (subject_name text, chapter text, questions integer, answers integer, mastery float8)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  me uuid := auth.uid();
  sec lms.section;
begin
  select s.* into sec from lms.enrolment e join lms.section s on s.id = e.section_id
   where e.student_user_id = me and e.left_on is null limit 1;
  if sec.id is null then
    return;
  end if;
  return query
    with pool as (select * from lms.practice_pool(me)),
    subjects as (
      select distinct coalesce(sub.syllabus_subject, sub.name) as subject
        from lms.teaching_assignment ta join lms.subject sub on sub.id = ta.subject_id
       where ta.section_id = sec.id
    ),
    chapters as (
      select o.subject, o.chapter, min(o.position) as first
        from lms.outcome o join subjects s on s.subject = o.subject
       where o.grade = sec.grade
       group by o.subject, o.chapter
    )
    select c.subject, c.chapter,
           (select count(*)::int from pool p where p.subject = c.subject and p.chapter = c.chapter),
           (select coalesce(sum(cs.answer_observations), 0)::int
              from public.concept_state cs join lms.outcome o on o.id = cs.outcome_id
             where cs.user_id = me and o.grade = sec.grade and o.subject = c.subject and o.chapter = c.chapter),
           (select avg(cs.mastery)::float8
              from public.concept_state cs join lms.outcome o on o.id = cs.outcome_id
             where cs.user_id = me and cs.answer_observations > 0
               and o.grade = sec.grade and o.subject = c.subject and o.chapter = c.chapter)
      from chapters c
     order by c.subject, c.first;
end;
$$;

-- Up to p_count practice questions on a chapter, in a random order: stem
-- and options only, as for any child (0023).
create or replace function lms.practice_questions(p_subject text, p_chapter text, p_count integer default 5)
returns table (item_id uuid, stem text, options jsonb)
language sql volatile security definer
set search_path = public, lms
as $$
  select i.id, i.stem, i.options
    from lms.practice_pool(auth.uid()) p
    join lms.item i on i.id = p.item_id
   where p.subject = p_subject and p.chapter = p_chapter
   order by random()
   limit least(greatest(coalesce(p_count, 5), 1), 20);
$$;

-- One practice answer: marked at once, the right option and the mistake
-- behind a wrong one returned, and the answer written to the ledger as
-- 'practice' in the child's own practice session.
create or replace function lms.check_practice_answer(p_session uuid, p_item uuid, p_chosen integer)
returns table (correct boolean, correct_index smallint, misconception text)
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  org uuid;
  it lms.item;
  right_answer boolean;
  n_seq integer;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select ls.user_id into owner from public.learning_session ls where ls.id = p_session;
  if owner is not null and owner <> me then
    raise exception 'this is not your practice';
  end if;
  if not exists (select 1 from lms.practice_pool(me) p where p.item_id = p_item) then
    raise exception 'that is not a practice question for you';
  end if;
  select * into it from lms.item where id = p_item;
  if p_chosen is null or p_chosen < 0 or p_chosen >= jsonb_array_length(it.options) then
    raise exception 'item % has no option %', p_item, p_chosen;
  end if;
  select sec.org_id into org from lms.enrolment e join lms.section sec on sec.id = e.section_id
   where e.student_user_id = me and e.left_on is null limit 1;
  if owner is null then
    insert into public.learning_session (id, org_id, user_id, source, started_at, ended_at)
    values (p_session, org, me, 'practice', now(), now());
  else
    update public.learning_session set ended_at = now() where id = p_session;
  end if;
  right_answer := p_chosen = it.correct_index;
  select coalesce(max(le.seq), 0) + 1 into n_seq from public.ledger_event le where le.session_id = p_session;
  insert into public.ledger_event
    (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
  values (
    gen_random_uuid(), org, me, p_session, n_seq, now(), 'answered', 'practice', 'tap', it.outcome_ids,
    jsonb_build_object('correct', right_answer, 'chosenIndex', p_chosen, 'itemId', it.id, 'assistanceRung', 0)
  );
  return query select right_answer, it.correct_index,
    case when right_answer then null else nullif(btrim(it.misconceptions ->> p_chosen), '') end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The internal pieces (work_facts, practice_pool, the may_see
-- checks, require_admin) are not for browsers.
-- ---------------------------------------------------------------------------

revoke all on function lms.work_facts(uuid) from public, anon, authenticated;
revoke all on function lms.practice_pool(uuid) from public, anon, authenticated;
revoke all on function lms.may_see_student(uuid) from public, anon, authenticated;
revoke all on function lms.may_see_subject(uuid, uuid) from public, anon, authenticated;
revoke all on function lms.require_admin() from public, anon, authenticated;
grant execute on function lms.work_facts(uuid) to service_role;
grant execute on function lms.practice_pool(uuid) to service_role;

revoke all on function lms.student_card(uuid) from public, anon;
revoke all on function lms.student_subjects(uuid) from public, anon;
revoke all on function lms.student_timeline(uuid) from public, anon;
revoke all on function lms.student_chapters(uuid) from public, anon;
revoke all on function lms.student_misconceptions(uuid) from public, anon;
revoke all on function lms.school_overview() from public, anon;
revoke all on function lms.school_classes() from public, anon;
revoke all on function lms.school_students(uuid) from public, anon;
revoke all on function lms.school_teachers() from public, anon;
revoke all on function lms.set_school_brand(jsonb) from public, anon;
revoke all on function lms.class_trend(uuid, uuid) from public, anon;
revoke all on function lms.approve_chapter(integer, text, text) from public, anon;
revoke all on function lms.practice_chapters() from public, anon;
revoke all on function lms.practice_questions(text, text, integer) from public, anon;
revoke all on function lms.check_practice_answer(uuid, uuid, integer) from public, anon;

grant execute on function lms.student_card(uuid) to authenticated, service_role;
grant execute on function lms.student_subjects(uuid) to authenticated, service_role;
grant execute on function lms.student_timeline(uuid) to authenticated, service_role;
grant execute on function lms.student_chapters(uuid) to authenticated, service_role;
grant execute on function lms.student_misconceptions(uuid) to authenticated, service_role;
grant execute on function lms.school_overview() to authenticated, service_role;
grant execute on function lms.school_classes() to authenticated, service_role;
grant execute on function lms.school_students(uuid) to authenticated, service_role;
grant execute on function lms.school_teachers() to authenticated, service_role;
grant execute on function lms.set_school_brand(jsonb) to authenticated, service_role;
grant execute on function lms.class_trend(uuid, uuid) to authenticated, service_role;
grant execute on function lms.approve_chapter(integer, text, text) to authenticated, service_role;
grant execute on function lms.practice_chapters() to authenticated, service_role;
grant execute on function lms.practice_questions(text, text, integer) to authenticated, service_role;
grant execute on function lms.check_practice_answer(uuid, uuid, integer) to authenticated, service_role;
