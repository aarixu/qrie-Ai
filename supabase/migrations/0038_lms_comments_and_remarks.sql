-- A TEACHER'S COMMENT ON WORK, AND A REMARK ON THE REPORT CARD.
--
-- "A mark on its own does not tell a child what to fix."
--
-- 1. A COMMENT ON A PIECE OF WORK. A teacher of the class (its section and
--    subject, this year) writes one comment of 1 to 1000 characters on one
--    child's work for one published assignment. It is kept per child and
--    assignment, as the teacher's word of 0030 is: one comment on the
--    child's work for it, whatever kind of work that is. Writing again
--    replaces it; writing nothing removes it. The child reads their own,
--    on a test only once its results are released (as its marks, 0029); the
--    class's teachers and the admin read the class's.
-- 2. A REMARK ON THE REPORT CARD. One per child per school year, 1 to 600
--    characters, written by any teacher of the child's section this year or
--    by the admin; the latest write wins and keeps who wrote it, and each
--    write goes in the activity log (0034). The child, their teachers and
--    the admin read this year's.
--
-- Neither is written for a child who has left, nor through last year's
-- classes, nor by another school; a comment only for a child in the class
-- the work was set for.
--
-- Written against packages/lms-client/tests/comments.test.ts, first.

create table if not exists lms.work_comment (
  assignment_id uuid not null references lms.assignment on delete cascade,
  student_user_id uuid not null references auth.users on delete cascade,
  org_id uuid not null references lms.school on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  written_by uuid references auth.users on delete set null,
  written_at timestamptz not null default now(),
  primary key (assignment_id, student_user_id)
);

create table if not exists lms.report_remark (
  student_user_id uuid not null references auth.users on delete cascade,
  academic_year_id uuid not null,
  org_id uuid not null,
  text text not null check (char_length(text) between 1 and 600),
  written_by uuid references auth.users on delete set null,
  written_at timestamptz not null default now(),
  primary key (student_user_id, academic_year_id),
  foreign key (academic_year_id, org_id) references lms.academic_year (id, org_id) on delete cascade
);

-- Reached only through the functions below.
revoke all on lms.work_comment, lms.report_remark from public, anon, authenticated;
grant all on lms.work_comment, lms.report_remark to service_role;
alter table lms.work_comment enable row level security;
alter table lms.report_remark enable row level security;

-- ---------------------------------------------------------------------------
-- 1. Comments.
-- ---------------------------------------------------------------------------

