-- AI-DRAFTED QUESTIONS WAIT FOR THEIR TEACHER.
--
-- A teacher (or the admin) asks an AI for a few multiple-choice questions on
-- a chapter or topic (packages/lms-client drafts.ts, through the relay). What
-- comes back is only a DRAFT: it waits in the queue of the person who asked,
-- and nobody else sees it — not the class, not other teachers, not the admin.
-- Adding a draft, as the teacher edited it, makes it that teacher's own
-- question, approved for the school by 0023's approve_own_item and able to be
-- set; discarding it deletes it. Nothing an AI wrote reaches a child without
-- a teacher adding it first.
--
-- A draft is checked as a question is before it is kept, and again as edited
-- when it is added: a stem of 1 to 2000 characters, 2 to 6 options of 1 to
-- 200 characters with no two the same, one right, and for each option the
-- mistake it catches (0040 reads these) of 120 characters at most, '' for
-- none. Spaces, line breaks and the like around any text do not count
-- (0038's trim_space). 1 to 10 drafts are kept at a time and 100 at most wait
-- for any one person. The item remembers the model that drafted it.
--
-- Written against packages/lms-client/tests/item-drafts.test.ts, first.

alter table lms.item add column if not exists ai_model text
  check (ai_model is null or char_length(ai_model) between 1 and 80);

create table if not exists lms.item_draft (
  id uuid primary key default gen_random_uuid(),
  -- Newest first, and in the order a batch was given.
  n bigint generated always as identity,
  org_id uuid not null references lms.school on delete cascade,
  created_by uuid not null references auth.users on delete cascade,
  grade smallint not null check (grade between 1 and 12),
  subject text not null check (char_length(subject) between 1 and 60),
  outcome_id text references lms.outcome on delete set null,
  stem text not null check (char_length(stem) between 1 and 2000),
  options jsonb not null,
  correct_index smallint not null,
  misconceptions jsonb,
  model text not null check (char_length(model) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists item_draft_owner on lms.item_draft (created_by, n desc);

-- Reached only through the functions below.
revoke all on lms.item_draft from public, anon, authenticated;
grant all on lms.item_draft to service_role;
alter table lms.item_draft enable row level security;

-- The question's parts tidied, or null when they do not make a usable
-- question (see the rules above). Internal.
create or replace function lms.usable_question(p_stem text, p_options jsonb, p_correct integer, p_labels jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, lms
as $$
declare
  stem text := lms.trim_space(p_stem);
  options text[];
  labels text[];
  i integer;
begin
  if char_length(stem) not between 1 and 2000 or jsonb_typeof(p_options) is distinct from 'array'
     or jsonb_array_length(p_options) not between 2 and 6 then
    return null;
  end if;
  select array_agg(lms.trim_space(case when jsonb_typeof(o) = 'string' then o #>> '{}' end) order by k)
    into options
    from jsonb_array_elements(p_options) with ordinality x(o, k);
  if exists (select 1 from unnest(options) o where char_length(coalesce(o, '')) not between 1 and 200)
     or (select count(distinct lower(o)) from unnest(options) o) <> cardinality(options) then
    return null;
  end if;
  if p_correct is null or p_correct < 0 or p_correct >= cardinality(options) then
    return null;
  end if;
  if p_labels is not null then
    if jsonb_typeof(p_labels) <> 'array' or jsonb_array_length(p_labels) <> cardinality(options) then
      return null;
    end if;
    select array_agg(lms.trim_space(case when jsonb_typeof(l) = 'string' then l #>> '{}' end) order by k)
      into labels
      from jsonb_array_elements(p_labels) with ordinality x(l, k);
    if exists (select 1 from unnest(labels) l where l is null or char_length(l) > 120) then
      return null;
    end if;
    -- The right option catches no mistake.
    labels[p_correct + 1] := '';
  end if;
  return jsonb_build_object('stem', stem, 'options', to_jsonb(options), 'correct', p_correct,
                            'labels', case when labels is null then null else to_jsonb(labels) end);
end;
$$;

create or replace function lms.save_item_drafts(
  p_grade integer, p_subject text, p_outcome text, p_model text, p_drafts jsonb
)
returns integer
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := public.current_org_id();
  q jsonb;
  d jsonb;
  k integer := 0;
begin
  if org is null or not lms.is_staff(org) then
    raise exception 'only a teacher or the school admin can keep drafted questions';
  end if;
  if p_grade is null or p_grade not between 1 and 12 then
    raise exception 'a draft is for Class 1 to 12';
  end if;
  if char_length(lms.trim_space(p_subject)) not between 1 and 60 then
    raise exception 'a draft needs its subject';
  end if;
  if p_outcome is not null and not exists (
    select 1 from lms.outcome o where o.id = p_outcome and o.grade = p_grade and o.subject = p_subject
  ) then
    raise exception 'that is not a Class % % topic', p_grade, p_subject;
  end if;
  if char_length(lms.trim_space(p_model)) not between 1 and 80 then
    raise exception 'a draft says which model wrote it';
  end if;
  if jsonb_typeof(p_drafts) is distinct from 'array' or jsonb_array_length(p_drafts) not between 1 and 10 then
    raise exception 'keep 1 to 10 drafts at a time';
  end if;
  if (select count(*) from lms.item_draft x where x.created_by = auth.uid()) + jsonb_array_length(p_drafts) > 100 then
    raise exception '100 drafts are waiting for you; add or discard some first';
  end if;

  for d in select value from jsonb_array_elements(p_drafts) loop
    k := k + 1;
    q := lms.usable_question(d ->> 'stem', d -> 'options',
                             case when jsonb_typeof(d -> 'correctIndex') = 'number'
                                  and (d ->> 'correctIndex') ~ '^[0-9]+$' then (d ->> 'correctIndex')::int end,
                             d -> 'misconceptions');
    if q is null then
      raise exception 'draft % is not a usable question', k;
    end if;
    insert into lms.item_draft (org_id, created_by, grade, subject, outcome_id, stem, options, correct_index, misconceptions, model)
    values (org, auth.uid(), p_grade, lms.trim_space(p_subject), p_outcome, q ->> 'stem', q -> 'options',
            (q ->> 'correct')::smallint, q -> 'labels', lms.trim_space(p_model));
  end loop;
  return k;
end;
$$;

-- The caller's own drafts at their school, newest first.
create or replace function lms.my_item_drafts()
returns table (
  draft_id uuid, grade smallint, subject text, outcome_id text, chapter text, topic text,
  stem text, options jsonb, correct_index smallint, misconceptions jsonb, model text, created_at timestamptz
)
language sql stable security definer
set search_path = public, lms
as $$
  select x.id, x.grade, x.subject, x.outcome_id, o.chapter, o.title,
         x.stem, x.options, x.correct_index, x.misconceptions, x.model, x.created_at
    from lms.item_draft x
    left join lms.outcome o on o.id = x.outcome_id
   where x.created_by = auth.uid()
     and x.org_id = public.current_org_id()
     and lms.is_staff(x.org_id)
   order by x.n desc;
$$;

-- The draft, if it is the caller's own at their school and they are still
-- staff there; else a refusal. Internal.
create or replace function lms.own_draft(p_draft uuid)
returns lms.item_draft
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  found lms.item_draft;
begin
  select * into found from lms.item_draft x
   where x.id = p_draft and x.created_by = auth.uid()
     and x.org_id = public.current_org_id() and lms.is_staff(x.org_id);
  if found.id is null then
    raise exception 'that is not your draft';
  end if;
  return found;
end;
$$;

-- Adds the draft, as edited, as the caller's own question. The draft's
-- mistakes go with it when none are given and the options are as many as
-- before; with fewer or more options, none do.
create or replace function lms.accept_item_draft(
  p_draft uuid, p_stem text, p_options jsonb, p_correct_index integer, p_misconceptions jsonb default null
)
returns uuid
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  x lms.item_draft := lms.own_draft(p_draft);
  labels jsonb := p_misconceptions;
  q jsonb;
  new_id uuid;
begin
  if labels is null and jsonb_typeof(p_options) = 'array' and jsonb_array_length(p_options) = jsonb_array_length(x.options) then
    labels := x.misconceptions;
  end if;
  q := lms.usable_question(p_stem, p_options, p_correct_index, labels);
  if q is null then
    raise exception 'that is not a usable question';
  end if;
  insert into lms.item (org_id, grade, subject, kind, stem, options, correct_index, misconceptions,
                        outcome_ids, created_by, ai_model)
  values (x.org_id, x.grade, x.subject, 'mcq', q ->> 'stem', q -> 'options', (q ->> 'correct')::smallint,
          q -> 'labels', case when x.outcome_id is null then '{}'::text[] else array[x.outcome_id] end,
          auth.uid(), x.model)
  returning id into new_id;
  delete from lms.item_draft where id = x.id;
  return new_id;
end;
$$;

create or replace function lms.discard_item_draft(p_draft uuid)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  x lms.item_draft := lms.own_draft(p_draft);
begin
  delete from lms.item_draft where id = x.id;
end;
$$;

revoke all on function lms.usable_question(text, jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function lms.own_draft(uuid) from public, anon, authenticated;
revoke all on function lms.save_item_drafts(integer, text, text, text, jsonb) from public, anon;
revoke all on function lms.my_item_drafts() from public, anon;
revoke all on function lms.accept_item_draft(uuid, text, jsonb, integer, jsonb) from public, anon;
revoke all on function lms.discard_item_draft(uuid) from public, anon;

grant execute on function lms.usable_question(text, jsonb, integer, jsonb) to service_role;
grant execute on function lms.own_draft(uuid) to service_role;
grant execute on function lms.save_item_drafts(integer, text, text, text, jsonb) to authenticated, service_role;
grant execute on function lms.my_item_drafts() to authenticated, service_role;
grant execute on function lms.accept_item_draft(uuid, text, jsonb, integer, jsonb) to authenticated, service_role;
grant execute on function lms.discard_item_draft(uuid) to authenticated, service_role;
