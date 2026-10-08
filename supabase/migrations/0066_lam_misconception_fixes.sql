-- WRONG IDEAS: TEST SECRECY IN PRACTICE, NO STOCK-LABEL CLUSTERS (lam-one-brain
-- M1 review).
--
-- 1. lms.brain_misconceptions (0063) also says whether an idea is NAMED: its
--    label is the question bank's (think() writes no other text), rather than
--    one of the two stock labels it stands in for an idea with no text.
-- 2. lms.class_likely_misconceptions (0063) lists only named ideas from the
--    brain. It groups by chapter and label, so every text-less idea of every
--    child read as one shared "Repeated wrong idea (from the tutor)" with a
--    summed count, and its practice was whatever the chapter held, matching
--    nothing. A text-less idea stays on the per-child lists
--    (class_misconceptions, student_misconceptions). Every label left is the
--    bank's, so it matches a bank option.
-- 3. lms.practice_for_me (0064) targets only named ideas, and not one whose
--    questions are on a test the child sat whose results are not out: the
--    same exclusion lms.student_misconceptions (0063) makes for the child's
--    own report. Before this, "watch out for: <label>" told a child which
--    wrong option they picked on a test before its release.
--
-- Bodies otherwise 0063's and 0064's.

-- Its result gains a column, so it is dropped and made again. The functions
-- that call it name the columns they read.
drop function if exists lms.brain_misconceptions(uuid);

create function lms.brain_misconceptions(p_user uuid)
returns table (outcome_id text, label text, times integer, items text[], last_at timestamptz, named boolean)
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
         (m.value ->> 'lastAt')::timestamptz,
         nullif(btrim(m.value ->> 'label'), '') is not null
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

-- 0063's, with only named ideas from the brain (2. above).
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
       where e.section_id = p_section and e.left_on is null and b.named
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

-- 0064's, with the ideas it targets cut as 3. above says.
create or replace function lms.practice_for_me(p_subject text default null, p_count integer default 5)
returns table (
  item_id uuid, stem text, options jsonb, subject text, chapter text,
  outcome_id text, outcome_title text, reason text, watch_out text
)
language sql volatile security definer
set search_path = public, lms
as $$
  with me as (select auth.uid() as id),
  ideas as (
    select distinct lms.misconception_key(b.label) as key
      from me cross join lateral lms.brain_misconceptions(me.id) b
     where b.named and lms.misconception_key(b.label) <> ''
       and not exists (
         select 1 from lms.submission s
           join lms.assignment a on a.id = s.assignment_id and a.kind = 'test' and a.results_released_at is null
           join lms.assignment_item ai on ai.assignment_id = a.id
           join lms.item i on i.id = ai.item_id
          where s.student_user_id = me.id
            and ('probe:' || i.library_ref = any (b.items) or 'item:' || i.id::text = any (b.items))
       )
  ),
  met as (
    select distinct le.payload ->> 'itemId' as item
      from me join public.ledger_event le on le.user_id = me.id
     where le.source in ('homework', 'test', 'practice') and le.kind = 'answered'
  ),
  pool as (
    select p.item_id, p.subject, p.chapter
      from me cross join lateral lms.practice_pool(me.id) p
     where p_subject is null or p.subject = p_subject
  ),
  facts as (
    select i.id, i.stem, i.options, pool.subject, pool.chapter,
           w.label as watch_out, o.outcome_id, o.due, o.observed, o.alone, o.strong,
           exists (select 1 from met x where x.item = i.id::text) as met
      from pool
      join lms.item i on i.id = pool.item_id
      left join lateral (
        select btrim(m.label) as label
          from jsonb_array_elements_text(
                 case when jsonb_typeof(i.misconceptions) = 'array' then i.misconceptions else '[]'::jsonb end
               ) with ordinality as m(label, n)
         where m.n - 1 <> i.correct_index
           and lms.misconception_key(m.label) in (select key from ideas)
         order by m.n
         limit 1
      ) w on true
      left join lateral (
        select x.oid as outcome_id,
               coalesce(cs.box is not null and cs.next_review_at <= now(), false) as due,
               coalesce(cs.answer_observations, 0) > 0 as observed,
               case when cs.unassisted_observations > 0 then cs.unassisted_mastery::float8 end as alone,
               coalesce(cs.unassisted_observations >= 3 and cs.unassisted_mastery >= 0.7, false) as strong
          from unnest(i.outcome_ids) as x(oid)
          left join public.concept_state cs on cs.user_id = (select id from me) and cs.outcome_id = x.oid
         order by coalesce(cs.box is not null and cs.next_review_at <= now(), false) desc,
                  case when coalesce(cs.answer_observations, 0) = 0 then 0.5
                       when cs.unassisted_observations > 0 then cs.unassisted_mastery::float8
                       else 0 end,
                  x.oid
         limit 1
      ) o on true
  ),
  ranked as (
    select f.*,
           case
             when f.watch_out is not null then 'misconception'
             when f.due then 'review'
             when f.observed and not f.strong then 'weak'
             when not f.observed then 'new'
             else 'more'
           end as why
      from facts f
  )
  select r.id, r.stem, r.options, r.subject, r.chapter, r.outcome_id, oc.title, r.why, r.watch_out
    from ranked r
    left join lms.outcome oc on oc.id = r.outcome_id
   order by array_position(array['misconception', 'review', 'weak', 'new', 'more'], r.why),
            case when not r.observed then 0.5 else coalesce(r.alone, 0) end,
            r.met,
            random()
   limit least(greatest(coalesce(p_count, 5), 1), 20);
$$;

revoke all on function lms.brain_misconceptions(uuid) from public, anon, authenticated;
grant execute on function lms.brain_misconceptions(uuid) to service_role;
revoke all on function lms.practice_for_me(text, integer) from public, anon;
grant execute on function lms.practice_for_me(text, integer) to authenticated, service_role;
