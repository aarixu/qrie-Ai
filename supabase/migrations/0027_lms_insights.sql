-- WHAT THE BRAIN BELIEVES, SHOWN TO THE PEOPLE IT IS FOR — LMS build plan, L6.
--
-- public.concept_state holds, per student and outcome, what the fold
-- believes (0013; written server-side by packages/lms-brain). This migration
-- lets a teacher read it for their own class, grouped by chapter, and lets a
-- student read their own. It also names the misconceptions a student's own
-- wrong answers point to: each library distractor was written to catch one
-- (lms.item.misconceptions), so a child who picks it has shown that error —
-- evidence, not inference.
--
-- Written against packages/lms-brain/tests/insights.test.ts, first. The
-- claim that these numbers mean something is tested separately, against a
-- demo school with KNOWN planted misconceptions (tools/lms-demo/tests).

-- ---------------------------------------------------------------------------
-- The curriculum's outcomes: which class, subject and chapter each is in.
-- Loaded from the knowledge-graph maps (packages/lms-brain, loadOutcomes) —
-- the same maps the library's questions name. Curriculum, not anyone's data,
-- so every signed-in person may read it.
-- ---------------------------------------------------------------------------

create table if not exists lms.outcome (
  id text primary key,
  grade smallint not null check (grade between 1 and 12),
  subject text not null check (char_length(subject) between 1 and 60),
  chapter text not null check (char_length(chapter) between 1 and 120),
  title text not null check (char_length(title) between 1 and 300)
);
create index if not exists outcome_class_idx on lms.outcome (grade, subject, chapter);

grant select on lms.outcome to authenticated;
grant all on lms.outcome to service_role;
revoke all on lms.outcome from anon;
alter table lms.outcome enable row level security;
drop policy if exists "the curriculum is readable by anyone signed in" on lms.outcome;
create policy "the curriculum is readable by anyone signed in" on lms.outcome
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- A class's standing, per student and chapter.
--
-- SECURITY DEFINER because concept_state lets a student read only their own
-- rows (0013) and gives teachers nothing; the check below is the whole of
-- who may see it: the class's teacher, or the school's admin.
--
-- Only outcomes the student has ANSWERED count (answer_observations > 0):
-- propagation moves beliefs about outcomes nobody asked, and showing those
-- as a standing would be showing a guess as a measurement.
-- ---------------------------------------------------------------------------

create or replace function lms.class_insights(p_section uuid, p_subject uuid)
returns table (
  student_user_id uuid, display_name text, roll_number text, chapter text,
  outcomes_seen integer, answers integer, mastery float8, unassisted_mastery float8
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
           avg(cs.mastery)::float8, avg(cs.unassisted_mastery)::float8
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

-- The misconceptions a class's students have shown: each wrong answer, on
-- their latest attempt at this class's published homework, whose chosen
-- option carries a label — counted per student and label.
create or replace function lms.class_misconceptions(p_section uuid, p_subject uuid)
returns table (
  student_user_id uuid, display_name text, roll_number text, chapter text,
  label text, times integer, last_at timestamptz
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
    with latest as (
      select distinct on (s.assignment_id, s.student_user_id) s.id, s.student_user_id, s.submitted_at
        from lms.submission s
        join lms.assignment asg on asg.id = s.assignment_id
       where asg.section_id = p_section and asg.subject_id = p_subject
         and asg.published_at is not null and s.kind = 'mcq'
       order by s.assignment_id, s.student_user_id, s.attempt desc
    ),
    shown as (
      select l.student_user_id, l.submitted_at,
             nullif(btrim(i.misconceptions ->> sa.chosen_index::int), '') as label,
             (select o.chapter from lms.outcome o where o.id = any (i.outcome_ids) limit 1) as chapter
        from latest l
        join lms.submission_answer sa on sa.submission_id = l.id and not sa.correct and sa.chosen_index is not null
        join lms.item i on i.id = sa.item_id
    )
    select sh.student_user_id, a.display_name, e.roll_number, sh.chapter, sh.label,
           count(*)::int, max(sh.submitted_at)
      from shown sh
      join lms.enrolment e on e.student_user_id = sh.student_user_id and e.section_id = p_section and e.left_on is null
      join lms.account a on a.user_id = sh.student_user_id
     where sh.label is not null
     group by sh.student_user_id, a.display_name, e.roll_number, sh.chapter, sh.label
     order by count(*) desc, a.display_name, sh.label;
end;
$$;

-- A student's own standing, per subject and chapter. Invoker: concept_state
-- already lets a student read their own rows, and only those.
create or replace function lms.my_progress()
returns table (
  grade smallint, subject text, chapter text, outcomes_seen integer, answers integer, mastery float8
)
language sql stable security invoker
set search_path = public, lms
as $$
  select o.grade, o.subject, o.chapter, count(*)::int, sum(cs.answer_observations)::int, avg(cs.mastery)::float8
    from public.concept_state cs
    join lms.outcome o on o.id = cs.outcome_id
   where cs.user_id = auth.uid() and cs.answer_observations > 0
   group by o.grade, o.subject, o.chapter
   order by o.subject, o.grade, o.chapter;
$$;

revoke all on function lms.class_insights(uuid, uuid) from public, anon;
revoke all on function lms.class_misconceptions(uuid, uuid) from public, anon;
revoke all on function lms.my_progress() from public, anon;
grant execute on function lms.class_insights(uuid, uuid) to authenticated, service_role;
grant execute on function lms.class_misconceptions(uuid, uuid) to authenticated, service_role;
grant execute on function lms.my_progress() to authenticated, service_role;
