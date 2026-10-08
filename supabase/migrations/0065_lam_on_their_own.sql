-- WHAT A CHILD CAN DO ON THEIR OWN, BESIDE WHAT THEY DO WITH HELP
-- (learner-model v4; lam-one-brain Task 3, truth test D08 and D26).
--
-- Every report the school apps read averaged concept_state.mastery, which
-- counts a right answer given after hints (at a discount), so a child the
-- tutor walked to thirty right answers read as knowing the chapter. And
-- lms.class_insights' unassisted_mastery (0027) averaged every answered
-- outcome's, so an outcome never answered alone added the prior, 0.5.
--
-- 1. Each of these now returns, beside its old columns (kept, same names):
--      unassisted_mastery       the mean of concept_state.unassisted_mastery
--                               over the outcomes answered at least once
--                               alone (unassisted_observations > 0); null
--                               when none was;
--      unassisted_observations  how many answers were given alone (the sum
--                               of unassisted_observations);
--      assisted_performance     the mean of concept_state.assisted_performance
--                               over the outcomes answered at least once with
--                               help (answer_observations > unassisted_
--                               observations: the fold moves it only on such
--                               answers); null when none was.
--    lms.my_progress and lms.class_insights (0027), lms.student_chapters and
--    lms.practice_chapters (0031), lms.student_subjects, lms.school_overview,
--    lms.school_classes and lms.school_students (0042). Their bodies, and who
--    may call each, are otherwise those migrations'. Postgres cannot change a
--    function's returned columns in place, so each is dropped and created.
--
-- 2. Whether the brain has read a child's answers yet, so an app can say
--    "being worked out" instead of "no answers yet" (D26). An event is
--    waiting while the server received it after the last event concept_state
--    was built from (learner_model.folded_through_received_at, 0061; to the
--    millisecond, the order packages/lms-brain think() folds in), or while
--    the child has no learner_model row at all.
--      lms.brain_status(p_student): the time the server received their last
--        answer, the receipt of the oldest event the brain has not read (null
--        when none waits), and when the brain last wrote their model. Whoever
--        may see the child (lms.may_see_student) may ask.
--      lms.class_brain_status(p_section, p_subject): for the children on the
--        class's roll, when the brain last wrote any of their models, the
--        oldest unread event, and how many children have one. The class's
--        teacher or the school's admin may ask. It reads each child's whole
--        ledger, of every subject.

