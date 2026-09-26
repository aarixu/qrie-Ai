-- THE SCHOOL'S STRUCTURE — LMS build plan, L1.
--
-- Everything a school is made of lives in its own schema, `lms`, apart from
-- the tutor's tables (final plan, decision 15). The two are joined by the
-- shared tenancy (public.organization, public.membership) and by the learner
-- (0021), not by sharing tables.
--
-- WHO SEES WHAT, and every line of it exercised as the real `authenticated`
-- role in supabase/tests/lms-structure.test.ts, written first:
--
--   a teacher  — the sections they teach, the current roster of those
--                sections, and those students' names. Nothing of any other
--                section, and nothing of any other school.
--   a student  — their own school's name and branding, their own section,
--                their own enrolment, their own account.
--   an admin   — everything in their own school.
--   anyone     — no writes at all from a browser. The first ten schools are
--                set up by Aarav with the service role (decision 7); a school
--                admin screen can come later behind its own policies.
--
-- WHAT THE STRUCTURE REFUSES, whoever is writing:
--
--   * a join across schools. Every table carries org_id, and every link is a
--     composite foreign key that includes it, so a section of one school can
--     never be taught a subject of another.
--   * two active enrolments for one student in one academic year.
--   * one login id used twice in one school.
--   * a school row for an org that is not of kind 'school'.
--
-- NOT HERE YET, on purpose: marks, homework and submissions (L2, L3), and the
-- login itself — lockout after repeated wrong PINs and the short teacher
-- session (decision 12) arrive with the apps that log in (L4, L5).
--
-- A browser cannot reach this schema until it is added to the project's
-- exposed schemas (dashboard: Project Settings → Data API). That is a
-- production setting, not a migration; this repo has no supabase/config.toml.

create schema if not exists lms;

