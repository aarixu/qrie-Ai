-- PARENTS.
--
-- A parent signs in to the school's app with their own ID and PIN (an
-- account of kind 'parent'; 0021 reserved the membership role) and sees
-- their own children: the same report the child's teachers and the admin
-- see, read-only — every function behind may_see_student and
-- may_see_subject (0031), which now also let in the child's parent: the
-- card, subjects, recent work, chapters, attendance (0036), the teacher's
-- remark (0038), the photo (0033) — and the notices sent to the child's
-- class this year and to the whole school (0039). A parent's read of a
-- notice is not counted among its audience's.
--
-- The admin links a parent to a child, and a second child for brothers and
-- sisters, and can unlink them; each in the activity log (0034). A parent
-- sees a child only while both are at the school: either leaving (0034's
-- mark_left) ends it, and bringing the child back restores it. A parent is
-- not staff: nothing a teacher or the admin does is theirs.
--
-- Written against packages/lms-client/tests/parents.test.ts, first.

alter table lms.account drop constraint if exists account_kind_check;
alter table lms.account add constraint account_kind_check check (kind in ('student', 'teacher', 'admin', 'parent'));

create table if not exists lms.guardian (
  parent_user_id uuid not null references auth.users on delete cascade,
  student_user_id uuid not null references auth.users on delete cascade,
  org_id uuid not null references lms.school on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (parent_user_id, student_user_id)
);
create index if not exists guardian_student on lms.guardian (student_user_id);

-- Reached only through the functions below.
revoke all on lms.guardian from public, anon, authenticated;
grant all on lms.guardian to service_role;
alter table lms.guardian enable row level security;

-- Whether the caller is this child's parent, both still at the school.
-- Internal.
create or replace function lms.is_guardian_of(p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.guardian g
      join lms.account pa on pa.user_id = g.parent_user_id and pa.kind = 'parent' and pa.left_at is null
      join lms.account ch on ch.user_id = g.student_user_id and ch.kind = 'student' and ch.left_at is null
                         and ch.org_id = g.org_id
     where g.parent_user_id = auth.uid() and g.student_user_id = p_student
       and public.is_member(g.org_id)
  );
$$;

-- 0031's, and the child's parent.
create or replace function lms.may_see_student(p_student uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select p_student = auth.uid()
      or exists (select 1 from lms.account a where a.user_id = p_student and lms.is_admin(a.org_id))
      or lms.teaches_student(p_student)
      or lms.is_guardian_of(p_student);
$$;

-- 0031's, and the child's parent, who sees every subject, as the child does.
create or replace function lms.may_see_subject(p_student uuid, p_subject uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select p_student = auth.uid()
      or exists (select 1 from lms.account a where a.user_id = p_student and lms.is_admin(a.org_id))
      or lms.i_teach(p_student, p_subject)
      or lms.is_guardian_of(p_student);
$$;

-- 0039's, and a parent: the whole school's notices, and those for a section
-- one of their children is in this year.
create or replace function lms.may_see_notice(p_notice uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.notice n
     where n.id = p_notice
       and public.is_member(n.org_id)
       and n.academic_year_id = lms.current_year(n.org_id)
       and (
         n.whole_school
         or n.created_by = auth.uid()
         or lms.is_admin(n.org_id)
         or exists (
           select 1 from lms.notice_section ns
            where ns.notice_id = n.id
              and (lms.in_section(ns.section_id) or lms.teaches_section(ns.section_id))
         )
         or exists (
           select 1 from lms.notice_section ns
             join lms.enrolment e on e.section_id = ns.section_id and e.left_on is null
            where ns.notice_id = n.id and lms.is_guardian_of(e.student_user_id)
         )
       )
  );
$$;

-- The caller's children at their school, by class and roll.
create or replace function lms.my_children()
returns table (user_id uuid, login_id text, display_name text, class_name text, roll_number text)
language sql stable security definer
set search_path = public, lms
as $$
  select ch.user_id, ch.login_id, ch.display_name, sec.grade || sec.name, e.roll_number
    from lms.guardian g
    join lms.account ch on ch.user_id = g.student_user_id
    left join lms.enrolment e on e.student_user_id = ch.user_id and e.left_on is null
                             and e.academic_year_id = lms.current_year(ch.org_id)
    left join lms.section sec on sec.id = e.section_id
   where g.parent_user_id = auth.uid() and lms.is_guardian_of(ch.user_id)
   order by sec.grade, sec.name, ch.display_name;
$$;

create or replace function lms.link_parent(p_parent_login text, p_student_login text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  parent lms.account := lms.account_in_school(org, p_parent_login);
  child lms.account := lms.account_in_school(org, p_student_login);
begin
  if parent.kind <> 'parent' or parent.left_at is not null then
    raise exception '% is not a parent at your school', parent.login_id;
  end if;
  if child.kind <> 'student' or child.left_at is not null then
    raise exception '% is not a student at your school', child.login_id;
  end if;
  insert into lms.guardian (parent_user_id, student_user_id, org_id) values (parent.user_id, child.user_id, org)
  on conflict do nothing;
  if found then
    perform lms.audit(org, 'parent-linked', parent.login_id || ' ' || child.login_id);
  end if;
end;
$$;

create or replace function lms.unlink_parent(p_parent_login text, p_student_login text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  parent lms.account := lms.account_in_school(org, p_parent_login);
  child lms.account := lms.account_in_school(org, p_student_login);
begin
  delete from lms.guardian where parent_user_id = parent.user_id and student_user_id = child.user_id;
  if found then
    perform lms.audit(org, 'parent-unlinked', parent.login_id || ' ' || child.login_id);
  end if;
end;
$$;

-- A child's parents who are at the school. The admin's.
create or replace function lms.student_parents(p_student uuid)
returns table (login_id text, display_name text)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select pa.login_id, pa.display_name
      from lms.guardian g
      join lms.account pa on pa.user_id = g.parent_user_id and pa.left_at is null
     where g.student_user_id = p_student and g.org_id = org
     order by pa.display_name;
end;
$$;

revoke all on function lms.is_guardian_of(uuid) from public, anon, authenticated;
revoke all on function lms.may_see_student(uuid) from public, anon, authenticated;
revoke all on function lms.may_see_subject(uuid, uuid) from public, anon, authenticated;
revoke all on function lms.may_see_notice(uuid) from public, anon, authenticated;
revoke all on function lms.my_children() from public, anon;
revoke all on function lms.link_parent(text, text) from public, anon;
revoke all on function lms.unlink_parent(text, text) from public, anon;
revoke all on function lms.student_parents(uuid) from public, anon;

grant execute on function lms.is_guardian_of(uuid) to service_role;
grant execute on function lms.my_children() to authenticated, service_role;
grant execute on function lms.link_parent(text, text) to authenticated, service_role;
grant execute on function lms.unlink_parent(text, text) to authenticated, service_role;
grant execute on function lms.student_parents(uuid) to authenticated, service_role;
