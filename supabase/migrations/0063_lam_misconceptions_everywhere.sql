-- WRONG IDEAS, WHEREVER THEY WERE SHOWN (learner-model v4; lam-one-brain Task 4, review MF7).
--
-- The teacher's three lists of wrong ideas read only homework: per child in a
-- class (class_misconceptions, 0027), the class's likely ones with practice
-- for those children (class_likely_misconceptions, 0040) and a child's report
-- (student_misconceptions, 0031). They counted a single wrong answer, and
-- never saw what the tutor saw. Each now lists:
--
-- 1. FROM THE BRAIN, what concept_state.misconceptions (0060, written by
--    packages/lms-brain think()) holds confirmed and not cleared: a wrong idea
--    shown on two distinct questions or in two sittings, homework and tutor
--    alike, until two later right answers on distinct questions, alone, clear
--    it (packages/learner-model/src/misconception.ts). Its label is the
--    question bank's (lms.item.misconceptions); think() writes no other text,
--    so an idea the phone named in its own words reads "Repeated wrong idea
--    (from the tutor)", and the same wrong option of one question chosen in two
--    sittings with no label reads "Same wrong answer, chosen again". Never an
--    answer, never the phone's words.
-- 2. FROM HOMEWORK THE BRAIN HAS NOT READ YET, the rule each list had, with
--    the same two-or-more rule: the label chosen on two distinct questions or
--    in two hand-ins. A hand-in is read once learner_model's
--    folded_through_received_at (0061) has reached its submitted_at: its
--    ledger rows are written in the hand-in's own transaction, so they were
--    received at that same now(). Where nothing runs think() (the hosted
--    project today), every hand-in is unread and this is the whole list. Once
--    read, homework speaks through the brain, which is how a cleared idea
--    leaves every list.
--
-- One child, chapter and label is listed once (the larger count). Shapes and
-- who may call each function are unchanged. class_misconceptions is ordered
-- by how many children of the class show the idea, then the latest showing.
--
-- practice_items (0040) now matches a label by its id in the model
-- (lms.misconception_key), so practice catches the idea whether the teacher's
-- page sends the bank's wording or the brain's, which is cut at 120
-- characters.

-- A label as the model's id for it (misconception.ts normaliseMisconception):
-- its first 120 characters, lower case, each run of characters that are not
-- letters or digits one space, trimmed. The same id for labels in Latin
-- letters and digits; '' when nothing is left.
create or replace function lms.misconception_key(p_label text)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(lower(left(coalesce(p_label, ''), 120)), '[^[:alnum:]]+', ' ', 'g'));
$$;

-- The wrong ideas the brain holds confirmed and not cleared for one learner,
-- per outcome, labelled as 1. above says. Internal: it reads anyone's model.
create or replace function lms.brain_misconceptions(p_user uuid)
returns table (outcome_id text, label text, times integer, items text[], last_at timestamptz)
language sql stable security definer
set search_path = public, lms
as $$
  select cs.outcome_id,
         case
           when nullif(btrim(m.value ->> 'label'), '') is not null then btrim(m.value ->> 'label')
           when m.key like 'option:%' then 'Same wrong answer, chosen again'
           else 'Repeated wrong idea (from the tutor)'
         end,
         coalesce((m.value ->> 'count')::int, 0),
         array(select jsonb_array_elements_text(
           case when jsonb_typeof(m.value -> 'items') = 'array' then m.value -> 'items' else '[]'::jsonb end)),
         (m.value ->> 'lastAt')::timestamptz
    from public.concept_state cs
    cross join lateral jsonb_each(cs.misconceptions) as m(key, value)
   where cs.user_id = p_user
     and jsonb_typeof(m.value) = 'object'
     and m.value ->> 'clearedAt' is null
     and greatest(
           case when jsonb_typeof(m.value -> 'items') = 'array' then jsonb_array_length(m.value -> 'items') else 0 end,
           case when jsonb_typeof(m.value -> 'sittings') = 'array' then jsonb_array_length(m.value -> 'sittings') else 0 end
         ) >= 2;
$$;

-- Whether think() has read what this learner handed in at `p_at` (2. above). Internal.
create or replace function lms.brain_has_read(p_user uuid, p_at timestamptz)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from public.learner_model lm
     where lm.user_id = p_user and lm.folded_through_received_at >= p_at
  );
$$;

