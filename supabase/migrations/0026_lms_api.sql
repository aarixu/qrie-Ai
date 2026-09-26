-- THE LMS API — LMS build plan, L4.
--
-- Every screen of the teacher app and the student app reads and writes
-- through these functions (packages/lms-client), one call per screen. They
-- are SECURITY INVOKER: each runs as the signed-in caller, so every row one
-- touches passes the same policies 0022–0025 already prove as the real
-- roles. A function here adds no power a browser did not already have; it
-- adds shape, plain-English refusals, and the one check a policy cannot
-- express (MCQ homework is not published without questions).
--
-- Writes still land where 0023–0025 put them: items, approvals and
-- assignments under their insert and update policies; submissions and marks
-- only through the SECURITY DEFINER functions of 0024 and 0025.
--
-- Written against packages/lms-client/tests/flow.test.ts — a teacher sets
-- homework, a student does it, the teacher marks it, the student sees the
-- mark — run through the client on the real migrations, first.
--
-- Also closes a hole found writing it: the approval policy (0023) never
-- looked at the item, so a teacher who learnt the id of ANOTHER school's own
-- question could approve it for their school and set it for their class.
-- An approval now needs the item to be the library's or the school's own.

-- ---------------------------------------------------------------------------
-- The approval hole.
-- ---------------------------------------------------------------------------