create or replace function lms.set_work_comment(p_assignment uuid, p_student uuid, p_text text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
  words text := nullif(btrim(coalesce(p_text, '')), '');
begin
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or not lms.teaches_class(a.section_id, a.subject_id) then
    raise exception 'this is not your class';
  end if;
  if a.published_at is null then
    raise exception 'this work is not published yet';
  end if;
  if not exists (
    select 1 from lms.enrolment e
     where e.section_id = a.section_id and e.student_user_id = p_student and e.left_on is null
  ) then
    raise exception 'that student is not in this class';
  end if;
  if words is null then
    delete from lms.work_comment where assignment_id = a.id and student_user_id = p_student;
    return;
  end if;
  if char_length(words) > 1000 then
    raise exception 'a comment is 1 to 1000 characters';
  end if;
  insert into lms.work_comment (assignment_id, student_user_id, org_id, text, written_by, written_at)
  values (a.id, p_student, a.org_id, words, auth.uid(), now())
  on conflict (assignment_id, student_user_id) do update
    set text = excluded.text, written_by = excluded.written_by, written_at = excluded.written_at;
end;
$$;

-- The class's comments on one piece of work, for the children on its roster.
create or replace function lms.work_comments(p_assignment uuid)
returns table (student_user_id uuid, text text, written_by_name text, written_at timestamptz)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
begin
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or not (lms.teaches_class(a.section_id, a.subject_id) or lms.is_admin(a.org_id)) then
    raise exception 'this is not your class';
  end if;
  return query
    select c.student_user_id, c.text, w.display_name, c.written_at
      from lms.work_comment c
      join lms.enrolment e on e.section_id = a.section_id and e.student_user_id = c.student_user_id and e.left_on is null
      left join lms.account w on w.user_id = c.written_by
     where c.assignment_id = a.id
     order by c.written_at desc;
end;
$$;

-- The caller's own comment on a piece of work of their class.
create or replace function lms.my_work_comment(p_assignment uuid)
returns table (text text, written_by_name text, written_at timestamptz)
language sql stable security definer
set search_path = public, lms
as $$
  select c.text, w.display_name, c.written_at
    from lms.assignment a
    join lms.work_comment c on c.assignment_id = a.id and c.student_user_id = auth.uid()
    left join lms.account w on w.user_id = c.written_by
   where a.id = p_assignment
     and a.published_at is not null
     and lms.in_section(a.section_id)
     and (a.kind <> 'test' or a.results_released_at is not null);
$$;

-- ---------------------------------------------------------------------------
-- 2. The remark.
-- ---------------------------------------------------------------------------

-- Whether the caller may write this child's remark: a child of the school
-- who has not left, and a caller who teaches their section this year or is
-- their school's admin. Internal.
create or replace function lms.may_remark(p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.account s
     where s.user_id = p_student and s.kind = 'student' and s.left_at is null
       and (lms.teaches_student(p_student) or lms.is_admin(s.org_id))
  );
$$;

create or replace function lms.set_report_remark(p_student uuid, p_text text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  who lms.account;
  words text := nullif(btrim(coalesce(p_text, '')), '');
  y uuid;
begin
  select * into who from lms.account where user_id = p_student;
  if who.user_id is null or not lms.may_remark(p_student) then
    raise exception 'only a teacher of their class this year, or the school admin, can write this remark';
  end if;
  y := lms.current_year(who.org_id);
  if y is null then
    raise exception 'your school has no school year yet';
  end if;
  if words is null then
    delete from lms.report_remark where student_user_id = p_student and academic_year_id = y;
    perform lms.audit(who.org_id, 'remark-removed', who.login_id);
    return;
  end if;
  if char_length(words) > 600 then
    raise exception 'a remark is 1 to 600 characters';
  end if;
  insert into lms.report_remark (student_user_id, academic_year_id, org_id, text, written_by, written_at)
  values (p_student, y, who.org_id, words, auth.uid(), now())
  on conflict (student_user_id, academic_year_id) do update
    set text = excluded.text, written_by = excluded.written_by, written_at = excluded.written_at;
  perform lms.audit(who.org_id, 'remark-set', who.login_id);
end;
$$;

-- This year's remark, one row whether or not one is written, with whether
-- the caller may write it.
create or replace function lms.report_remark(p_student uuid)
returns table (text text, written_by_name text, written_at timestamptz, can_edit boolean)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  return query
    select r.text, w.display_name, r.written_at, lms.may_remark(p_student)
      from (select lms.current_year((select a.org_id from lms.account a where a.user_id = p_student)) as year_id) this
      left join lms.report_remark r on r.student_user_id = p_student and r.academic_year_id = this.year_id
      left join lms.account w on w.user_id = r.written_by;
end;
$$;

revoke all on function lms.set_work_comment(uuid, uuid, text) from public, anon;
revoke all on function lms.work_comments(uuid) from public, anon;
revoke all on function lms.my_work_comment(uuid) from public, anon;
revoke all on function lms.may_remark(uuid) from public, anon, authenticated;
revoke all on function lms.set_report_remark(uuid, text) from public, anon;
revoke all on function lms.report_remark(uuid) from public, anon;

grant execute on function lms.set_work_comment(uuid, uuid, text) to authenticated, service_role;
grant execute on function lms.work_comments(uuid) to authenticated, service_role;
grant execute on function lms.my_work_comment(uuid) to authenticated, service_role;
grant execute on function lms.may_remark(uuid) to service_role;
grant execute on function lms.set_report_remark(uuid, text) to authenticated, service_role;
grant execute on function lms.report_remark(uuid) to authenticated, service_role;