-- 0040's, matching the label by its id in the model.
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
                where lms.misconception_key(m.label) <> ''
                  and lms.misconception_key(m.label) = lms.misconception_key(p_misconception)
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

-- 0027's: each child of the class now and the wrong ideas they show, from
-- the brain and from homework it has not read, two or more each.
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
  sub lms.subject;
begin
  select * into sec from lms.section where id = p_section;
  select * into sub from lms.subject where id = p_subject;
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
      select l.id as submission_id, l.student_user_id, l.submitted_at, sa.item_id,
             nullif(btrim(i.misconceptions ->> sa.chosen_index::int), '') as idea,
             (select o.chapter from lms.outcome o where o.id = any (i.outcome_ids) order by o.position limit 1) as chap
        from latest l
        join lms.submission_answer sa on sa.submission_id = l.id and not sa.correct and sa.chosen_index is not null
        join lms.item i on i.id = sa.item_id
    ),
    from_homework as (
      select sh.student_user_id, sh.chap, sh.idea, count(*)::int as n, max(sh.submitted_at) as last_seen
        from shown sh
       where sh.idea is not null
       group by sh.student_user_id, sh.chap, sh.idea
      having (count(distinct sh.item_id) >= 2 or count(distinct sh.submission_id) >= 2)
         and not lms.brain_has_read(sh.student_user_id, max(sh.submitted_at))
    ),
    from_brain as (
      select e.student_user_id, o.chapter as chap, b.label as idea, sum(b.times)::int as n, max(b.last_at) as last_seen
        from lms.enrolment e
        cross join lateral lms.brain_misconceptions(e.student_user_id) b
        join lms.outcome o on o.id = b.outcome_id
                          and o.grade = sec.grade
                          and o.subject = coalesce(sub.syllabus_subject, sub.name)
       where e.section_id = p_section and e.left_on is null
       group by e.student_user_id, o.chapter, b.label
    ),
    together as (
      select t.student_user_id, t.chap, t.idea, max(t.n)::int as n, max(t.last_seen) as last_seen
        from (select * from from_homework union all select * from from_brain) t
       group by t.student_user_id, t.chap, t.idea
    )
    select tg.student_user_id, a.display_name, e.roll_number, tg.chap, tg.idea, tg.n, tg.last_seen
      from together tg
      join lms.enrolment e on e.student_user_id = tg.student_user_id and e.section_id = p_section and e.left_on is null
      join lms.account a on a.user_id = tg.student_user_id
     order by count(*) over (partition by tg.chap, tg.idea) desc, tg.last_seen desc, a.display_name, tg.idea;
end;
$$;

-- 0040's: the wrong ideas children of the class show now. From homework the
-- brain has not read, a child shows one when they chose it the latest time
-- they met a question that catches it and chose it on two questions or in
-- two hand-ins; from the brain, when it holds it confirmed and not cleared.
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
      select l.student_user_id, l.id as submission_id, l.submitted_at, sa.item_id,
             (select o.chapter from lms.outcome o where o.id = any (i.outcome_ids) order by o.position limit 1) as chap,
             btrim(m.label) as idea,
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
      select mt.student_user_id, mt.chap, mt.idea, mt.submission_id, mt.submitted_at, bool_or(mt.chose) as chose
        from met mt
       where mt.chap is not null
       group by mt.student_user_id, mt.chap, mt.idea, mt.submission_id, mt.submitted_at
    ),
    latest_occasion as (
      select distinct on (o.student_user_id, o.chap, o.idea) o.student_user_id, o.chap, o.idea, o.chose, o.submitted_at
        from occasion o
       order by o.student_user_id, o.chap, o.idea, o.submitted_at desc, o.submission_id
    ),
    -- Chosen on two questions, or in two hand-ins.
    repeated as (
      select mt.student_user_id, mt.chap, mt.idea
        from met mt
       where mt.chose and mt.chap is not null
       group by mt.student_user_id, mt.chap, mt.idea
      having count(distinct mt.item_id) >= 2 or count(distinct mt.submission_id) >= 2
    ),
    shows as (
      select lo.student_user_id, lo.chap, lo.idea
        from latest_occasion lo
        join repeated r on r.student_user_id = lo.student_user_id and r.chap = lo.chap and r.idea = lo.idea
       where lo.chose and not lms.brain_has_read(lo.student_user_id, lo.submitted_at)
      union
      select e.student_user_id, o.chapter, b.label
        from lms.enrolment e
        cross join lateral lms.brain_misconceptions(e.student_user_id) b
        join lms.outcome o on o.id = b.outcome_id
                          and o.grade = sec.grade
                          and o.subject = coalesce(sub.syllabus_subject, sub.name)
       where e.section_id = p_section and e.left_on is null
    )
    select sh.chap, sh.idea, count(*)::int,
           jsonb_agg(
             jsonb_build_object('studentUserId', e.student_user_id, 'displayName', acc.display_name, 'rollNumber', e.roll_number)
             order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
                      e.roll_number nulls last, acc.display_name
           ),
           (select count(*)::int from lms.practice_items(p_section, p_subject, sh.chap, sh.idea))
      from shows sh
      join lms.enrolment e on e.student_user_id = sh.student_user_id and e.section_id = p_section and e.left_on is null
      join lms.account acc on acc.user_id = sh.student_user_id and acc.left_at is null
     group by sh.chap, sh.idea
     order by count(*) desc, sh.chap, sh.idea;