drop policy if exists "staff approve for their own school" on lms.item_approval;
create policy "staff approve for their own school" on lms.item_approval
  for insert with check (
    lms.is_staff(org_id)
    and approved_by = auth.uid()
    and exists (
      select 1 from lms.item i
       where i.id = item_approval.item_id
         and (i.org_id is null or i.org_id = item_approval.org_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Anyone signed in.
-- ---------------------------------------------------------------------------

create or replace function lms.me()
returns table (
  user_id uuid, org_id uuid, kind text, display_name text, login_id text,
  school_code text, school_name text, board text, brand jsonb, logo_path text
)
language sql stable security invoker
set search_path = public, lms
as $$
  select a.user_id, a.org_id, a.kind, a.display_name, a.login_id,
         s.code, s.display_name, s.board, s.brand, s.logo_path
    from lms.account a
    join lms.school s on s.org_id = a.org_id
   where a.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- A teacher.
-- ---------------------------------------------------------------------------

-- Every section-and-subject the caller teaches, all years (the pilot has one).
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
   order by sec.grade, sec.name, sub.name;
$$;

-- The current roster, numeric roll numbers in number order.
create or replace function lms.class_roster(p_section uuid)
returns table (student_user_id uuid, display_name text, login_id text, roll_number text)
language sql stable security invoker
set search_path = public, lms
as $$
  select e.student_user_id, a.display_name, a.login_id, e.roll_number
    from lms.enrolment e
    join lms.account a on a.user_id = e.student_user_id
   where e.section_id = p_section and e.left_on is null
   order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
            e.roll_number nulls last, a.display_name;
$$;

-- The question bank a teacher chooses from: Qrie's library and their own
-- school's questions (what lms.item's policy lets staff read), the school's
-- first, each marked approved or not for the caller's school. The search is
-- a plain substring of the question; % and _ in it are taken literally.
create or replace function lms.library(
  p_grade integer default null,
  p_subject text default null,
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, source text, grade smallint, subject text, kind text, stem text,
  options jsonb, correct_index smallint, outcome_ids text[], approved boolean
)
language sql stable security invoker
set search_path = public, lms
as $$
  select i.id,
         case when i.org_id is null then 'library' else 'school' end,
         i.grade, i.subject, i.kind, i.stem, i.options, i.correct_index, i.outcome_ids,
         exists (select 1 from lms.item_approval ap
                  where ap.item_id = i.id and ap.org_id = public.current_org_id())
    from lms.item i
   where (p_grade is null or i.grade = p_grade)
     and (p_subject is null or i.subject = p_subject)
     and (p_query is null or i.stem ilike
            '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by (i.org_id is null), i.created_at desc, i.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function lms.approve_item(p_item uuid)
returns void
language plpgsql volatile security invoker
set search_path = public, lms
as $$
declare
  org uuid := public.current_org_id();
begin
  if not exists (
    select 1 from lms.item i where i.id = p_item and (i.org_id is null or i.org_id = org)
  ) then
    raise exception 'no such question';
  end if;
  insert into lms.item_approval (org_id, item_id, approved_by)
  values (org, p_item, auth.uid())
  on conflict do nothing;
end;
$$;

-- A teacher's own question, for their school; approved as it is written
-- (0023's approve_own_item).
create or replace function lms.write_item(
  p_grade integer,
  p_subject text,
  p_stem text,
  p_kind text default 'mcq',
  p_options jsonb default null,
  p_correct_index integer default null
)
returns uuid
language sql volatile security invoker
set search_path = public, lms
as $$
  insert into lms.item (org_id, grade, subject, kind, stem, options, correct_index, created_by)
  values (public.current_org_id(), p_grade, p_subject, p_kind, p_stem, p_options, p_correct_index, auth.uid())
  returning id;
$$;

create or replace function lms.create_assignment(
  p_section uuid,
  p_subject uuid,
  p_title text,
  p_due_at timestamptz,
  p_kind text default 'homework',
  p_instructions text default null,
  p_answer_types text[] default array['mcq'],
  p_attempts_allowed integer default 1
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
  insert into lms.assignment
    (org_id, section_id, subject_id, created_by, kind, title, instructions, due_at, attempts_allowed, answer_types)
  select s.org_id, s.id, p_subject, auth.uid(), p_kind, p_title, p_instructions, p_due_at,
         p_attempts_allowed, p_answer_types
    from lms.section s
   where s.id = p_section
  returning id into new_id;
  return new_id;
end;
$$;

-- Replaces a draft's questions with these, in this order.
create or replace function lms.set_assignment_items(p_assignment uuid, p_items uuid[])
returns void
language plpgsql volatile security invoker
set search_path = public, lms
as $$
begin
  if not lms.can_manage_assignment(p_assignment) then
    raise exception 'this is not your class';
  end if;
  if exists (select 1 from lms.assignment where id = p_assignment and published_at is not null) then
    raise exception 'this assignment is published; its questions are frozen';
  end if;
  if coalesce(cardinality(p_items), 0) > 100 then
    raise exception 'at most 100 questions on one assignment';
  end if;
  if coalesce(cardinality(p_items), 0) <> (select count(distinct x) from unnest(p_items) x) then
    raise exception 'a question is on this assignment twice';
  end if;
  delete from lms.assignment_item where assignment_id = p_assignment;
  insert into lms.assignment_item (assignment_id, item_id, position)
  select p_assignment, t.item, t.n
    from unnest(p_items) with ordinality as t(item, n);
end;
$$;

-- Publishing is what puts work in front of students. Publishing twice is
-- harmless; MCQ work with no questions cannot be published at all.
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
  update lms.assignment set published_at = now() where id = a.id;
end;
$$;

-- A class's work, drafts first, then the latest due first.
create or replace function lms.class_assignments(p_section uuid, p_subject uuid)
returns table (
  id uuid, kind text, title text, instructions text, due_at timestamptz,
  published boolean, published_at timestamptz, answer_types text[], attempts_allowed smallint,
  items integer, submitted integer, students integer
)
language sql stable security invoker
set search_path = public, lms
as $$
  select a.id, a.kind, a.title, a.instructions, a.due_at,
         a.published_at is not null, a.published_at, a.answer_types, a.attempts_allowed,
         (select count(*)::int from lms.assignment_item ai where ai.assignment_id = a.id),
         (select count(distinct s.student_user_id)::int from lms.submission s where s.assignment_id = a.id),
         (select count(*)::int from lms.enrolment e
           where e.section_id = a.section_id and e.left_on is null)
    from lms.assignment a
   where a.section_id = p_section and a.subject_id = p_subject
   order by (a.published_at is null) desc, a.due_at desc, a.created_at desc;
$$;

-- One row per student on the class's current roster: whether they handed
-- in, the latest MCQ attempt (the one a teacher marks) with the machine's
-- mark and the teacher's beside it, and the latest photo submission.
create or replace function lms.assignment_results(p_assignment uuid)
returns table (
  student_user_id uuid, display_name text, login_id text, roll_number text,
  submitted boolean,
  submission_id uuid, attempts integer, submitted_at timestamptz, late boolean,
  machine_correct integer, machine_total integer, teacher_score float8, teacher_max float8,
  photo_submission_id uuid, photo_count integer, photo_teacher_score float8, photo_teacher_max float8
)
language sql stable security invoker
set search_path = public, lms
as $$
  select e.student_user_id, acc.display_name, acc.login_id, e.roll_number,
         (mcq.id is not null or ph.id is not null),
         mcq.id,
         (select count(*)::int from lms.submission s
           where s.assignment_id = a.id and s.student_user_id = e.student_user_id and s.kind = 'mcq'),
         greatest(mcq.submitted_at, ph.submitted_at),
         coalesce(mcq.late, false) or coalesce(ph.late, false),
         mm.machine_correct::int, mm.machine_total::int,
         mm.teacher_score::float8, mm.teacher_max::float8,
         ph.id,
         (select count(*)::int from lms.submission_photo sp where sp.submission_id = ph.id),
         pm.teacher_score::float8, pm.teacher_max::float8
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
   where a.id = p_assignment
   order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
            e.roll_number nulls last, acc.display_name;
$$;

-- ---------------------------------------------------------------------------
-- A student.
-- ---------------------------------------------------------------------------

-- The published work of the caller's own sections, soonest due first, with
-- their own attempts, best MCQ score, and the teacher's latest mark. Only
-- the caller's own rows: a teacher calling this gets nothing.
create or replace function lms.my_assignments()
returns table (
  id uuid, kind text, title text, instructions text, due_at timestamptz, published_at timestamptz,
  subject_id uuid, subject_name text, answer_types text[], attempts_allowed smallint, questions integer,
  mcq_attempts_used integer, best_correct integer, best_total integer,
  photo_submitted boolean, teacher_score float8, teacher_max float8, marked_at timestamptz
)
language sql stable security invoker
set search_path = public, lms
as $$
  select a.id, a.kind, a.title, a.instructions, a.due_at, a.published_at,
         sub.id, sub.name, a.answer_types, a.attempts_allowed,
         (select count(*)::int from lms.assignment_questions(a.id)),
         (select count(*)::int from lms.submission s
           where s.assignment_id = a.id and s.student_user_id = auth.uid() and s.kind = 'mcq'),
         best.machine_correct::int, best.machine_total::int,
         exists (select 1 from lms.submission s
                  where s.assignment_id = a.id and s.student_user_id = auth.uid() and s.kind = 'photo'),
         tm.teacher_score::float8, tm.teacher_max::float8, tm.marked_at
    from lms.assignment a
    join lms.subject sub on sub.id = a.subject_id
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

-- ---------------------------------------------------------------------------
-- Grants. Signed-in callers only; what each may do is still RLS's to decide.
-- ---------------------------------------------------------------------------

revoke all on function lms.me() from public, anon;
revoke all on function lms.my_classes() from public, anon;
revoke all on function lms.class_roster(uuid) from public, anon;
revoke all on function lms.library(integer, text, text, integer, integer) from public, anon;
revoke all on function lms.approve_item(uuid) from public, anon;
revoke all on function lms.write_item(integer, text, text, text, jsonb, integer) from public, anon;
revoke all on function lms.create_assignment(uuid, uuid, text, timestamptz, text, text, text[], integer) from public, anon;
revoke all on function lms.set_assignment_items(uuid, uuid[]) from public, anon;
revoke all on function lms.publish_assignment(uuid) from public, anon;
revoke all on function lms.class_assignments(uuid, uuid) from public, anon;
revoke all on function lms.assignment_results(uuid) from public, anon;
revoke all on function lms.my_assignments() from public, anon;

grant execute on function lms.me() to authenticated, service_role;
grant execute on function lms.my_classes() to authenticated, service_role;
grant execute on function lms.class_roster(uuid) to authenticated, service_role;
grant execute on function lms.library(integer, text, text, integer, integer) to authenticated, service_role;
grant execute on function lms.approve_item(uuid) to authenticated, service_role;
grant execute on function lms.write_item(integer, text, text, text, jsonb, integer) to authenticated, service_role;
grant execute on function lms.create_assignment(uuid, uuid, text, timestamptz, text, text, text[], integer) to authenticated, service_role;
grant execute on function lms.set_assignment_items(uuid, uuid[]) to authenticated, service_role;
grant execute on function lms.publish_assignment(uuid) to authenticated, service_role;
grant execute on function lms.class_assignments(uuid, uuid) to authenticated, service_role;
grant execute on function lms.assignment_results(uuid) to authenticated, service_role;
grant execute on function lms.my_assignments() to authenticated, service_role;
