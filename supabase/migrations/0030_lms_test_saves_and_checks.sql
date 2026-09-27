-- WHAT THE DESIGN REVIEW FOUND MISSING — after 0029.
--
-- A review of how established products do tests and homework
-- (Moodle, Google Classroom and Forms, Microsoft Teams, Satchel One, Fedena)
-- found three gaps before a pilot:
--
-- 1. A TEST MUST SURVIVE A DROPPED CONNECTION. 0029 took one hand-in at the
--    end and refused it after the time limit, so a phone that lost the
--    network at the end lost every answer. Now each answer is saved as it is
--    tapped (lms.save_test_answer), and when a child's time runs out the
--    server hands in what was saved (lms.finalize_tests, run every minute by
--    pg_cron and before any release of results).
-- 2. EACH CHILD GETS THE TEST'S QUESTIONS IN THEIR OWN ORDER, the same every
--    time they open it, so a child who finishes first cannot read out
--    "question 3".
-- 3. THE TEACHER'S OWN WORD ON EACH CHILD'S WORK — checked, not done,
--    absent — set for many children at once (lms.set_work_status). A child's
--    tick is only the child's word (0029); this is the teacher's.
--
-- The grading that lms.submit_mcq did (0024) moves into lms.grade_mcq, so
-- the child's hand-in and the server's hand-in are one path. Its ledger rows
-- now say 'test' for a test.
--
-- Written against packages/lms-client/tests/checks.test.ts, first.

-- ---------------------------------------------------------------------------
-- 1. Saved answers, and grading from them.
-- ---------------------------------------------------------------------------

create table if not exists lms.test_answer (
  assignment_id uuid not null references lms.assignment on delete cascade,
  student_user_id uuid not null references auth.users on delete cascade,
  item_id uuid not null references lms.item on delete restrict,
  chosen_index smallint not null check (chosen_index >= 0),
  saved_at timestamptz not null default now(),
  primary key (assignment_id, student_user_id, item_id)
);

grant select on lms.test_answer to authenticated;
grant all on lms.test_answer to service_role;
revoke all on lms.test_answer from anon;
alter table lms.test_answer enable row level security;
drop policy if exists "read your own saved answers, or your class's" on lms.test_answer;
create policy "read your own saved answers, or your class's" on lms.test_answer
  for select using (student_user_id = auth.uid() or lms.can_manage_assignment(assignment_id));

create or replace function lms.save_test_answer(p_assignment uuid, p_item uuid, p_chosen integer)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
  started timestamptz;
  opts jsonb;
begin
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or a.published_at is null or a.kind <> 'test' or not lms.in_section(a.section_id) then
    raise exception 'this is not your test';
  end if;
  select ts.started_at into started from lms.test_start ts
   where ts.assignment_id = a.id and ts.student_user_id = auth.uid();
  if started is null then
    raise exception 'start the test first';
  end if;
  if now() > lms.test_ends_at(a, started) + interval '2 minutes' then
    raise exception 'time is up for this test';
  end if;
  if exists (
    select 1 from lms.submission s
     where s.assignment_id = a.id and s.student_user_id = auth.uid() and s.kind = 'mcq'
  ) then
    raise exception 'this test is already handed in';
  end if;
  select i.options into opts
    from lms.assignment_item ai join lms.item i on i.id = ai.item_id
   where ai.assignment_id = a.id and ai.item_id = p_item and i.kind = 'mcq';
  if opts is null then
    raise exception 'item % is not on this test', p_item;
  end if;
  if p_chosen is null then
    delete from lms.test_answer
     where assignment_id = a.id and student_user_id = auth.uid() and item_id = p_item;
    return;
  end if;
  if p_chosen < 0 or p_chosen >= jsonb_array_length(opts) then
    raise exception 'item % has no option %', p_item, p_chosen;
  end if;
  insert into lms.test_answer (assignment_id, student_user_id, item_id, chosen_index)
  values (a.id, auth.uid(), p_item, p_chosen)
  on conflict (assignment_id, student_user_id, item_id)
  do update set chosen_index = excluded.chosen_index, saved_at = now();