drop function if exists lms.my_progress();
create function lms.my_progress()
returns table (
  grade smallint, subject text, chapter text, outcomes_seen integer, answers integer, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
language sql stable security invoker
set search_path = public, lms
as $$
  select o.grade, o.subject, o.chapter, count(*)::int, sum(cs.answer_observations)::int, avg(cs.mastery)::float8,
         (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8,
         sum(cs.unassisted_observations)::int,
         (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
    from public.concept_state cs
    join lms.outcome o on o.id = cs.outcome_id
   where cs.user_id = auth.uid() and cs.answer_observations > 0
   group by o.grade, o.subject, o.chapter
   order by o.subject, o.grade, o.chapter;
$$;

drop function if exists lms.class_insights(uuid, uuid);
create function lms.class_insights(p_section uuid, p_subject uuid)
returns table (
  student_user_id uuid, display_name text, roll_number text, chapter text,
  outcomes_seen integer, answers integer, mastery float8, unassisted_mastery float8,
  unassisted_observations integer, assisted_performance float8
)
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
    select e.student_user_id, a.display_name, e.roll_number, o.chapter,
           count(*)::int, sum(cs.answer_observations)::int,
           avg(cs.mastery)::float8,
           (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8,
           sum(cs.unassisted_observations)::int,
           (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
      from lms.enrolment e
      join lms.account a on a.user_id = e.student_user_id
      join public.concept_state cs on cs.user_id = e.student_user_id and cs.answer_observations > 0
      join lms.outcome o on o.id = cs.outcome_id
                        and o.grade = sec.grade
                        and o.subject = coalesce(sub.syllabus_subject, sub.name)
     where e.section_id = p_section and e.left_on is null
     group by e.student_user_id, a.display_name, e.roll_number, o.chapter
     order by o.chapter,
              case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
              a.display_name;
end;
$$;

drop function if exists lms.student_chapters(uuid);
create function lms.student_chapters(p_student uuid)
returns table (
  subject text, chapter text, outcomes_seen integer, answers integer, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
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
    select o.subject, o.chapter, count(*)::int, sum(cs.answer_observations)::int, avg(cs.mastery)::float8,
           (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8,
           sum(cs.unassisted_observations)::int,
           (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
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

drop function if exists lms.practice_chapters();
create function lms.practice_chapters()
returns table (
  subject_name text, chapter text, questions integer, answers integer, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
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
           coalesce(b.answers, 0),
           b.mastery, b.unassisted_mastery, coalesce(b.unassisted_observations, 0), b.assisted_performance
      from chapters c
      left join lateral (
        select sum(cs.answer_observations)::int as answers,
               avg(cs.mastery)::float8 as mastery,
               (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8 as unassisted_mastery,
               sum(cs.unassisted_observations)::int as unassisted_observations,
               (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
                 as assisted_performance
          from public.concept_state cs join lms.outcome o on o.id = cs.outcome_id
         where cs.user_id = me and cs.answer_observations > 0
           and o.grade = sec.grade and o.subject = c.subject and o.chapter = c.chapter
      ) b on true
     order by c.subject, c.first;
end;
$$;

drop function if exists lms.student_subjects(uuid);
create function lms.student_subjects(p_student uuid)
returns table (
  subject_id uuid, subject_name text, teacher_name text, work_due integer, handed_in integer,
  handin_rate float8, average_score float8, mastery float8, chapters_seen integer,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
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
      select o.subject, o.chapter, cs.mastery, cs.unassisted_mastery, cs.unassisted_observations,
             cs.assisted_performance, cs.answer_observations
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
           (select count(distinct c.chapter)::int from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name)),
           (select (avg(c.unassisted_mastery) filter (where c.unassisted_observations > 0))::float8
              from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name)),
           (select coalesce(sum(c.unassisted_observations), 0)::int
              from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name)),
           (select (avg(c.assisted_performance) filter (where c.answer_observations > c.unassisted_observations))::float8
              from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name))
      from lms.teaching_assignment ta
      join lms.subject sub on sub.id = ta.subject_id
     where ta.section_id = sec.id and lms.may_see_subject(p_student, sub.id)
     group by sub.id, sub.name, sub.syllabus_subject
     order by sub.name;
end;
$$;

drop function if exists lms.school_overview();
create function lms.school_overview()
returns table (
  school_name text, students integer, teachers integer, classes integer, subjects integer,
  work_set_30d integer, handin_rate_30d float8, average_score_30d float8,
  active_students_7d integer, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
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
    ),
    b as (
      select avg(cs.mastery)::float8 as mastery,
             (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8 as unassisted_mastery,
             coalesce(sum(cs.unassisted_observations), 0)::int as unassisted_observations,
             (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
               as assisted_performance
        from public.concept_state cs
       where cs.org_id = org and cs.answer_observations > 0
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
           b.mastery, b.unassisted_mastery, b.unassisted_observations, b.assisted_performance
      from lms.school s cross join b
     where s.org_id = org;
end;
$$;

drop function if exists lms.school_classes();
create function lms.school_classes()
returns table (
  section_id uuid, subject_id uuid, class_name text, grade smallint, subject_name text, teacher_name text,
  teacher_login_id text, students integer, work_set integer, handin_rate float8, average_score float8, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
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
      select e.section_id, o.grade, o.subject, avg(cs.mastery)::float8 as mastery,
             (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8 as unassisted_mastery,
             sum(cs.unassisted_observations)::int as unassisted_observations,
             (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
               as assisted_performance
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
           ms.mastery,
           ms.unassisted_mastery,
           coalesce(ms.unassisted_observations, 0),
           ms.assisted_performance
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

drop function if exists lms.school_students(uuid);
create function lms.school_students(p_section uuid default null)
returns table (
  user_id uuid, display_name text, login_id text, section_id uuid, class_name text, roll_number text,
  work_due integer, handin_rate float8, average_score float8, mastery float8, last_active timestamptz,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
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
           b.mastery,
           (select max(le.at) from public.ledger_event le where le.user_id = a.user_id),
           b.unassisted_mastery,
           b.unassisted_observations,
           b.assisted_performance
      from lms.account a
      join lms.enrolment e on e.student_user_id = a.user_id and e.left_on is null
      join lms.section sec on sec.id = e.section_id
      left join f on f.student_user_id = a.user_id
      cross join lateral (
        select avg(cs.mastery)::float8 as mastery,
               (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8 as unassisted_mastery,
               coalesce(sum(cs.unassisted_observations), 0)::int as unassisted_observations,
               (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
                 as assisted_performance
          from public.concept_state cs
         where cs.user_id = a.user_id and cs.answer_observations > 0
      ) b
     where a.org_id = org and a.kind = 'student' and (p_section is null or sec.id = p_section)
     order by sec.grade, sec.name,
              case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last, a.display_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Has the brain read it yet?
-- ---------------------------------------------------------------------------

-- The events of one learner the brain has not read (2. above). Internal.
create or replace function lms.brain_unread(p_user uuid)
returns table (received_at timestamptz)
language sql stable security definer
set search_path = public, lms
as $$
  select le.received_at
    from public.ledger_event le
    left join public.learner_model lm on lm.user_id = le.user_id
   where le.user_id = p_user
     and (lm.folded_through_received_at is null
          or date_trunc('milliseconds', le.received_at) > date_trunc('milliseconds', lm.folded_through_received_at));
$$;

create or replace function lms.brain_status(p_student uuid)
returns table (last_answer_at timestamptz, waiting_since timestamptz, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  return query
    select (select max(le.received_at) from public.ledger_event le
             where le.user_id = p_student and le.kind = 'answered'),
           (select min(u.received_at) from lms.brain_unread(p_student) u),
           (select lm.updated_at from public.learner_model lm where lm.user_id = p_student);
end;
$$;

create or replace function lms.class_brain_status(p_section uuid, p_subject uuid)
returns table (updated_at timestamptz, waiting_since timestamptz, students_waiting integer)
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
    with roll as (
      select e.student_user_id as id from lms.enrolment e where e.section_id = p_section and e.left_on is null
    ),
    waiting as (
      select r.id, min(u.received_at) as since
        from roll r cross join lateral lms.brain_unread(r.id) u
       group by r.id
    )
    select (select max(lm.updated_at) from public.learner_model lm join roll r on r.id = lm.user_id),
           (select min(w.since) from waiting w),
           (select count(*)::int from waiting w);
end;
$$;

revoke all on function lms.my_progress() from public, anon;
revoke all on function lms.class_insights(uuid, uuid) from public, anon;
revoke all on function lms.student_chapters(uuid) from public, anon;
revoke all on function lms.practice_chapters() from public, anon;
revoke all on function lms.student_subjects(uuid) from public, anon;
revoke all on function lms.school_overview() from public, anon;
revoke all on function lms.school_classes() from public, anon;
revoke all on function lms.school_students(uuid) from public, anon;
revoke all on function lms.brain_unread(uuid) from public, anon, authenticated;
revoke all on function lms.brain_status(uuid) from public, anon;
revoke all on function lms.class_brain_status(uuid, uuid) from public, anon;

grant execute on function lms.my_progress() to authenticated, service_role;
grant execute on function lms.class_insights(uuid, uuid) to authenticated, service_role;
grant execute on function lms.student_chapters(uuid) to authenticated, service_role;
grant execute on function lms.practice_chapters() to authenticated, service_role;
grant execute on function lms.student_subjects(uuid) to authenticated, service_role;
grant execute on function lms.school_overview() to authenticated, service_role;
grant execute on function lms.school_classes() to authenticated, service_role;
grant execute on function lms.school_students(uuid) to authenticated, service_role;
grant execute on function lms.brain_unread(uuid) to service_role;
grant execute on function lms.brain_status(uuid) to authenticated, service_role;
grant execute on function lms.class_brain_status(uuid, uuid) to authenticated, service_role;
