-- MORE KINDS OF WORK, AND EVENTS — after the founder's review of the demo.
--
-- 1. WRITTEN WORK IN THE NOTEBOOK, AS A CHECKLIST. Most homework is done on
--    paper. The teacher lists the tasks; the student ticks each one when it
--    is done. A tick is the child's own word: it is never written to the
--    ledger, so it can never move what the brain believes (0027).
-- 2. TESTS. A test opens at a set time, runs against a time limit the
--    SERVER keeps (the start is recorded here, not on the phone), allows one
--    attempt, and shows a child their score and answers only once the
--    teacher releases the results.
-- 3. TESTS ON PAPER. The teacher enters each child's marks, out of the
--    test's maximum.
-- 4. EVENTS. A PTM, an exam, a function — for one class (its teachers or
--    the admin post it) or the whole school (the admin only).
--
-- Written against packages/lms-client/tests/work.test.ts, first.

-- ---------------------------------------------------------------------------
-- The assignment gains the kinds of answer and the timing a test needs.
-- ---------------------------------------------------------------------------

alter table lms.assignment drop constraint if exists assignment_answer_types_check;
alter table lms.assignment add constraint assignment_answer_types_check check (
  cardinality(answer_types) > 0
  and answer_types <@ array['mcq', 'photo', 'typed', 'checklist', 'paper']::text[]
);

alter table lms.assignment
  -- Students cannot start it before this (tests); null: as soon as published.
  add column if not exists opens_at timestamptz,
  add column if not exists time_limit_minutes smallint
    check (time_limit_minutes is null or time_limit_minutes between 1 and 300),
  -- What a teacher's marks are out of: required for work marked on paper.
  add column if not exists max_marks numeric(6, 2)
    check (max_marks is null or (max_marks > 0 and max_marks <= 1000)),
  -- A test's scores and answers reach its students only after this is set.
  add column if not exists results_released_at timestamptz;

alter table lms.submission drop constraint if exists submission_kind_check;
alter table lms.submission add constraint submission_kind_check
  check (kind in ('mcq', 'photo', 'paper'));

-- ---------------------------------------------------------------------------
-- New tables. Browsers may read what the policies allow; every write goes
-- through a SECURITY DEFINER function below that checks who is asking.
-- ---------------------------------------------------------------------------

create table if not exists lms.assignment_task (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references lms.assignment on delete cascade,
  position smallint not null check (position between 1 and 30),
  text text not null check (char_length(text) between 1 and 300),
  unique (assignment_id, position)
);

create table if not exists lms.task_done (
  task_id uuid not null references lms.assignment_task on delete cascade,
  student_user_id uuid not null references auth.users on delete cascade,
  done_at timestamptz not null default now(),
  primary key (task_id, student_user_id)
);

create table if not exists lms.test_start (
  assignment_id uuid not null references lms.assignment on delete cascade,
  student_user_id uuid not null references auth.users on delete cascade,
  started_at timestamptz not null default now(),
  primary key (assignment_id, student_user_id)
);

create table if not exists lms.event (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  -- null: the whole school.
  section_id uuid,
  kind text not null check (kind in ('event', 'ptm', 'exam', 'holiday', 'trip', 'other')),
  title text not null check (char_length(title) between 1 and 200),
  details text check (details is null or char_length(details) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at is null or ends_at >= starts_at),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  foreign key (section_id, org_id) references lms.section (id, org_id) on delete cascade
);
create index if not exists event_org_starts on lms.event (org_id, starts_at);

grant select on lms.assignment_task, lms.task_done, lms.test_start, lms.event to authenticated;
grant all on lms.assignment_task, lms.task_done, lms.test_start, lms.event to service_role;
revoke all on lms.assignment_task, lms.task_done, lms.test_start, lms.event from anon;

alter table lms.assignment_task enable row level security;
alter table lms.task_done enable row level security;
alter table lms.test_start enable row level security;
alter table lms.event enable row level security;

drop policy if exists "read the tasks of work you set or were given" on lms.assignment_task;
create policy "read the tasks of work you set or were given" on lms.assignment_task
  for select using (
    lms.can_manage_assignment(assignment_id)
    or exists (
      select 1 from lms.assignment a
       where a.id = assignment_id
         and (lms.is_admin(a.org_id) or (a.published_at is not null and lms.in_section(a.section_id)))
    )
  );

