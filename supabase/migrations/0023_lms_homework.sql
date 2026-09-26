-- QUESTIONS AND HOMEWORK — LMS build plan, L2.
--
-- Two rules everything below serves, each exercised as the real roles in
-- supabase/tests/lms-homework.test.ts, written first:
--
--   1. ONLY AN APPROVED ITEM CAN BE SET AS WORK. The Qrie library (the 4,697
--      probes, LLM-written and reviewed by nobody) is visible to every
--      school's teachers, but an item reaches a child only after a teacher of
--      that child's school has approved it (lms.item_approval). That approval
--      IS the review pipeline the product brief was missing (final plan,
--      Part 2). A teacher's own question is approved by its author on writing.
--   2. A STUDENT NEVER SEES AN ANSWER KEY. Students have no read on lms.item
--      at all; they receive a published assignment's questions through
--      lms.assignment_questions, which returns the stem and options and
--      nothing else — not the correct index, not the misconception labels.
--
-- Also: a teacher sets work only for a section AND subject they teach
-- (decision 3); a student sees only their own section's PUBLISHED work; and
-- once published, an assignment's questions are frozen, so a child part-way
-- through it is never answering a moving target.
--
-- Submissions and marks are L3.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists lms.item (
  id uuid primary key default gen_random_uuid(),
  -- null = the Qrie library, shared by every school; otherwise the school
  -- whose teacher wrote it.
  org_id uuid references lms.school on delete cascade,
  -- The library's own id for the item, e.g. 'probe-sci10-lp-cell-is-unit'.
  library_ref text unique,
  outcome_ids text[] not null default '{}',
  grade smallint check (grade is null or grade between 1 and 12),
  subject text check (subject is null or char_length(subject) between 1 and 60),
  -- 'task' is work done outside the app (a notebook exercise, photographed
  -- in L3); it has no options and no key.
  kind text not null check (kind in ('mcq', 'task')),
  stem text not null check (char_length(stem) between 1 and 2000),
  options jsonb,
  correct_index smallint,
  misconceptions jsonb,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint item_is_library_xor_school check ((org_id is null) = (library_ref is not null)),
  constraint item_mcq_has_a_key check (
    kind <> 'mcq' or (
      jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) between 2 and 6
      and correct_index is not null
      and correct_index >= 0
      and correct_index < jsonb_array_length(options)
    )
  ),
  constraint item_task_has_no_key check (kind <> 'task' or (options is null and correct_index is null))
);

create table if not exists lms.item_approval (
  org_id uuid not null references lms.school on delete cascade,
  item_id uuid not null references lms.item on delete cascade,
  approved_by uuid references auth.users on delete set null,
  approved_at timestamptz not null default now(),
  primary key (org_id, item_id)
);

create table if not exists lms.assignment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  section_id uuid not null,
  subject_id uuid not null,
  created_by uuid references auth.users on delete set null,
  kind text not null check (kind in ('homework', 'quiz', 'test', 'assignment')),
  title text not null check (char_length(title) between 1 and 200),
  instructions text check (instructions is null or char_length(instructions) <= 4000),
  due_at timestamptz not null,
  attempts_allowed smallint not null default 1 check (attempts_allowed between 1 and 10),
  answer_types text[] not null check (
    cardinality(answer_types) > 0 and answer_types <@ array['mcq', 'photo', 'typed']::text[]
  ),
  -- null while a draft; set when the teacher publishes it to the section.
  published_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (section_id, org_id) references lms.section (id, org_id) on delete cascade,
  foreign key (subject_id, org_id) references lms.subject (id, org_id) on delete cascade
);

create index if not exists assignment_section on lms.assignment (section_id);

create table if not exists lms.assignment_item (
  assignment_id uuid not null references lms.assignment on delete cascade,
  item_id uuid not null references lms.item on delete restrict,
  position smallint not null check (position >= 1),
  primary key (assignment_id, item_id),
  unique (assignment_id, position)
);

-- ---------------------------------------------------------------------------
-- Predicates, answering only about the caller.
-- ---------------------------------------------------------------------------

create or replace function lms.is_staff(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from public.membership m
     where m.org_id = p_org and m.user_id = auth.uid() and m.role in ('teacher', 'admin')
  );
$$;

create or replace function lms.is_staff_anywhere()
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from public.membership m
      join public.organization o on o.id = m.org_id
     where m.user_id = auth.uid() and m.role in ('teacher', 'admin') and o.kind = 'school'
  );
$$;

create or replace function lms.teaches_class(p_section uuid, p_subject uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.teaching_assignment ta
     where ta.section_id = p_section and ta.subject_id = p_subject and ta.teacher_user_id = auth.uid()
  );
$$;

