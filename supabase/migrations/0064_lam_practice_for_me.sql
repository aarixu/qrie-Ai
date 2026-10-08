-- PRACTICE PICKED FROM THE CHILD'S OWN EVIDENCE (learner-model v4;
-- lam-one-brain Task 5, truth test D14, D15, D18; review SF14).
--
-- lms.practice_questions (0031) hands out a chapter's questions in a random
-- order, whatever the child has shown, and lms.check_practice_answer (0031)
-- files every practice answer as given alone (assistanceRung 0) although it
-- returns the right option with every answer, so the second time a child
-- meets a practice question they have been shown its answer. The same holds
-- for a question they met on homework: practice holds a homework's questions
-- only once it is past due (lms.practice_pool, 0034), and from then on the
-- child's review shows its right answers (lms.my_review, 0029).
--
-- 1. lms.practice_for_me(p_subject, p_count): the questions the child may
--    practise (lms.practice_pool, 0034), of one subject or of all when
--    p_subject is null, at most 20, ranked by what concept_state holds for
--    them (written by packages/lms-brain think()):
--      'misconception'  a question with a wrong option written to catch a
--                       wrong idea the brain holds confirmed and not cleared
--                       for them (lms.brain_misconceptions, 0063; matched by
--                       lms.misconception_key); watch_out is that option's
--                       label in the bank's words;
--      'review'         one of its outcomes is due for spaced review
--                       (concept_state.box set and next_review_at passed);
--      'weak'           an outcome they have answered and the student app
--                       does not call Strong (apps/student/src/features/
--                       standing.ts standingOf): under 3 answers given alone
--                       (FEW_ANSWERS), or unassisted mastery under 0.7
--                       (STRONG; both in components/mastery-info.tsx);
--      'new'            an outcome they have not answered;
--      'more'           the rest.
--    Within a reason, the weaker outcome alone first (help-only counts as
--    nothing alone; a new outcome as 0.5), then a question they have not
--    answered before (in practice or on homework, as 2. below), then a
--    random order. A question's outcome is its due
--    one, else its weakest. Stem and options only, as practice_questions:
--    never the answer.
-- 2. lms.check_practice_answer: as 0031, except that an answer to a question
--    the child has answered before, in practice or on homework (or a test,
--    which practice never holds), is filed at assistanceRung 1 (a nudge, not
--    cold), so the fold does not count it toward what they can do alone
--    (packages/learner-model rung.ts: rung 0 only is unassisted).

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
     where lms.misconception_key(b.label) <> ''
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

revoke all on function lms.practice_for_me(text, integer) from public, anon;
grant execute on function lms.practice_for_me(text, integer) to authenticated, service_role;

-- 0031's, with an answer to a question already answered (2. above) filed as helped.
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
  shown_before boolean;
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
  -- Practice shows the right option with every answer, and a past-due
  -- homework's review shows its right answers, so this child has been shown
  -- this question's answer if they have answered it before in either.
  shown_before := exists (
    select 1 from public.ledger_event le
     where le.user_id = me and le.source in ('homework', 'test', 'practice') and le.kind = 'answered'
       and le.payload ->> 'itemId' = it.id::text
  );
  right_answer := p_chosen = it.correct_index;
  select coalesce(max(le.seq), 0) + 1 into n_seq from public.ledger_event le where le.session_id = p_session;
  insert into public.ledger_event
    (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
  values (
    gen_random_uuid(), org, me, p_session, n_seq, now(), 'answered', 'practice', 'tap', it.outcome_ids,
    jsonb_build_object(
      'correct', right_answer, 'chosenIndex', p_chosen, 'itemId', it.id,
      'assistanceRung', case when shown_before then 1 else 0 end
    )
  );
  return query select right_answer, it.correct_index,
    case when right_answer then null else nullif(btrim(it.misconceptions ->> p_chosen), '') end;
end;
$$;

revoke all on function lms.check_practice_answer(uuid, uuid, integer) from public, anon;