grant usage on schema lms to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists lms.school (
  org_id uuid primary key references public.organization on delete cascade,
  -- What a student types before their ID. Upper-case letters and digits only,
  -- so it survives being read aloud in a classroom and typed on a phone.
  code text not null unique check (code ~ '^[A-Z0-9]{3,12}$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  short_name text check (short_name is null or char_length(short_name) between 1 and 30),
  board text not null check (board in ('CBSE', 'ICSE', 'STATE', 'OTHER')),
  -- A Storage path, not a URL, so a moved bucket does not orphan every logo.
  logo_path text,
  -- Colour tokens for the white-label app (decision 4). Validated by the app's
  -- own contrast gate before use, not here.
  brand jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists lms.academic_year (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  label text not null check (char_length(label) between 1 and 20),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on > starts_on),
  unique (org_id, label),
  unique (id, org_id)
);

create table if not exists lms.subject (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- Which of our syllabi this subject maps to, when one does; null for a
  -- subject we have no content for.
  syllabus_subject text,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

create table if not exists lms.section (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  academic_year_id uuid not null,
  grade smallint not null check (grade between 1 and 12),
  name text not null check (char_length(name) between 1 and 20),
  created_at timestamptz not null default now(),
  foreign key (academic_year_id, org_id) references lms.academic_year (id, org_id) on delete cascade,
  unique (academic_year_id, grade, name),
  unique (id, org_id),
  unique (id, org_id, academic_year_id)
);

-- One row per person the school created. The login id is what they type; the
-- email behind it is an internal detail of how the account is stored.
create table if not exists lms.account (
  user_id uuid primary key references auth.users on delete cascade,
  org_id uuid not null references lms.school on delete cascade,
  login_id text not null check (login_id ~ '^[A-Z0-9-]{3,40}$'),
  kind text not null check (kind in ('student', 'teacher', 'admin')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (org_id, login_id)
);

create table if not exists lms.teaching_assignment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  section_id uuid not null,
  subject_id uuid not null,
  teacher_user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (section_id, org_id) references lms.section (id, org_id) on delete cascade,
  foreign key (subject_id, org_id) references lms.subject (id, org_id) on delete cascade,
  unique (section_id, subject_id, teacher_user_id)
);

create table if not exists lms.enrolment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  academic_year_id uuid not null,
  section_id uuid not null,
  student_user_id uuid not null references auth.users on delete cascade,
  roll_number text check (roll_number is null or char_length(roll_number) between 1 and 20),
  joined_on date not null default current_date,
  -- A leaving date, not a delete: last term's marks stay attached to the
  -- section the student was in when they were given.
  left_on date,
  created_at timestamptz not null default now(),
  foreign key (section_id, org_id, academic_year_id)
    references lms.section (id, org_id, academic_year_id) on delete cascade,
  check (left_on is null or left_on >= joined_on)
);

create unique index if not exists enrolment_one_active_per_year
  on lms.enrolment (student_user_id, academic_year_id)
  where left_on is null;

create index if not exists enrolment_section on lms.enrolment (section_id);
create index if not exists teaching_assignment_teacher on lms.teaching_assignment (teacher_user_id);

-- A school row may only hang off an org the LMS created as a school.
create or replace function lms.school_org_is_school()
returns trigger
language plpgsql
security definer
set search_path = public, lms
as $$
begin
  if not exists (select 1 from public.organization o where o.id = new.org_id and o.kind = 'school') then
    raise exception 'organization % is not a school', new.org_id;
  end if;
  return new;
end;
$$;

drop trigger if exists school_org_is_school on lms.school;
create trigger school_org_is_school
  before insert or update of org_id on lms.school
  for each row execute function lms.school_org_is_school();

-- ---------------------------------------------------------------------------
-- The predicates every policy below is written in. SECURITY DEFINER so that a
-- policy on one table can consult another without re-entering RLS (the same
-- trap 0005's is_member avoids). Each answers only about the caller, except
-- `teaches`, which takes a teacher and is therefore closed to browsers.
-- ---------------------------------------------------------------------------

create or replace function lms.is_admin(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from public.membership m
     where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

create or replace function lms.teaches_section(p_section uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.teaching_assignment ta
     where ta.section_id = p_section and ta.teacher_user_id = auth.uid()
  );
$$;

create or replace function lms.in_section(p_section uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.enrolment e
     where e.section_id = p_section and e.student_user_id = auth.uid() and e.left_on is null
  );
$$;

create or replace function lms.teaches_student(p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1
      from lms.enrolment e
      join lms.teaching_assignment ta on ta.section_id = e.section_id
     where e.student_user_id = p_student
       and e.left_on is null
       and ta.teacher_user_id = auth.uid()
  );
$$;

-- Section AND subject: the scope a teacher's view of a student's work is cut
-- to (decision 3). Closed to browsers because it answers about any teacher.
create or replace function lms.teaches(p_teacher uuid, p_student uuid, p_subject uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1
      from lms.teaching_assignment ta
      join lms.enrolment e on e.section_id = ta.section_id
     where ta.teacher_user_id = p_teacher
       and ta.subject_id = p_subject
       and e.student_user_id = p_student
       and e.left_on is null
  );
$$;

create or replace function lms.i_teach(p_student uuid, p_subject uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select lms.teaches(auth.uid(), p_student, p_subject);
$$;

revoke all on function lms.school_org_is_school() from public, anon, authenticated;
revoke all on function lms.is_admin(uuid) from public, anon;
revoke all on function lms.teaches_section(uuid) from public, anon;
revoke all on function lms.in_section(uuid) from public, anon;
revoke all on function lms.teaches_student(uuid) from public, anon;
revoke all on function lms.teaches(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function lms.i_teach(uuid, uuid) from public, anon;
grant execute on function lms.is_admin(uuid) to authenticated, service_role;
grant execute on function lms.teaches_section(uuid) to authenticated, service_role;
grant execute on function lms.in_section(uuid) to authenticated, service_role;
grant execute on function lms.teaches_student(uuid) to authenticated, service_role;
grant execute on function lms.teaches(uuid, uuid, uuid) to service_role;
grant execute on function lms.i_teach(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants and policies. Browsers may SELECT, and only what a policy allows;
-- nothing is written from a browser. The service role writes everything.
-- ---------------------------------------------------------------------------

grant select on all tables in schema lms to authenticated;
grant all on all tables in schema lms to service_role;
revoke all on all tables in schema lms from anon;

alter table lms.school enable row level security;
alter table lms.academic_year enable row level security;
alter table lms.subject enable row level security;
alter table lms.section enable row level security;
alter table lms.account enable row level security;
alter table lms.teaching_assignment enable row level security;
alter table lms.enrolment enable row level security;

drop policy if exists "members read their school" on lms.school;
create policy "members read their school" on lms.school
  for select using (public.is_member(org_id));

drop policy if exists "members read their school's years" on lms.academic_year;
create policy "members read their school's years" on lms.academic_year
  for select using (public.is_member(org_id));

drop policy if exists "members read their school's subjects" on lms.subject;
create policy "members read their school's subjects" on lms.subject
  for select using (public.is_member(org_id));

drop policy if exists "read the sections you teach, sit in, or run" on lms.section;
create policy "read the sections you teach, sit in, or run" on lms.section
  for select using (
    lms.teaches_section(id) or lms.in_section(id) or lms.is_admin(org_id)
  );

drop policy if exists "read your account, your students', or your school's" on lms.account;
create policy "read your account, your students', or your school's" on lms.account
  for select using (
    user_id = auth.uid() or lms.teaches_student(user_id) or lms.is_admin(org_id)
  );

drop policy if exists "read your own assignments, or your school's" on lms.teaching_assignment;
create policy "read your own assignments, or your school's" on lms.teaching_assignment
  for select using (
    teacher_user_id = auth.uid() or lms.is_admin(org_id)
  );

drop policy if exists "read your enrolment, your current roster, or your school's" on lms.enrolment;
create policy "read your enrolment, your current roster, or your school's" on lms.enrolment
  for select using (
    student_user_id = auth.uid()
    or (left_on is null and lms.teaches_section(section_id))
    or lms.is_admin(org_id)
  );