end;
$$;

-- THE GRADING, for one student's attempt: 0024's submit_mcq, with the
-- student named rather than taken from the session, and — on a test — the
-- answers saved as they were tapped, under any sent at hand-in. Internal:
-- reached only through submit_mcq (the student) and finalize_tests (the
-- server), each of which decides who the student is.
create or replace function lms.grade_mcq(p_assignment uuid, p_student uuid, p_answers jsonb)
returns table (submission_id uuid, correct integer, total integer)
language plpgsql
security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
  it lms.item;
  answers jsonb;
  k text;
  v jsonb;
  chosen smallint;
  is_right boolean;
  n_attempt smallint;
  sid uuid;
  session uuid := gen_random_uuid();
  src text;
  n_correct integer := 0;
  n_total integer := 0;
  n_seq integer := 0;
begin
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or a.published_at is null or not exists (
    select 1 from lms.enrolment e
     where e.section_id = a.section_id and e.student_user_id = p_student and e.left_on is null
  ) then
    raise exception 'this is not your homework';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must map each item id to the option chosen';
  end if;
  answers := p_answers;
  if a.kind = 'test' then
    answers := coalesce((
      select jsonb_object_agg(ta.item_id::text, ta.chosen_index)
        from lms.test_answer ta
       where ta.assignment_id = a.id and ta.student_user_id = p_student
    ), '{}'::jsonb) || p_answers;
  end if;
  for k in select jsonb_object_keys(answers) loop
    if not exists (
      select 1 from lms.assignment_item ai where ai.assignment_id = a.id and ai.item_id::text = k
    ) then
      raise exception 'item % is not on this assignment', k;
    end if;
  end loop;

  select coalesce(max(s.attempt), 0) + 1 into n_attempt
    from lms.submission s
   where s.assignment_id = a.id and s.student_user_id = p_student and s.kind = 'mcq';
  if n_attempt > a.attempts_allowed then
    raise exception 'no attempts left for this homework';
  end if;

  insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, late)
  values (a.org_id, a.id, p_student, 'mcq', n_attempt, now() > a.due_at)
  returning id into sid;

  src := case when a.kind = 'test' then 'test' else 'homework' end;
  insert into public.learning_session (id, org_id, user_id, source, started_at, ended_at)
  values (session, a.org_id, p_student, src, now(), now());

  for it in
    select i.* from lms.assignment_item ai join lms.item i on i.id = ai.item_id
     where ai.assignment_id = a.id and i.kind = 'mcq'
     order by ai.position
  loop
    v := answers -> it.id::text;
    chosen := null;
    if v is not null and jsonb_typeof(v) <> 'null' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^\d+$'
         or (v #>> '{}')::integer >= jsonb_array_length(it.options) then
        raise exception 'item % has no option %', it.id, v #>> '{}';
      end if;
      chosen := (v #>> '{}')::smallint;
    end if;
    is_right := chosen is not null and chosen = it.correct_index;
    n_total := n_total + 1;
    if is_right then
      n_correct := n_correct + 1;
    end if;

    insert into lms.submission_answer (submission_id, item_id, chosen_index, correct)
    values (sid, it.id, chosen, is_right);

    n_seq := n_seq + 1;
    insert into public.ledger_event
      (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
    values (
      gen_random_uuid(), a.org_id, p_student, session, n_seq, now(), 'answered', src, 'tap', it.outcome_ids,
      jsonb_build_object(
        'correct', is_right,
        'chosenIndex', chosen,
        'itemId', it.id,
        'assignmentId', a.id,
        'submissionId', sid,
        'attempt', n_attempt,
        -- Rung 0: the product gave no help (0024).
        'assistanceRung', 0
      )
    );
  end loop;

  insert into lms.mark (submission_id, machine_correct, machine_total)
  values (sid, n_correct, n_total);

  return query select sid, n_correct, n_total;
end;
$$;

-- The child's hand-in (0024's signature, unchanged for callers).
create or replace function lms.submit_mcq(p_assignment uuid, p_answers jsonb)
returns table (submission_id uuid, correct integer, total integer)
language plpgsql
security definer
set search_path = public, lms
as $$
declare
  me uuid := auth.uid();
  a lms.assignment;
  r record;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or a.published_at is null or not lms.in_section(a.section_id) then
    raise exception 'this is not your homework';
  end if;
  select * into r from lms.grade_mcq(p_assignment, me, p_answers);
  -- A test's score reaches the child only when the teacher releases it (0029).
  if a.kind = 'test' then
    return query select r.submission_id, null::integer, null::integer;
  else
    return query select r.submission_id, r.correct, r.total;
  end if;
end;
$$;

-- The server's hand-in: every started test attempt whose time (and grace)
-- has run out without one, graded from its saved answers. Safe for anyone to
-- run — it only does what the clock already decided. Returns how many it
-- handed in.
create or replace function lms.finalize_tests(p_assignment uuid default null)
returns integer
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  r record;
  n integer := 0;
begin
  -- Read by guard_test_submission: this hand-in is the server's, after the
  -- clock, so its time checks do not apply. Set only here, for this
  -- transaction; no API call can set it.
  perform set_config('lms.finalizing', 'on', true);
  for r in
    select ts.assignment_id, ts.student_user_id
      from lms.test_start ts
      join lms.assignment a on a.id = ts.assignment_id
     where (p_assignment is null or ts.assignment_id = p_assignment)
       and a.kind = 'test'
       and now() > lms.test_ends_at(a, ts.started_at) + interval '2 minutes'
       and not exists (
         select 1 from lms.submission s
          where s.assignment_id = ts.assignment_id and s.student_user_id = ts.student_user_id and s.kind = 'mcq'
       )
  loop
    begin
      perform lms.grade_mcq(r.assignment_id, r.student_user_id, '{}'::jsonb);
      n := n + 1;
    exception when others then
      -- One attempt that cannot be graded (the child has left the class)
      -- must not stop the others.
      raise warning 'finalize_tests: % for % on %', sqlerrm, r.student_user_id, r.assignment_id;
    end;
  end loop;
  perform set_config('lms.finalizing', 'off', true);
  return n;
end;
$$;

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
  new.late := false;
  if current_setting('lms.finalizing', true) = 'on' then
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
  return new;
end;
$$;

-- Results are released only after every expired attempt has been handed in.
create or replace function lms.release_results(p_assignment uuid)
returns void
language plpgsql volatile security invoker
set search_path = public, lms
as $$
begin
  if not lms.can_manage_assignment(p_assignment) then
    raise exception 'this is not your class';
  end if;
  perform lms.finalize_tests(p_assignment);
  update lms.assignment set results_released_at = coalesce(results_released_at, now())
   where id = p_assignment;
end;
$$;

-- Every minute on the hosted project. (The demo school's server runs it
-- itself: PGlite has no pg_cron.)
do $$
begin
  perform cron.unschedule('lms-finalize-tests');
exception
  when others then null; -- no such job yet, the ordinary first run
end;
$$;
select cron.schedule('lms-finalize-tests', '* * * * *', $job$ select lms.finalize_tests(); $job$);

-- ---------------------------------------------------------------------------
-- 2. Each child's own question order on a test.
-- ---------------------------------------------------------------------------

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
   -- A test: in an order of this child's own, fixed by who they are.
   order by case when a.kind = 'test' then md5(auth.uid()::text || i.id::text) end, ai.position;
$$;

-- ---------------------------------------------------------------------------
-- 3. The teacher's word on each child's work.
-- ---------------------------------------------------------------------------

create table if not exists lms.work_status (
  assignment_id uuid not null references lms.assignment on delete cascade,
  student_user_id uuid not null references auth.users on delete cascade,
  status text not null check (status in ('checked', 'not_done', 'absent')),
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now(),
  primary key (assignment_id, student_user_id)
);

grant select on lms.work_status to authenticated;
grant all on lms.work_status to service_role;
revoke all on lms.work_status from anon;
alter table lms.work_status enable row level security;
drop policy if exists "read your own work status, or your class's" on lms.work_status;
create policy "read your own work status, or your class's" on lms.work_status
  for select using (student_user_id = auth.uid() or lms.can_manage_assignment(assignment_id));

-- Sets (or, with a null status, clears) the teacher's word for each named
-- student of the class.
create or replace function lms.set_work_status(p_assignment uuid, p_students uuid[], p_status text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
begin
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or not lms.teaches_class(a.section_id, a.subject_id) then
    raise exception 'this is not your class';
  end if;
  if p_status is not null and p_status not in ('checked', 'not_done', 'absent') then
    raise exception 'a status is checked, not done or absent';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_students, '{}'::uuid[])) as x(student)
     where not exists (
       select 1 from lms.enrolment e
        where e.section_id = a.section_id and e.student_user_id = x.student and e.left_on is null
     )
  ) then
    raise exception 'a student named is not in this class';
  end if;
  if p_status is null then
    delete from lms.work_status where assignment_id = a.id and student_user_id = any (p_students);
  else
    insert into lms.work_status (assignment_id, student_user_id, status, set_by)
    select a.id, x.student, p_status, auth.uid() from unnest(p_students) as x(student)
    on conflict (assignment_id, student_user_id)
    do update set status = excluded.status, set_by = excluded.set_by, set_at = now();
  end if;