drop policy if exists "read your own ticks, or your class's" on lms.task_done;
create policy "read your own ticks, or your class's" on lms.task_done
  for select using (
    student_user_id = auth.uid()
    or exists (
      select 1 from lms.assignment_task t
       where t.id = task_id and lms.can_manage_assignment(t.assignment_id)
    )
  );

drop policy if exists "read your own test starts, or your class's" on lms.test_start;
create policy "read your own test starts, or your class's" on lms.test_start
  for select using (student_user_id = auth.uid() or lms.can_manage_assignment(assignment_id));

drop policy if exists "read your class's and your school's events" on lms.event;
create policy "read your class's and your school's events" on lms.event
  for select using (
    public.is_member(org_id)
    and (
      section_id is null
      or lms.teaches_section(section_id)
      or lms.in_section(section_id)
      or lms.is_admin(org_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Setting work: timing, marks, tasks, publishing, releasing results.
-- ---------------------------------------------------------------------------

drop function if exists lms.create_assignment(uuid, uuid, text, timestamptz, text, text, text[], integer);
create or replace function lms.create_assignment(
  p_section uuid,
  p_subject uuid,
  p_title text,
  p_due_at timestamptz,
  p_kind text default 'homework',
  p_instructions text default null,
  p_answer_types text[] default array['mcq'],
  p_attempts_allowed integer default 1,
  p_opens_at timestamptz default null,
  p_time_limit_minutes integer default null,
  p_max_marks numeric default null
)
returns uuid
language plpgsql volatile security invoker
set search_path = public, lms
as $$
declare
  new_id uuid;
begin
  if not lms.teaches_class(p_section, p_subject) then
    raise exception 'this is not your class';
  end if;
  if p_time_limit_minutes is not null and p_kind <> 'test' then
    raise exception 'only a test has a time limit';
  end if;
  if p_opens_at is not null and p_opens_at >= p_due_at then
    raise exception 'it must open before it is due';
  end if;
  if 'paper' = any (p_answer_types) and p_max_marks is null then
    raise exception 'give the maximum marks for work marked on paper';
  end if;
  insert into lms.assignment
    (org_id, section_id, subject_id, created_by, kind, title, instructions, due_at, attempts_allowed,
     answer_types, opens_at, time_limit_minutes, max_marks)
  select s.org_id, s.id, p_subject, auth.uid(), p_kind, p_title, p_instructions, p_due_at,
         -- A test is taken once.
         case when p_kind = 'test' then 1 else p_attempts_allowed end,
         p_answer_types, p_opens_at, p_time_limit_minutes, p_max_marks
    from lms.section s
   where s.id = p_section
  returning id into new_id;
  return new_id;
end;
$$;

-- Rename, reword, move the dates of, or change the attempts, time limit or
-- maximum marks of work (0026's version, plus the test fields). A null
-- leaves that field as it is; an empty instruction clears it.
drop function if exists lms.update_assignment(uuid, text, text, timestamptz, integer);
create or replace function lms.update_assignment(
  p_assignment uuid,
  p_title text default null,
  p_instructions text default null,
  p_due_at timestamptz default null,
  p_attempts_allowed integer default null,
  p_opens_at timestamptz default null,
  p_time_limit_minutes integer default null,
  p_max_marks numeric default null
)
returns void
language plpgsql volatile security invoker
set search_path = public, lms
as $$
declare
  a lms.assignment;
begin
  if not lms.can_manage_assignment(p_assignment) then
    raise exception 'this is not your class';
  end if;
  select * into a from lms.assignment where id = p_assignment;
  if p_time_limit_minutes is not null and a.kind <> 'test' then
    raise exception 'only a test has a time limit';
  end if;
  if coalesce(p_opens_at, a.opens_at) >= coalesce(p_due_at, a.due_at) then
    raise exception 'it must open before it is due';
  end if;
  update lms.assignment
     set title = coalesce(p_title, title),
         instructions = case when p_instructions is null then instructions else nullif(p_instructions, '') end,
         due_at = coalesce(p_due_at, due_at),
         attempts_allowed = case when kind = 'test' then 1 else coalesce(p_attempts_allowed, attempts_allowed) end,
         opens_at = coalesce(p_opens_at, opens_at),
         time_limit_minutes = coalesce(p_time_limit_minutes, time_limit_minutes),
         max_marks = coalesce(p_max_marks, max_marks)
   where id = p_assignment;
end;
$$;

-- Replaces a draft's written tasks with these, in this order.
create or replace function lms.set_assignment_tasks(p_assignment uuid, p_tasks text[])
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  t text;
  n integer := 0;
begin
  if not lms.can_manage_assignment(p_assignment) then
    raise exception 'this is not your class';
  end if;
  if exists (select 1 from lms.assignment where id = p_assignment and published_at is not null) then
    raise exception 'this assignment is published; its tasks are fixed';
  end if;
  if coalesce(cardinality(p_tasks), 0) > 30 then
    raise exception 'at most 30 tasks on one assignment';
  end if;
  delete from lms.assignment_task where assignment_id = p_assignment;
  foreach t in array coalesce(p_tasks, '{}'::text[]) loop
    if btrim(t) = '' then
      continue;
    end if;
    n := n + 1;
    insert into lms.assignment_task (assignment_id, position, text) values (p_assignment, n, btrim(t));
  end loop;
end;
$$;

create or replace function lms.assignment_tasks(p_assignment uuid)
returns table (task_id uuid, task_position smallint, text text)
language sql stable security invoker
set search_path = public, lms
as $$
  select t.id, t.position, t.text from lms.assignment_task t
   where t.assignment_id = p_assignment
   order by t.position;
$$;

create or replace function lms.publish_assignment(p_assignment uuid)
returns void
language plpgsql volatile security invoker
set search_path = public, lms
as $$
declare
  a lms.assignment;
begin
  if not lms.can_manage_assignment(p_assignment) then
    raise exception 'this is not your class';
  end if;
  select * into a from lms.assignment where id = p_assignment;
  if a.published_at is not null then
    return;
  end if;
  if 'mcq' = any (a.answer_types)
     and not exists (select 1 from lms.assignment_item ai where ai.assignment_id = a.id) then
    raise exception 'MCQ homework needs at least one question before it is published';
  end if;
  if 'checklist' = any (a.answer_types)
     and not exists (select 1 from lms.assignment_task t where t.assignment_id = a.id) then
    raise exception 'written work needs at least one task before it is published';
  end if;
  update lms.assignment set published_at = now() where id = a.id;
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
  update lms.assignment set results_released_at = coalesce(results_released_at, now())
   where id = p_assignment;
end;
$$;

-- A mark for work done on paper, entered by the class's teacher. Kept as a
-- 'paper' submission with the teacher's mark on it (0024's history too), so
-- the gradebook reads it like any other mark.
create or replace function lms.record_paper_mark(p_assignment uuid, p_student uuid, p_score numeric)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
  sid uuid;
begin
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or not lms.teaches_class(a.section_id, a.subject_id) then
    raise exception 'this is not your class';
  end if;
  if not ('paper' = any (a.answer_types)) then
    raise exception 'this work is not marked on paper';
  end if;
  if p_score is null or p_score < 0 or p_score > a.max_marks then
    raise exception 'marks are out of %', trim(to_char(a.max_marks, 'FM999990.99'), '.');
  end if;
  if not exists (
    select 1 from lms.enrolment e
     where e.section_id = a.section_id and e.student_user_id = p_student and e.left_on is null
  ) then
    raise exception 'that student is not in this class';
  end if;
  select s.id into sid from lms.submission s
   where s.assignment_id = a.id and s.student_user_id = p_student and s.kind = 'paper';
  if sid is null then
    insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, late)
    values (a.org_id, a.id, p_student, 'paper', 1, false)
    returning id into sid;
    insert into lms.mark (submission_id, machine_correct, machine_total) values (sid, 0, 0);
  end if;
  perform lms.set_teacher_mark(sid, p_score, a.max_marks);
end;
$$;

-- ---------------------------------------------------------------------------
-- Doing work: ticking tasks, starting a test.
-- ---------------------------------------------------------------------------

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
   order by t.position;
$$;

create or replace function lms.tick_task(p_task uuid, p_done boolean)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (
    select 1 from lms.assignment_task t
      join lms.assignment a on a.id = t.assignment_id
     where t.id = p_task and a.published_at is not null and lms.in_section(a.section_id)
  ) then
    raise exception 'this is not your homework';
  end if;
  if p_done then
    insert into lms.task_done (task_id, student_user_id) values (p_task, me) on conflict do nothing;
  else
    delete from lms.task_done where task_id = p_task and student_user_id = me;
  end if;
end;
$$;

-- When the caller's time on a test ends: the time limit from their start,
-- or the due time, whichever comes first.
create or replace function lms.test_ends_at(a lms.assignment, started timestamptz)
returns timestamptz
language sql immutable
as $$
  select case when a.time_limit_minutes is null then a.due_at
              else least(started + make_interval(mins => a.time_limit_minutes), a.due_at) end;
$$;

create or replace function lms.start_test(p_assignment uuid)
returns table (started_at timestamptz, ends_at timestamptz)
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
  started timestamptz;
begin
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or a.published_at is null or a.kind <> 'test' or not lms.in_section(a.section_id) then
    raise exception 'this is not your test';
  end if;
  if a.opens_at is not null and now() < a.opens_at then
    raise exception 'this test has not started yet';
  end if;
  select ts.started_at into started from lms.test_start ts
   where ts.assignment_id = a.id and ts.student_user_id = auth.uid();
  if started is null then
    if now() > a.due_at then
      raise exception 'this test has closed';
    end if;
    insert into lms.test_start (assignment_id, student_user_id) values (a.id, auth.uid())
    returning test_start.started_at into started;
  end if;
  return query select started, lms.test_ends_at(a, started);
end;
$$;

-- A test's answers are taken only from a child who started it, within their
-- time (and two minutes' grace for a slow connection). Enforced as the
-- submission is written, so submit_mcq (0024) keeps one path for all work.
create or replace function lms.guard_test_submission()
returns trigger
language plpgsql security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
  started timestamptz;
begin
  if new.kind <> 'mcq' then
    return new;
  end if;
  select * into a from lms.assignment where id = new.assignment_id;
  if a.kind <> 'test' then
    return new;
  end if;
  if a.opens_at is not null and now() < a.opens_at then
    raise exception 'this test has not started yet';
  end if;
  select ts.started_at into started from lms.test_start ts
   where ts.assignment_id = a.id and ts.student_user_id = new.student_user_id;
  if started is null then
    raise exception 'start the test first';
  end if;
  if now() > lms.test_ends_at(a, started) + interval '2 minutes' then
    raise exception 'time is up for this test';
  end if;
  new.late := false;
  return new;
end;
$$;

drop trigger if exists guard_test_submission on lms.submission;
create trigger guard_test_submission
  before insert on lms.submission
  for each row execute function lms.guard_test_submission();

-- A published assignment's questions, stem and options only (0023) — and for
-- a test, only once the child has started it and while their time runs.
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
     and (
       a.kind <> 'test'
       or exists (
         select 1 from lms.test_start ts
          where ts.assignment_id = a.id and ts.student_user_id = auth.uid()
            and now() <= lms.test_ends_at(a, ts.started_at) + interval '2 minutes'
       )
     )
   order by ai.position;
$$;

-- ---------------------------------------------------------------------------
-- Reading work: the teacher's views gain timing, tasks and paper marks; the
-- student's gain tasks, timing and results release.
-- ---------------------------------------------------------------------------

-- Who has handed a piece of work in: any submission, or every task ticked.
-- Answers only to the student themselves, the class's teacher and the
-- school's admin; to anyone else it says no.
create or replace function lms.handed_in(p_assignment uuid, p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select (p_student = auth.uid()
          or lms.can_manage_assignment(p_assignment)
          or exists (select 1 from lms.assignment a where a.id = p_assignment and lms.is_admin(a.org_id)))
     and (
       exists (select 1 from lms.submission s where s.assignment_id = p_assignment and s.student_user_id = p_student)
       or (
         exists (select 1 from lms.assignment_task t where t.assignment_id = p_assignment)
         and not exists (
           select 1 from lms.assignment_task t
            where t.assignment_id = p_assignment
              and not exists (select 1 from lms.task_done d where d.task_id = t.id and d.student_user_id = p_student)
         )
       )
     );
$$;

-- How many questions a published assignment has, for its own students —
-- who may not read lms.assignment_item (0023), and who must see a test's
-- length before they start it.
create or replace function lms.question_count(p_assignment uuid)
returns integer
language sql stable security definer
set search_path = public, lms
as $$
  select count(*)::int
    from lms.assignment a
    join lms.assignment_item ai on ai.assignment_id = a.id
   where a.id = p_assignment and a.published_at is not null and lms.in_section(a.section_id);
$$;

drop function if exists lms.class_assignments(uuid, uuid);
create or replace function lms.class_assignments(p_section uuid, p_subject uuid)
returns table (
  id uuid, kind text, title text, instructions text, due_at timestamptz,
  published boolean, published_at timestamptz, answer_types text[], attempts_allowed smallint,
  items integer, submitted integer, students integer,
  opens_at timestamptz, time_limit_minutes smallint, max_marks float8, results_released_at timestamptz, tasks integer
)
language sql stable security invoker
set search_path = public, lms
as $$
  select a.id, a.kind, a.title, a.instructions, a.due_at,
         a.published_at is not null, a.published_at, a.answer_types, a.attempts_allowed,
         (select count(*)::int from lms.assignment_item ai where ai.assignment_id = a.id),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null and lms.handed_in(a.id, e.student_user_id)),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null),
         a.opens_at, a.time_limit_minutes, a.max_marks::float8, a.results_released_at,
         (select count(*)::int from lms.assignment_task t where t.assignment_id = a.id)
    from lms.assignment a
   where a.section_id = p_section and a.subject_id = p_subject
   order by (a.published_at is null) desc, a.due_at desc, a.created_at desc;
$$;

drop function if exists lms.assignment_overview(uuid);
create or replace function lms.assignment_overview(p_assignment uuid)
returns table (
  id uuid, kind text, title text, instructions text, due_at timestamptz,
  published boolean, published_at timestamptz, answer_types text[], attempts_allowed smallint,
  section_id uuid, grade smallint, section_name text, subject_id uuid, subject_name text,
  items integer, submitted integer, students integer,
  opens_at timestamptz, time_limit_minutes smallint, max_marks float8, results_released_at timestamptz, tasks integer
)
language sql stable security invoker
set search_path = public, lms
as $$
  select a.id, a.kind, a.title, a.instructions, a.due_at,
         a.published_at is not null, a.published_at, a.answer_types, a.attempts_allowed,
         sec.id, sec.grade, sec.name, sub.id, sub.name,
         (select count(*)::int from lms.assignment_item ai where ai.assignment_id = a.id),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null and lms.handed_in(a.id, e.student_user_id)),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null),
         a.opens_at, a.time_limit_minutes, a.max_marks::float8, a.results_released_at,
         (select count(*)::int from lms.assignment_task t where t.assignment_id = a.id)
    from lms.assignment a
    join lms.section sec on sec.id = a.section_id
    join lms.subject sub on sub.id = a.subject_id
   where a.id = p_assignment;