create or replace function lms.can_manage_assignment(p_assignment uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.assignment a
     where a.id = p_assignment and lms.teaches_class(a.section_id, a.subject_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- A teacher's own question is approved for their school by writing it.
create or replace function lms.approve_own_item()
returns trigger
language plpgsql security definer
set search_path = public, lms
as $$
begin
  if new.org_id is not null and new.created_by is not null then
    insert into lms.item_approval (org_id, item_id, approved_by)
    values (new.org_id, new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists approve_own_item on lms.item;
create trigger approve_own_item
  after insert on lms.item
  for each row execute function lms.approve_own_item();

-- Only approved items on an assignment, and none added or removed once it is
-- published. Runs as definer so the check sees approvals the writer's own
-- policies might hide.
create or replace function lms.guard_assignment_item()
returns trigger
language plpgsql security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
begin
  select * into a from lms.assignment where id = coalesce(new.assignment_id, old.assignment_id);
  if a.published_at is not null then
    raise exception 'this assignment is published; its questions are frozen';
  end if;
  if tg_op <> 'DELETE' and not exists (
    select 1 from lms.item_approval ap where ap.org_id = a.org_id and ap.item_id = new.item_id
  ) then
    raise exception 'item % is not approved for this school', new.item_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_assignment_item on lms.assignment_item;
create trigger guard_assignment_item
  before insert or update or delete on lms.assignment_item
  for each row execute function lms.guard_assignment_item();

-- ---------------------------------------------------------------------------
-- What a student receives: the questions of a published assignment in their
-- own section — stem and options only.
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
   order by ai.position;
$$;

revoke all on function lms.is_staff(uuid) from public, anon;
revoke all on function lms.is_staff_anywhere() from public, anon;
revoke all on function lms.teaches_class(uuid, uuid) from public, anon;
revoke all on function lms.can_manage_assignment(uuid) from public, anon;
revoke all on function lms.approve_own_item() from public, anon, authenticated;
revoke all on function lms.guard_assignment_item() from public, anon, authenticated;
revoke all on function lms.assignment_questions(uuid) from public, anon;
grant execute on function lms.is_staff(uuid) to authenticated, service_role;
grant execute on function lms.is_staff_anywhere() to authenticated, service_role;
grant execute on function lms.teaches_class(uuid, uuid) to authenticated, service_role;
grant execute on function lms.can_manage_assignment(uuid) to authenticated, service_role;
grant execute on function lms.assignment_questions(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants and policies
-- ---------------------------------------------------------------------------

grant select, insert on lms.item, lms.item_approval to authenticated;
grant select, insert, update, delete on lms.assignment to authenticated;
grant select, insert, delete on lms.assignment_item to authenticated;
grant all on lms.item, lms.item_approval, lms.assignment, lms.assignment_item to service_role;
revoke all on lms.item, lms.item_approval, lms.assignment, lms.assignment_item from anon;

alter table lms.item enable row level security;
alter table lms.item_approval enable row level security;
alter table lms.assignment enable row level security;
alter table lms.assignment_item enable row level security;

-- Items: staff read the library and their own school's; students read none.
drop policy if exists "staff read the library and their school's items" on lms.item;
create policy "staff read the library and their school's items" on lms.item
  for select using (
    (org_id is null and lms.is_staff_anywhere()) or (org_id is not null and lms.is_staff(org_id))
  );

drop policy if exists "staff write their school's own items" on lms.item;
create policy "staff write their school's own items" on lms.item
  for insert with check (
    org_id is not null and lms.is_staff(org_id) and created_by = auth.uid()
  );

drop policy if exists "staff read their school's approvals" on lms.item_approval;
create policy "staff read their school's approvals" on lms.item_approval
  for select using (lms.is_staff(org_id));

drop policy if exists "staff approve for their own school" on lms.item_approval;
create policy "staff approve for their own school" on lms.item_approval
  for insert with check (lms.is_staff(org_id) and approved_by = auth.uid());

-- Assignments: the teacher of that class, the school's admin, and — once it
-- is published — the students of that section.
drop policy if exists "read the work you set, run, or were given" on lms.assignment;
create policy "read the work you set, run, or were given" on lms.assignment
  for select using (
    lms.teaches_class(section_id, subject_id)
    or lms.is_admin(org_id)
    or (published_at is not null and lms.in_section(section_id))
  );

drop policy if exists "set work only for a class you teach" on lms.assignment;
create policy "set work only for a class you teach" on lms.assignment
  for insert with check (created_by = auth.uid() and lms.teaches_class(section_id, subject_id));

drop policy if exists "edit work only for a class you teach" on lms.assignment;
create policy "edit work only for a class you teach" on lms.assignment
  for update using (lms.teaches_class(section_id, subject_id))
  with check (lms.teaches_class(section_id, subject_id));

drop policy if exists "delete only an unpublished draft of your class" on lms.assignment;
create policy "delete only an unpublished draft of your class" on lms.assignment
  for delete using (published_at is null and lms.teaches_class(section_id, subject_id));

drop policy if exists "the class's teacher reads its questions" on lms.assignment_item;
create policy "the class's teacher reads its questions" on lms.assignment_item
  for select using (lms.can_manage_assignment(assignment_id));

drop policy if exists "the class's teacher adds questions" on lms.assignment_item;
create policy "the class's teacher adds questions" on lms.assignment_item
  for insert with check (lms.can_manage_assignment(assignment_id));

drop policy if exists "the class's teacher removes questions" on lms.assignment_item;
create policy "the class's teacher removes questions" on lms.assignment_item
  for delete using (lms.can_manage_assignment(assignment_id));