end;
$$;

-- The teacher's results (0029's), with the teacher's word beside each child.
drop function if exists lms.assignment_results(uuid);
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
   where a.id = p_assignment
   order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
            e.roll_number nulls last, acc.display_name;
$$;

-- The student's list (0029's), with the teacher's word on their own work.
drop function if exists lms.my_assignments();
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
   where a.published_at is not null and lms.in_section(a.section_id)
   order by a.due_at, a.title;
$$;

-- A test the child started shows its saved answers when they come back to it.
create or replace function lms.my_saved_answers(p_assignment uuid)
returns table (item_id uuid, chosen_index smallint)
language sql stable security invoker
set search_path = public, lms
as $$
  select ta.item_id, ta.chosen_index from lms.test_answer ta
   where ta.assignment_id = p_assignment and ta.student_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 4. What needs the teacher (the review's "Needs you"): in the caller's own
--    classes, photos not yet marked, paper marks not yet entered, tests
--    closed but not released, and notebooks past due not yet checked.
--    Invoker: RLS and teaches_class keep it to the caller's classes.
-- ---------------------------------------------------------------------------

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
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function lms.save_test_answer(uuid, uuid, integer) from public, anon;
revoke all on function lms.grade_mcq(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function lms.finalize_tests(uuid) from public, anon;
revoke all on function lms.set_work_status(uuid, uuid[], text) from public, anon;
revoke all on function lms.assignment_results(uuid) from public, anon;
revoke all on function lms.my_assignments() from public, anon;
revoke all on function lms.my_saved_answers(uuid) from public, anon;
revoke all on function lms.needs_attention() from public, anon;

grant execute on function lms.save_test_answer(uuid, uuid, integer) to authenticated, service_role;
grant execute on function lms.grade_mcq(uuid, uuid, jsonb) to service_role;
-- release_results (invoker) calls it as the teacher; it only ever does what
-- the clock has already decided, so any signed-in caller may run it.
grant execute on function lms.finalize_tests(uuid) to authenticated, service_role;
grant execute on function lms.set_work_status(uuid, uuid[], text) to authenticated, service_role;
grant execute on function lms.assignment_results(uuid) to authenticated, service_role;
grant execute on function lms.my_assignments() to authenticated, service_role;
grant execute on function lms.my_saved_answers(uuid) to authenticated, service_role;
grant execute on function lms.needs_attention() to authenticated, service_role;