$$;

drop function if exists lms.assignment_results(uuid);
create or replace function lms.assignment_results(p_assignment uuid)
returns table (
  student_user_id uuid, display_name text, login_id text, roll_number text,
  submitted boolean,
  submission_id uuid, attempts integer, submitted_at timestamptz, late boolean,
  machine_correct integer, machine_total integer, teacher_score float8, teacher_max float8,
  photo_submission_id uuid, photo_count integer, photo_teacher_score float8, photo_teacher_max float8,
  tasks_done integer, tasks_total integer, paper_score float8, paper_max float8
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
         ppm.teacher_score::float8, ppm.teacher_max::float8
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
   where a.id = p_assignment
   order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
            e.roll_number nulls last, acc.display_name;
$$;

drop function if exists lms.my_assignments();
create or replace function lms.my_assignments()
returns table (
  id uuid, kind text, title text, instructions text, due_at timestamptz, published_at timestamptz,
  subject_id uuid, subject_name text, answer_types text[], attempts_allowed smallint, questions integer,
  mcq_attempts_used integer, best_correct integer, best_total integer,
  photo_submitted boolean, teacher_score float8, teacher_max float8, marked_at timestamptz,
  opens_at timestamptz, time_limit_minutes smallint, max_marks float8, results_released boolean,
  tasks_total integer, tasks_done integer, started_at timestamptz, ends_at timestamptz
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
         case when ts.started_at is not null then lms.test_ends_at(a, ts.started_at) end
    from lms.assignment a
    join lms.subject sub on sub.id = a.subject_id
    cross join lateral (select a.kind <> 'test' or a.results_released_at is not null as yes) released
    left join lms.test_start ts on ts.assignment_id = a.id and ts.student_user_id = auth.uid()
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
   where a.published_at is not null and lms.in_section(a.section_id)
   order by a.due_at, a.title;
$$;

-- The review of a child's own attempt (0026), held back on a test until the
-- teacher releases its results.
create or replace function lms.my_review(p_assignment uuid)
returns table (
  item_id uuid, question_position smallint, stem text, options jsonb,
  chosen_index smallint, correct boolean, correct_index smallint
)
language sql stable security definer
set search_path = public, lms
as $$
  with a as (
    select * from lms.assignment
     where id = p_assignment and published_at is not null and lms.in_section(section_id)
       and (kind <> 'test' or results_released_at is not null)
  ),
  tries as (
    select s.id, s.attempt from lms.submission s join a on a.id = s.assignment_id
     where s.student_user_id = auth.uid() and s.kind = 'mcq'
  ),
  mine as (
    select id from tries order by attempt desc limit 1
  )
  select i.id, ai.position, i.stem, i.options, sa.chosen_index, coalesce(sa.correct, false),
         case when (select count(*) from tries) >= a.attempts_allowed or now() > a.due_at
                   or a.kind = 'test'
              then i.correct_index end
    from a
    join mine on true
    join lms.assignment_item ai on ai.assignment_id = a.id
    join lms.item i on i.id = ai.item_id
    left join lms.submission_answer sa on sa.submission_id = mine.id and sa.item_id = i.id
   where i.kind = 'mcq'
   order by ai.position;
$$;

-- ---------------------------------------------------------------------------
-- Events.
-- ---------------------------------------------------------------------------

create or replace function lms.create_event(
  p_section uuid,
  p_title text,
  p_starts_at timestamptz,
  p_kind text default 'event',
  p_details text default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid;
  new_id uuid;
begin
  if p_section is null then
    org := public.current_org_id();
    if org is null or not lms.is_admin(org) then
      raise exception 'only the school admin can post an event for the whole school';
    end if;
  else
    select s.org_id into org from lms.section s where s.id = p_section;
    if org is null or not (lms.teaches_section(p_section) or lms.is_admin(org)) then
      raise exception 'this is not your class';
    end if;
  end if;
  insert into lms.event (org_id, section_id, kind, title, details, starts_at, ends_at, created_by)
  values (org, p_section, p_kind, btrim(p_title), nullif(btrim(p_details), ''), p_starts_at, p_ends_at, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function lms.delete_event(p_event uuid)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  ev lms.event;
begin
  select * into ev from lms.event where id = p_event;
  if ev.id is null or not (ev.created_by = auth.uid() or lms.is_admin(ev.org_id)) then
    raise exception 'only whoever posted it, or the school admin, can delete this event';
  end if;
  delete from lms.event where id = p_event;
end;
$$;

-- What is coming up for the caller: the events they may see, and the tests
-- of their classes that have not closed. Invoker: RLS decides.
create or replace function lms.upcoming_events(p_days integer default 60)
returns table (
  id uuid, source text, kind text, title text, details text,
  starts_at timestamptz, ends_at timestamptz, section_id uuid, class_name text, mine boolean
)
language sql stable security invoker
set search_path = public, lms
as $$
  select ev.id, 'event', ev.kind, ev.title, ev.details, ev.starts_at, ev.ends_at, ev.section_id,
         case when sec.id is not null then sec.grade || sec.name end,
         ev.created_by = auth.uid()
    from lms.event ev
    left join lms.section sec on sec.id = ev.section_id
   where coalesce(ev.ends_at, ev.starts_at) >= now() - interval '12 hours'
     and ev.starts_at <= now() + make_interval(days => least(greatest(coalesce(p_days, 60), 1), 366))
  union all
  select a.id, 'test', 'test', a.title, sub.name, coalesce(a.opens_at, a.due_at), a.due_at, a.section_id,
         sec.grade || sec.name, a.created_by = auth.uid()
    from lms.assignment a
    join lms.subject sub on sub.id = a.subject_id
    join lms.section sec on sec.id = a.section_id
   where a.kind = 'test' and a.published_at is not null and a.due_at >= now()
     and coalesce(a.opens_at, a.due_at) <= now() + make_interval(days => least(greatest(coalesce(p_days, 60), 1), 366))
  order by 6, 4;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function lms.create_assignment(uuid, uuid, text, timestamptz, text, text, text[], integer, timestamptz, integer, numeric) from public, anon;
revoke all on function lms.update_assignment(uuid, text, text, timestamptz, integer, timestamptz, integer, numeric) from public, anon;
revoke all on function lms.set_assignment_tasks(uuid, text[]) from public, anon;
revoke all on function lms.assignment_tasks(uuid) from public, anon;
revoke all on function lms.release_results(uuid) from public, anon;
revoke all on function lms.record_paper_mark(uuid, uuid, numeric) from public, anon;
revoke all on function lms.my_tasks(uuid) from public, anon;
revoke all on function lms.tick_task(uuid, boolean) from public, anon;
revoke all on function lms.test_ends_at(lms.assignment, timestamptz) from public, anon;
revoke all on function lms.start_test(uuid) from public, anon;
revoke all on function lms.guard_test_submission() from public, anon, authenticated;
revoke all on function lms.handed_in(uuid, uuid) from public, anon, authenticated;
revoke all on function lms.question_count(uuid) from public, anon;
revoke all on function lms.class_assignments(uuid, uuid) from public, anon;
revoke all on function lms.assignment_overview(uuid) from public, anon;
revoke all on function lms.assignment_results(uuid) from public, anon;
revoke all on function lms.my_assignments() from public, anon;
revoke all on function lms.create_event(uuid, text, timestamptz, text, text, timestamptz) from public, anon;
revoke all on function lms.delete_event(uuid) from public, anon;
revoke all on function lms.upcoming_events(integer) from public, anon;

grant execute on function lms.create_assignment(uuid, uuid, text, timestamptz, text, text, text[], integer, timestamptz, integer, numeric) to authenticated, service_role;
grant execute on function lms.update_assignment(uuid, text, text, timestamptz, integer, timestamptz, integer, numeric) to authenticated, service_role;
grant execute on function lms.set_assignment_tasks(uuid, text[]) to authenticated, service_role;
grant execute on function lms.assignment_tasks(uuid) to authenticated, service_role;
grant execute on function lms.release_results(uuid) to authenticated, service_role;
grant execute on function lms.record_paper_mark(uuid, uuid, numeric) to authenticated, service_role;
grant execute on function lms.my_tasks(uuid) to authenticated, service_role;
grant execute on function lms.tick_task(uuid, boolean) to authenticated, service_role;
grant execute on function lms.test_ends_at(lms.assignment, timestamptz) to authenticated, service_role;
grant execute on function lms.start_test(uuid) to authenticated, service_role;
grant execute on function lms.class_assignments(uuid, uuid) to authenticated, service_role;
grant execute on function lms.assignment_overview(uuid) to authenticated, service_role;
grant execute on function lms.assignment_results(uuid) to authenticated, service_role;
grant execute on function lms.my_assignments() to authenticated, service_role;
grant execute on function lms.create_event(uuid, text, timestamptz, text, text, timestamptz) to authenticated, service_role;
grant execute on function lms.delete_event(uuid) to authenticated, service_role;
grant execute on function lms.upcoming_events(integer) to authenticated, service_role;
-- handed_in is read inside the invoker views above, as the signed-in caller.
grant execute on function lms.handed_in(uuid, uuid) to authenticated, service_role;
grant execute on function lms.question_count(uuid) to authenticated, service_role;
