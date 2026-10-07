-- LIKELY MISCONCEPTIONS IN A CLASS, AND PRACTICE FOR JUST THOSE CHILDREN.
--
-- 1. WHAT A CLASS SHOWS NOW. Each wrong option of a library question was
--    written to catch one mistake (lms.item.misconceptions, 0027). A child
--    shows a mistake now when, on the latest occasion they answered a
--    question that can catch it — over their latest attempt at each piece of
--    the class's published MCQ work (its section and subject) — they chose
--    an option that carries it. Met again and answered any other way, it is
--    no longer shown. Listed by chapter and label, most children first, with
--    who they are and how many approved questions practice could be set from
--    now. Only children in the class now: someone who has left (0034), moved
--    to another section (0037) or was in last year's class appears nowhere.
--    For a teacher of the class this year, or the school's admin.
-- 2. PRACTICE FOR SOME CHILDREN. send_practice sets one-attempt MCQ homework
--    on one chapter for the children of the class it names, and publishes
--    it. Its questions are approved for the school (0023's rule), on the
--    chapter, and on no test of the class and no open or unpublished work of
--    it (0034's rule for practice): those that can catch the misconception
--    first, then those never set to the class. A teacher of the class this
--    year, or the admin for a class of this year; each send is in the
--    activity log (0034).
-- 3. WORK FOR SOME CHILDREN ONLY. lms.assignment_student names them; work it
--    names nobody for is the whole class's, as before. Only those children
--    read named work (lms.assignment's and lms.assignment_task's policies, so
--    my_assignments and upcoming_events too; its questions, tasks, question
--    count and comment) or upload photos for it, and nothing is written
--    against any other child for it: no hand-in, test start or saved answer,
--    tick, teacher's word or comment (guard_set_for). A child's own review (my_review, my_saved_answers)
--    shows only what they handed in, so needs no change. Only those children
--    are on its roster in the teacher's views (class_assignments,
--    assignment_overview, assignment_results, needs_attention) and in
--    work_facts, which every hand-in rate and report of 0031 is built from.
--    Work for the whole class counts exactly as before.
--
-- Written against packages/lms-client/tests/likely-misconceptions.test.ts,
-- first.

create table if not exists lms.assignment_student (
  assignment_id uuid not null references lms.assignment on delete cascade,
  student_user_id uuid not null references auth.users on delete cascade,
  org_id uuid not null references lms.school on delete cascade,
  primary key (assignment_id, student_user_id)
);
create index if not exists assignment_student_student on lms.assignment_student (student_user_id);

-- Written only by send_practice; read only through the functions below.
revoke all on lms.assignment_student from public, anon, authenticated;
grant all on lms.assignment_student to service_role;
alter table lms.assignment_student enable row level security;

-- ---------------------------------------------------------------------------
-- Whom a piece of work is for.
-- ---------------------------------------------------------------------------

-- Whether the work is for this child: it names nobody (the whole class), or
-- names them. Says nothing of who is asking. Internal.
create or replace function lms.set_for(p_assignment uuid, p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select not exists (select 1 from lms.assignment_student t where t.assignment_id = p_assignment)
      or exists (select 1 from lms.assignment_student t
                  where t.assignment_id = p_assignment and t.student_user_id = p_student);
$$;

-- set_for, answered only to the child themselves, the class's teacher and
-- the school's admin; to anyone else it says no. For the invoker views and
-- the policy below, which run as the caller.
create or replace function lms.is_set_for(p_assignment uuid, p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select (p_student = auth.uid()
          or lms.can_manage_assignment(p_assignment)
          or exists (select 1 from lms.assignment a where a.id = p_assignment and lms.is_admin(a.org_id)))
     and lms.set_for(p_assignment, p_student);
$$;

-- Whether the work names some children only, for the class's teacher and the
-- school's admin; to anyone else it says no.
create or replace function lms.set_for_some(p_assignment uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select (lms.can_manage_assignment(p_assignment)
          or exists (select 1 from lms.assignment a where a.id = p_assignment and lms.is_admin(a.org_id)))
     and exists (select 1 from lms.assignment_student t where t.assignment_id = p_assignment);
$$;

-- Nothing is written against a child for work that is not set for them.
create or replace function lms.guard_set_for()
returns trigger
language plpgsql security definer
set search_path = public, lms
as $$
declare
  work uuid;
begin
  if tg_table_name = 'task_done' then
    select t.assignment_id into work from lms.assignment_task t where t.id = new.task_id;
  else
    work := new.assignment_id;
  end if;
  if not lms.set_for(work, new.student_user_id) then
    raise exception 'this work was not set for that student';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_set_for on lms.submission;
create trigger guard_set_for before insert on lms.submission
  for each row execute function lms.guard_set_for();
drop trigger if exists guard_set_for on lms.test_start;
create trigger guard_set_for before insert on lms.test_start
  for each row execute function lms.guard_set_for();
drop trigger if exists guard_set_for on lms.test_answer;
create trigger guard_set_for before insert on lms.test_answer
  for each row execute function lms.guard_set_for();
drop trigger if exists guard_set_for on lms.task_done;
create trigger guard_set_for before insert on lms.task_done
  for each row execute function lms.guard_set_for();
drop trigger if exists guard_set_for on lms.work_status;
create trigger guard_set_for before insert on lms.work_status
  for each row execute function lms.guard_set_for();
drop trigger if exists guard_set_for on lms.work_comment;
create trigger guard_set_for before insert on lms.work_comment
  for each row execute function lms.guard_set_for();

-- ---------------------------------------------------------------------------
-- What a child reads: work set for them (0023's and 0029's policies, and the
-- definer reads that bypass them).
-- ---------------------------------------------------------------------------

drop policy if exists "read the work you set, run, or were given" on lms.assignment;
create policy "read the work you set, run, or were given" on lms.assignment
  for select using (
    lms.teaches_class(section_id, subject_id)
    or lms.is_admin(org_id)
    or (published_at is not null and lms.in_section(section_id) and lms.is_set_for(id, auth.uid()))
  );

drop policy if exists "read the tasks of work you set or were given" on lms.assignment_task;
create policy "read the tasks of work you set or were given" on lms.assignment_task
  for select using (
    lms.can_manage_assignment(assignment_id)
    or exists (
      select 1 from lms.assignment a
       where a.id = assignment_id
         and (lms.is_admin(a.org_id)
              or (a.published_at is not null and lms.in_section(a.section_id) and lms.is_set_for(a.id, auth.uid())))
    )
  );

-- 0030's, for a child the work is set for.
create or replace function lms.assignment_questions(p_assignment uuid)
returns table (item_id uuid, question_position smallint, kind text, stem text, options jsonb)
language sql stable security definer
set search_path = public, lms
as $$
  select i.id, ai.position, i.kind, i.stem, i.options
    from lms.assignment a
    join lms.assignment_item ai on ai.assignment_id = a.id
    join lms.item i on i.id = ai.item_id
   where a.id = p_assignment
     and a.published_at is not null
     and lms.in_section(a.section_id)
     and lms.set_for(a.id, auth.uid())
     and (
       a.kind <> 'test'
       or exists (
         select 1 from lms.test_start ts
          where ts.assignment_id = a.id and ts.student_user_id = auth.uid()
            and now() <= lms.test_ends_at(a, ts.started_at) + interval '2 minutes'
       )
     )
   -- A test: in an order of this child's own, fixed by who they are.
   order by case when a.kind = 'test' then md5(auth.uid()::text || i.id::text) end, ai.position;
$$;

-- 0029's, for a child the work is set for.
create or replace function lms.question_count(p_assignment uuid)
returns integer
language sql stable security definer
set search_path = public, lms
as $$
  select count(*)::int
    from lms.assignment a
    join lms.assignment_item ai on ai.assignment_id = a.id
   where a.id = p_assignment and a.published_at is not null and lms.in_section(a.section_id)
     and lms.set_for(a.id, auth.uid());
$$;

-- 0029's, for a child the work is set for.
create or replace function lms.my_tasks(p_assignment uuid)
returns table (task_id uuid, task_position smallint, text text, done boolean)
language sql stable security definer
set search_path = public, lms
as $$
  select t.id, t.position, t.text,
         exists (select 1 from lms.task_done d where d.task_id = t.id and d.student_user_id = auth.uid())
    from lms.assignment a
    join lms.assignment_task t on t.assignment_id = a.id
   where a.id = p_assignment and a.published_at is not null and lms.in_section(a.section_id)
     and lms.set_for(a.id, auth.uid())
   order by t.position;
$$;

-- 0038's, for a child the work is set for.
create or replace function lms.my_work_comment(p_assignment uuid)
returns table (text text, written_by_name text, written_at timestamptz)
language sql stable security definer
set search_path = public, lms
as $$
  select c.text, w.display_name, c.written_at
    from lms.assignment a
    join lms.work_comment c on c.assignment_id = a.id and c.student_user_id = auth.uid()
    left join lms.account w on w.user_id = c.written_by
   where a.id = p_assignment
     and a.published_at is not null
     and lms.in_section(a.section_id)
     and lms.set_for(a.id, auth.uid())
     and (a.kind <> 'test' or a.results_released_at is not null);
$$;

-- 0025's, for a child the work is set for.
create or replace function lms.may_upload_work(p_name text)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select coalesce((
    select p.student_id = auth.uid()
       and a.published_at is not null
       and 'photo' = any (a.answer_types)
       and lms.in_section(a.section_id)
       and lms.set_for(a.id, auth.uid())
      from lms.work_path(p_name) p
      join lms.assignment a on a.id = p.assignment_id and a.org_id = p.org_id
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- Who counts: the children the work is set for.
-- ---------------------------------------------------------------------------

-- 0031's facts, one row per published piece of work and child it is set for
-- in its class — set_for's rule, written out so it joins.
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
   where a.org_id = p_org and a.published_at is not null
     and (not exists (select 1 from lms.assignment_student t where t.assignment_id = a.id)
          or exists (select 1 from lms.assignment_student t
                      where t.assignment_id = a.id and t.student_user_id = e.student_user_id));
$$;

-- 0029's, counting the children each piece is set for, and saying which
-- pieces are for some of them only.
drop function if exists lms.class_assignments(uuid, uuid);
create function lms.class_assignments(p_section uuid, p_subject uuid)
returns table (
  id uuid, kind text, title text, instructions text, due_at timestamptz,
  published boolean, published_at timestamptz, answer_types text[], attempts_allowed smallint,
  items integer, submitted integer, students integer,
  opens_at timestamptz, time_limit_minutes smallint, max_marks float8, results_released_at timestamptz, tasks integer,
  targeted boolean
)
language sql stable security invoker
set search_path = public, lms
as $$
  select a.id, a.kind, a.title, a.instructions, a.due_at,
         a.published_at is not null, a.published_at, a.answer_types, a.attempts_allowed,
         (select count(*)::int from lms.assignment_item ai where ai.assignment_id = a.id),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null
             and lms.is_set_for(a.id, e.student_user_id) and lms.handed_in(a.id, e.student_user_id)),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null and lms.is_set_for(a.id, e.student_user_id)),
         a.opens_at, a.time_limit_minutes, a.max_marks::float8, a.results_released_at,
         (select count(*)::int from lms.assignment_task t where t.assignment_id = a.id),
         lms.set_for_some(a.id)
    from lms.assignment a
   where a.section_id = p_section and a.subject_id = p_subject
   order by (a.published_at is null) desc, a.due_at desc, a.created_at desc;
$$;

drop function if exists lms.assignment_overview(uuid);
create function lms.assignment_overview(p_assignment uuid)
returns table (
  id uuid, kind text, title text, instructions text, due_at timestamptz,
  published boolean, published_at timestamptz, answer_types text[], attempts_allowed smallint,
  section_id uuid, grade smallint, section_name text, subject_id uuid, subject_name text,
  items integer, submitted integer, students integer,
  opens_at timestamptz, time_limit_minutes smallint, max_marks float8, results_released_at timestamptz, tasks integer,
  targeted boolean
)
language sql stable security invoker
set search_path = public, lms
as $$
  select a.id, a.kind, a.title, a.instructions, a.due_at,
         a.published_at is not null, a.published_at, a.answer_types, a.attempts_allowed,
         sec.id, sec.grade, sec.name, sub.id, sub.name,
         (select count(*)::int from lms.assignment_item ai where ai.assignment_id = a.id),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null
             and lms.is_set_for(a.id, e.student_user_id) and lms.handed_in(a.id, e.student_user_id)),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null and lms.is_set_for(a.id, e.student_user_id)),
         a.opens_at, a.time_limit_minutes, a.max_marks::float8, a.results_released_at,
         (select count(*)::int from lms.assignment_task t where t.assignment_id = a.id),
         lms.set_for_some(a.id)
    from lms.assignment a
    join lms.section sec on sec.id = a.section_id
    join lms.subject sub on sub.id = a.subject_id
   where a.id = p_assignment;
$$;

-- 0030's, one row per child of the class the work is set for.
create or replace function lms.assignment_results(p_assignment uuid)
returns table (
  student_user_id uuid, display_name text, login_id text, roll_number text,
  submitted boolean,
  submission_id uuid, attempts integer, submitted_at timestamptz, late boolean,
  machine_correct integer, machine_total integer, teacher_score float8, teacher_max float8,
  photo_submission_id uuid, photo_count integer, photo_teacher_score float8, photo_teacher_max float8,
  tasks_done integer, tasks_total integer, paper_score float8, paper_max float8,
  teacher_status text, started_at timestamptz
)
language sql stable security invoker
set search_path = public, lms
as $$
  select e.student_user_id, acc.display_name, acc.login_id, e.roll_number,
         lms.handed_in(a.id, e.student_user_id),
         mcq.id,
         (select count(*)::int from lms.submission s
           where s.assignment_id = a.id and s.student_user_id = e.student_user_id and s.kind = 'mcq'),
         greatest(mcq.submitted_at, ph.submitted_at, pp.submitted_at),
         coalesce(mcq.late, false) or coalesce(ph.late, false),
         mm.machine_correct::int, mm.machine_total::int,
         mm.teacher_score::float8, mm.teacher_max::float8,
         ph.id,
         (select count(*)::int from lms.submission_photo sp where sp.submission_id = ph.id),
         pm.teacher_score::float8, pm.teacher_max::float8,
         (select count(*)::int from lms.assignment_task t
            join lms.task_done d on d.task_id = t.id and d.student_user_id = e.student_user_id
           where t.assignment_id = a.id),
         (select count(*)::int from lms.assignment_task t where t.assignment_id = a.id),
         ppm.teacher_score::float8, ppm.teacher_max::float8,
         ws.status,
         ts.started_at
    from lms.assignment a
    join lms.enrolment e on e.section_id = a.section_id and e.left_on is null
    join lms.account acc on acc.user_id = e.student_user_id
    left join lateral (
      select s.* from lms.submission s
       where s.assignment_id = a.id and s.student_user_id = e.student_user_id and s.kind = 'mcq'
       order by s.attempt desc limit 1
    ) mcq on true
    left join lms.mark mm on mm.submission_id = mcq.id
    left join lateral (
      select s.* from lms.submission s
       where s.assignment_id = a.id and s.student_user_id = e.student_user_id and s.kind = 'photo'
       order by s.attempt desc limit 1
    ) ph on true
    left join lms.mark pm on pm.submission_id = ph.id
    left join lateral (
      select s.* from lms.submission s
       where s.assignment_id = a.id and s.student_user_id = e.student_user_id and s.kind = 'paper'
       limit 1
    ) pp on true
    left join lms.mark ppm on ppm.submission_id = pp.id
    left join lms.work_status ws on ws.assignment_id = a.id and ws.student_user_id = e.student_user_id
    left join lms.test_start ts on ts.assignment_id = a.id and ts.student_user_id = e.student_user_id
   -- The class's teacher and the school's admin only. RLS alone would show a
   -- student their own row — including a test's score before its release.
   where a.id = p_assignment
     and (lms.can_manage_assignment(a.id) or lms.is_admin(a.org_id))
     and lms.is_set_for(a.id, e.student_user_id)
   order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
            e.roll_number nulls last, acc.display_name;
$$;

-- 0030's, waiting only on the children each piece of work is set for.
create or replace function lms.needs_attention()
returns table (
  assignment_id uuid, title text, kind text, section_id uuid, subject_id uuid,
  class_name text, subject_name text, reason text, count integer, due_at timestamptz
)
language sql stable security invoker
set search_path = public, lms
as $$
  with mine as (
    select a.id, a.title, a.kind, a.section_id, a.subject_id, a.answer_types, a.due_at,
           a.results_released_at, sec.grade || sec.name as class_name, sub.name as subject_name
      from lms.assignment a
      join lms.section sec on sec.id = a.section_id
      join lms.subject sub on sub.id = a.subject_id
     where a.published_at is not null and lms.teaches_class(a.section_id, a.subject_id)
  ),
  roster as (
    select m.id, e.student_user_id
      from mine m
      join lms.enrolment e on e.section_id = m.section_id and e.left_on is null
     where lms.is_set_for(m.id, e.student_user_id)
  )
  select m.id, m.title, m.kind, m.section_id, m.subject_id, m.class_name, m.subject_name,
         'photos', count(*)::int, m.due_at
    from mine m
    join lms.submission s on s.assignment_id = m.id and s.kind = 'photo'
    join lms.mark mk on mk.submission_id = s.id and mk.teacher_score is null
   group by m.id, m.title, m.kind, m.section_id, m.subject_id, m.class_name, m.subject_name, m.due_at
  union all
  select m.id, m.title, m.kind, m.section_id, m.subject_id, m.class_name, m.subject_name,
         'marks', count(*)::int, m.due_at
    from mine m
    join roster r on r.id = m.id
   where 'paper' = any (m.answer_types) and m.due_at <= now()
     and not exists (select 1 from lms.submission s
                      where s.assignment_id = m.id and s.student_user_id = r.student_user_id and s.kind = 'paper')
     and not exists (select 1 from lms.work_status w
                      where w.assignment_id = m.id and w.student_user_id = r.student_user_id and w.status = 'absent')
   group by m.id, m.title, m.kind, m.section_id, m.subject_id, m.class_name, m.subject_name, m.due_at
  union all
  select m.id, m.title, m.kind, m.section_id, m.subject_id, m.class_name, m.subject_name,
         'release', (select count(*)::int from lms.submission s where s.assignment_id = m.id), m.due_at
    from mine m
   where m.kind = 'test' and m.due_at <= now() and m.results_released_at is null
  union all
  select m.id, m.title, m.kind, m.section_id, m.subject_id, m.class_name, m.subject_name,
         'notebooks', count(*)::int, m.due_at
    from mine m
    join roster r on r.id = m.id
   where 'checklist' = any (m.answer_types) and m.due_at <= now()
     and not exists (select 1 from lms.work_status w
                      where w.assignment_id = m.id and w.student_user_id = r.student_user_id)
   group by m.id, m.title, m.kind, m.section_id, m.subject_id, m.class_name, m.subject_name, m.due_at
  order by 10, 2;
$$;

-- ---------------------------------------------------------------------------
-- 1. What a class shows now, and 2. practice for some of it.
-- ---------------------------------------------------------------------------

-- The questions practice on a chapter of a class may be set from (see 2
-- above), numbered in the order they are chosen. Internal.
create or replace function lms.practice_items(p_section uuid, p_subject uuid, p_chapter text, p_misconception text)
returns table (item_id uuid, pick bigint)
language sql stable security definer
set search_path = public, lms
as $$
  select i.id,
         row_number() over (
           order by
             case when jsonb_typeof(i.misconceptions) = 'array' then exists (
               select 1 from jsonb_array_elements_text(i.misconceptions) as m(label)
                where btrim(m.label) <> '' and btrim(m.label) = btrim(coalesce(p_misconception, ''))
             ) else false end desc,
             exists (select 1 from lms.assignment_item ai join lms.assignment a on a.id = ai.assignment_id
                      where ai.item_id = i.id and a.section_id = p_section),
             i.created_at, i.id
         )
    from lms.section sec
    join lms.subject sub on sub.id = p_subject and sub.org_id = sec.org_id
    join lms.item i on i.grade = sec.grade and i.subject = coalesce(sub.syllabus_subject, sub.name)
                   and i.kind = 'mcq' and (i.org_id is null or i.org_id = sec.org_id)
   where sec.id = p_section
     and exists (select 1 from lms.item_approval ap where ap.org_id = sec.org_id and ap.item_id = i.id)
     and exists (select 1 from lms.outcome o where o.id = any (i.outcome_ids) and o.chapter = p_chapter)
     and not exists (
       select 1 from lms.assignment_item ai join lms.assignment a on a.id = ai.assignment_id
        where ai.item_id = i.id and a.section_id = p_section
          and (a.kind = 'test' or a.published_at is null or a.due_at > now())
     );
$$;

-- One row per chapter and misconception children of the class show now (see
-- 1 above), each child once, by roll number. A question filed under no
-- chapter of the curriculum gives no row.
create or replace function lms.class_likely_misconceptions(p_section uuid, p_subject uuid)
returns table (chapter text, label text, students integer, children jsonb, questions integer)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  sec lms.section;
  sub lms.subject;
begin
  select * into sec from lms.section where id = p_section;
  select * into sub from lms.subject where id = p_subject;
  if sec.id is null or sub.id is null or sub.org_id <> sec.org_id
     or not (lms.teaches_class(p_section, p_subject) or lms.is_admin(sec.org_id)) then
    raise exception 'this is not your class';
  end if;
  return query
    with latest as (
      select distinct on (s.assignment_id, s.student_user_id) s.id, s.student_user_id, s.submitted_at
        from lms.submission s
        join lms.assignment a on a.id = s.assignment_id
       where a.section_id = p_section and a.subject_id = p_subject
         and a.published_at is not null and s.kind = 'mcq'
       order by s.assignment_id, s.student_user_id, s.attempt desc
    ),
    -- Each answered question that can catch a misconception: one row per
    -- label it carries, and whether the child chose the option carrying it.
    met as (
      select l.student_user_id, l.id as submission_id, l.submitted_at,
             (select o.chapter from lms.outcome o where o.id = any (i.outcome_ids) order by o.position limit 1) as chapter,
             btrim(m.label) as label,
             sa.chosen_index = m.n - 1 as chose
        from latest l
        join lms.submission_answer sa on sa.submission_id = l.id and sa.chosen_index is not null
        join lms.item i on i.id = sa.item_id
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(i.misconceptions) = 'array' then i.misconceptions else '[]'::jsonb end
        ) with ordinality as m(label, n)
       where btrim(m.label) <> '' and m.n - 1 <> i.correct_index
    ),
    occasion as (
      select mt.student_user_id, mt.chapter, mt.label, mt.submission_id, mt.submitted_at, bool_or(mt.chose) as chose
        from met mt
       where mt.chapter is not null
       group by mt.student_user_id, mt.chapter, mt.label, mt.submission_id, mt.submitted_at
    ),
    latest_occasion as (
      select distinct on (o.student_user_id, o.chapter, o.label) o.student_user_id, o.chapter, o.label, o.chose
        from occasion o
       order by o.student_user_id, o.chapter, o.label, o.submitted_at desc, o.submission_id
    )
    select lo.chapter, lo.label, count(*)::int,
           jsonb_agg(
             jsonb_build_object('studentUserId', e.student_user_id, 'displayName', acc.display_name, 'rollNumber', e.roll_number)
             order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
                      e.roll_number nulls last, acc.display_name
           ),
           (select count(*)::int from lms.practice_items(p_section, p_subject, lo.chapter, lo.label))
      from latest_occasion lo
      join lms.enrolment e on e.student_user_id = lo.student_user_id and e.section_id = p_section and e.left_on is null
      join lms.account acc on acc.user_id = lo.student_user_id and acc.left_at is null
     where lo.chose
     group by lo.chapter, lo.label
     order by count(*) desc, lo.chapter, lo.label;
end;
$$;

-- Sets and publishes practice for the children named (see 2 above); returns
-- its id. Up to p_questions questions (1 to 20), fewer when fewer are free.
create or replace function lms.send_practice(
  p_section uuid,
  p_subject uuid,
  p_chapter text,
  p_students uuid[],
  p_due_at timestamptz,
  p_misconception text default null,
  p_title text default null,
  p_questions integer default 5
)
returns uuid
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  sec lms.section;
  sub lms.subject;
  named uuid[];
  chapter_words text;
  words text;
  picked uuid[];
  new_id uuid;
begin
  select * into sec from lms.section where id = p_section;
  select * into sub from lms.subject where id = p_subject;
  if sec.id is null or sub.id is null or sub.org_id <> sec.org_id
     or not (lms.teaches_class(p_section, p_subject) or lms.is_admin(sec.org_id)) then
    raise exception 'this is not your class';
  end if;
  if sec.academic_year_id is distinct from lms.current_year(sec.org_id) then
    raise exception 'that is not a class of this year';
  end if;
  if p_chapter is null or not exists (
    select 1 from lms.outcome o
     where o.grade = sec.grade and o.subject = coalesce(sub.syllabus_subject, sub.name) and o.chapter = p_chapter
  ) then
    raise exception 'that is not a chapter of Class % %', sec.grade, sub.name;
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into named
    from unnest(coalesce(p_students, '{}'::uuid[])) x
   where x is not null;
  if cardinality(named) = 0 then
    raise exception 'choose at least one child';
  end if;
  if exists (
    select 1 from unnest(named) as x(student)
     where not exists (
       select 1 from lms.enrolment e
         join lms.account acc on acc.user_id = e.student_user_id and acc.left_at is null
        where e.section_id = p_section and e.student_user_id = x.student and e.left_on is null
     )
  ) then
    raise exception 'a student named is not in this class';
  end if;
  if p_due_at is null or p_due_at <= now() then
    raise exception 'give a due date still to come';
  end if;
  if p_questions is null or p_questions not between 1 and 20 then
    raise exception 'practice has 1 to 20 questions';
  end if;
  chapter_words := replace(p_chapter, '-', ' ');
  words := coalesce(nullif(btrim(coalesce(p_title, '')), ''),
                    'Practice: ' || upper(left(chapter_words, 1)) || substr(chapter_words, 2));
  if char_length(words) > 200 then
    raise exception 'a title is 1 to 200 characters';
  end if;

  select coalesce(array_agg(p.item_id order by p.pick), '{}'::uuid[]) into picked
    from (select pi.item_id, pi.pick
            from lms.practice_items(p_section, p_subject, p_chapter, p_misconception) pi
           order by pi.pick
           limit p_questions) p;
  if cardinality(picked) = 0 then
    raise exception 'no approved question on this chapter is free to set; approve some in the question bank first';
  end if;

  -- Questions go on while it is a draft (0023's guard); then it is published.
  insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, attempts_allowed, answer_types)
  values (sec.org_id, sec.id, sub.id, auth.uid(), 'homework', words, p_due_at, 1, array['mcq'])
  returning id into new_id;
  insert into lms.assignment_item (assignment_id, item_id, position)
  select new_id, t.item, t.n from unnest(picked) with ordinality as t(item, n);
  insert into lms.assignment_student (assignment_id, student_user_id, org_id)
  select new_id, x, sec.org_id from unnest(named) x;
  update lms.assignment set published_at = now() where id = new_id;

  perform lms.audit(sec.org_id, 'practice-sent', sec.grade || sec.name || ' ' || sub.name || ' ' || p_chapter,
    jsonb_build_object(
      'misconception', nullif(btrim(coalesce(p_misconception, '')), ''),
      'students', cardinality(named),
      'questions', cardinality(picked)
    ));
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function lms.set_for(uuid, uuid) from public, anon, authenticated;
revoke all on function lms.is_set_for(uuid, uuid) from public, anon;
revoke all on function lms.set_for_some(uuid) from public, anon;
revoke all on function lms.guard_set_for() from public, anon, authenticated;
revoke all on function lms.assignment_questions(uuid) from public, anon;
revoke all on function lms.question_count(uuid) from public, anon;
revoke all on function lms.my_tasks(uuid) from public, anon;
revoke all on function lms.my_work_comment(uuid) from public, anon;
revoke all on function lms.may_upload_work(text) from public, anon;
revoke all on function lms.work_facts(uuid) from public, anon, authenticated;
revoke all on function lms.class_assignments(uuid, uuid) from public, anon;
revoke all on function lms.assignment_overview(uuid) from public, anon;
revoke all on function lms.assignment_results(uuid) from public, anon;
revoke all on function lms.needs_attention() from public, anon;
revoke all on function lms.practice_items(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function lms.class_likely_misconceptions(uuid, uuid) from public, anon;
revoke all on function lms.send_practice(uuid, uuid, text, uuid[], timestamptz, text, text, integer) from public, anon;

grant execute on function lms.set_for(uuid, uuid) to service_role;
-- Read inside the invoker views and the policies above, as the signed-in caller.
grant execute on function lms.is_set_for(uuid, uuid) to authenticated, service_role;
grant execute on function lms.set_for_some(uuid) to authenticated, service_role;
grant execute on function lms.assignment_questions(uuid) to authenticated, service_role;
grant execute on function lms.question_count(uuid) to authenticated, service_role;
grant execute on function lms.my_tasks(uuid) to authenticated, service_role;
grant execute on function lms.my_work_comment(uuid) to authenticated, service_role;
grant execute on function lms.may_upload_work(text) to authenticated, service_role;
grant execute on function lms.work_facts(uuid) to service_role;
grant execute on function lms.class_assignments(uuid, uuid) to authenticated, service_role;
grant execute on function lms.assignment_overview(uuid) to authenticated, service_role;
grant execute on function lms.assignment_results(uuid) to authenticated, service_role;
grant execute on function lms.needs_attention() to authenticated, service_role;
grant execute on function lms.practice_items(uuid, uuid, text, text) to service_role;
grant execute on function lms.class_likely_misconceptions(uuid, uuid) to authenticated, service_role;
grant execute on function lms.send_practice(uuid, uuid, text, uuid[], timestamptz, text, text, integer) to authenticated, service_role;
