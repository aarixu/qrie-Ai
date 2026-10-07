-- THE QUESTION BANK, BY CHAPTER AND TOPIC.
--
-- A teacher looks for questions the way the syllabus is laid out: class and
-- subject, then chapter, then topic. lms.outcome (0027) already knows each
-- outcome's chapter; it gains the order the syllabus teaches them in, and the
-- bank gains chapter and topic filters, a list of chapters and topics with
-- how many questions each has, and a teacher's own question filed under a
-- topic — which also makes it evidence the brain can use (0027).
--
-- Written against packages/lms-client/tests/bank.test.ts, first.

-- The position of the outcome in its map, which lists chapters, and the
-- topics within each, in the order NCERT teaches them. Written by the
-- loaders (tools/lms-library, packages/lms-brain loadOutcomes).
alter table lms.outcome add column if not exists position integer not null default 0;

-- The bank, now also by chapter and by topic, each question saying where it
-- sits. Replaces 0026's version (a different argument list is a different
-- function, so the old one is dropped rather than left beside it).
drop function if exists lms.library(integer, text, text, integer, integer);
create or replace function lms.library(
  p_grade integer default null,
  p_subject text default null,
  p_query text default null,
  p_chapter text default null,
  p_outcome text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, source text, grade smallint, subject text, kind text, stem text,
  options jsonb, correct_index smallint, outcome_ids text[], approved boolean,
  chapter text, topic text
)
language sql stable security invoker
set search_path = public, lms
as $$
  select i.id,
         case when i.org_id is null then 'library' else 'school' end,
         i.grade, i.subject, i.kind, i.stem, i.options, i.correct_index, i.outcome_ids,
         exists (select 1 from lms.item_approval ap
                  where ap.item_id = i.id and ap.org_id = public.current_org_id()),
         o.chapter, o.title
    from lms.item i
    left join lms.outcome o on o.id = i.outcome_ids[1]
   where (p_grade is null or i.grade = p_grade)
     and (p_subject is null or i.subject = p_subject)
     and (p_query is null or i.stem ilike
            '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     and (p_chapter is null or exists (
            select 1 from lms.outcome c where c.id = any (i.outcome_ids) and c.chapter = p_chapter))
     and (p_outcome is null or p_outcome = any (i.outcome_ids))
   order by (i.org_id is null), o.position nulls last, i.created_at desc, i.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Every chapter and topic of a class and subject, in syllabus order, with
-- the number of questions on each that the caller can see.
create or replace function lms.library_topics(p_grade integer, p_subject text)
returns table (chapter text, outcome_id text, title text, questions integer)
language sql stable security invoker
set search_path = public, lms
as $$
  with counts as (
    select x.oid, count(*)::int as n
      from lms.item i, unnest(i.outcome_ids) as x(oid)
     where i.grade = p_grade and i.subject = p_subject and i.kind = 'mcq'
     group by x.oid
  ),
  chapters as (
    select o.chapter, min(o.position) as first
      from lms.outcome o
     where o.grade = p_grade and o.subject = p_subject
     group by o.chapter
  )
  select o.chapter, o.id, o.title, coalesce(c.n, 0)
    from lms.outcome o
    join chapters ch on ch.chapter = o.chapter
    left join counts c on c.oid = o.id
   where o.grade = p_grade and o.subject = p_subject
   order by ch.first, o.position;
$$;

-- A teacher's own question, now filed under a topic of the same class and
-- subject when they choose one. Replaces 0026's version.
drop function if exists lms.write_item(integer, text, text, text, jsonb, integer);
create or replace function lms.write_item(
  p_grade integer,
  p_subject text,
  p_stem text,
  p_kind text default 'mcq',
  p_options jsonb default null,
  p_correct_index integer default null,
  p_outcome text default null
)
returns uuid
language plpgsql volatile security invoker
set search_path = public, lms
as $$
declare
  new_id uuid;
begin
  if p_outcome is not null and not exists (
    select 1 from lms.outcome o where o.id = p_outcome and o.grade = p_grade and o.subject = p_subject
  ) then
    raise exception 'that is not a Class % % topic', p_grade, p_subject;
  end if;
  insert into lms.item (org_id, grade, subject, kind, stem, options, correct_index, outcome_ids, created_by)
  values (public.current_org_id(), p_grade, p_subject, p_kind, p_stem, p_options, p_correct_index,
          case when p_outcome is null then '{}'::text[] else array[p_outcome] end, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function lms.library(integer, text, text, text, text, integer, integer) from public, anon;
revoke all on function lms.library_topics(integer, text) from public, anon;
revoke all on function lms.write_item(integer, text, text, text, jsonb, integer, text) from public, anon;
grant execute on function lms.library(integer, text, text, text, text, integer, integer) to authenticated, service_role;
grant execute on function lms.library_topics(integer, text) to authenticated, service_role;
grant execute on function lms.write_item(integer, text, text, text, jsonb, integer, text) to authenticated, service_role;