end;
$$;

-- 0031's: the wrong ideas a child's answers point to, most repeated first,
-- from the brain and from homework it has not read, two or more each. The
-- child is not shown one from a test whose results are not out: from
-- homework, as before; from the brain, any idea one of whose questions is on
-- such a test they sat.
create or replace function lms.student_misconceptions(p_student uuid)
returns table (subject text, chapter text, label text, times integer)
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
    with answered as (
      select s.id as submission_id, s.submitted_at, sa.item_id, i.subject as subj,
             (select o.chapter from lms.outcome o where o.id = any (i.outcome_ids) order by o.position limit 1) as chap,
             nullif(btrim(i.misconceptions ->> sa.chosen_index::int), '') as idea
        from lms.submission s
        join lms.assignment a on a.id = s.assignment_id
        join lms.submission_answer sa on sa.submission_id = s.id and not sa.correct and sa.chosen_index is not null
        join lms.item i on i.id = sa.item_id
       where s.student_user_id = p_student and s.kind = 'mcq'
         and (a.kind <> 'test' or a.results_released_at is not null or p_student <> auth.uid())
         and lms.may_see_subject(p_student, a.subject_id)
    ),
    from_homework as (
      select an.subj, an.chap, an.idea, count(*)::int as n
        from answered an
       where an.idea is not null
       group by an.subj, an.chap, an.idea
      having (count(distinct an.item_id) >= 2 or count(distinct an.submission_id) >= 2)
         and not lms.brain_has_read(p_student, max(an.submitted_at))
    ),
    from_brain as (
      select o.subject as subj, o.chapter as chap, b.label as idea, sum(b.times)::int as n
        from lms.brain_misconceptions(p_student) b
        join lms.outcome o on o.id = b.outcome_id
       where o.grade = sec.grade
         and exists (
           select 1 from lms.teaching_assignment ta join lms.subject sub on sub.id = ta.subject_id
            where ta.section_id = sec.id and coalesce(sub.syllabus_subject, sub.name) = o.subject
              and lms.may_see_subject(p_student, sub.id)
         )
         and not (p_student = auth.uid() and exists (
           select 1 from lms.submission s
             join lms.assignment a on a.id = s.assignment_id and a.kind = 'test' and a.results_released_at is null
             join lms.assignment_item ai on ai.assignment_id = a.id
             join lms.item i on i.id = ai.item_id
            where s.student_user_id = p_student
              and ('probe:' || i.library_ref = any (b.items) or 'item:' || i.id::text = any (b.items))
         ))
       group by o.subject, o.chapter, b.label
    )
    select t.subj, t.chap, t.idea, max(t.n)::int
      from (select * from from_homework union all select * from from_brain) t
     group by t.subj, t.chap, t.idea
     order by max(t.n) desc, t.idea
     limit 20;
end;
$$;

revoke all on function lms.misconception_key(text) from public, anon, authenticated;
revoke all on function lms.brain_misconceptions(uuid) from public, anon, authenticated;
revoke all on function lms.brain_has_read(uuid, timestamptz) from public, anon, authenticated;
grant execute on function lms.misconception_key(text) to service_role;
grant execute on function lms.brain_misconceptions(uuid) to service_role;
grant execute on function lms.brain_has_read(uuid, timestamptz) to service_role;
