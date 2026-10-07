-- DAILY ATTENDANCE.
--
-- A teacher of a class (any teacher who teaches it this year) or the admin
-- marks each child of it present, absent, late or on leave for a day. One
-- mark per child per day; marking again changes it. Never a day still to
-- come — "today" is India's (Asia/Kolkata), where the schools are — never a
-- child not in the class, never a word not on the list.
--
-- The rate is present-or-late over the days marked, leave left out.
-- The child sees their own days; the class's teachers and the admin see the
-- class's; the admin sees the whole school's today.
--
-- Written against packages/lms-client/tests/attendance.test.ts, first.

create table if not exists lms.attendance (
  student_user_id uuid not null references auth.users on delete cascade,
  on_date date not null,
  org_id uuid not null references lms.school on delete cascade,
  section_id uuid not null references lms.section on delete cascade,
  status text not null check (status in ('present', 'absent', 'late', 'leave')),
  marked_by uuid references auth.users on delete set null,
  marked_at timestamptz not null default now(),
  primary key (student_user_id, on_date)
);
create index if not exists attendance_section_day on lms.attendance (section_id, on_date);

-- Reached only through the functions below.
revoke all on lms.attendance from public, anon, authenticated;
grant all on lms.attendance to service_role;
alter table lms.attendance enable row level security;

create or replace function lms.india_today()
returns date
language sql stable
set search_path = public, lms
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- The rate over a set of marks: present or late, over all but leave.
create or replace function lms.attendance_rate(p_present bigint, p_late bigint, p_absent bigint)
returns float8
language sql immutable
set search_path = public, lms
as $$
  select case when p_present + p_late + p_absent = 0 then null
              else (p_present + p_late)::float8 / (p_present + p_late + p_absent) end;
$$;

create or replace function lms.can_take_attendance(p_section uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select lms.teaches_section(p_section)
      or exists (select 1 from lms.section s where s.id = p_section and lms.is_admin(s.org_id));
$$;

create or replace function lms.attendance_sheet(p_section uuid, p_on date)
returns table (student_user_id uuid, display_name text, roll_number text, status text, marked_by_name text)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if not lms.can_take_attendance(p_section) then
    raise exception 'this is not your class';
  end if;
  return query
    select e.student_user_id, a.display_name, e.roll_number, at.status, m.display_name
      from lms.enrolment e
      join lms.account a on a.user_id = e.student_user_id
      left join lms.attendance at on at.student_user_id = e.student_user_id and at.on_date = p_on
      left join lms.account m on m.user_id = at.marked_by
     where e.section_id = p_section and e.left_on is null
     order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last, a.display_name;
end;
$$;

create or replace function lms.mark_attendance(p_section uuid, p_on date, p_marks jsonb)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  sec lms.section;
  k text;
  v text;
begin
  if not lms.can_take_attendance(p_section) then
    raise exception 'this is not your class';
  end if;
  if p_on is null or p_on > lms.india_today() then
    raise exception 'that day has not come yet';
  end if;
  if p_marks is null or jsonb_typeof(p_marks) <> 'object' then
    raise exception 'marks are given child by child';
  end if;
  select * into sec from lms.section where id = p_section;
  for k, v in select key, value #>> '{}' from jsonb_each(p_marks) loop
    if v is null or v not in ('present', 'absent', 'late', 'leave') then
      raise exception 'a mark is present, absent, late or leave';
    end if;
    if k !~ '^[0-9a-f-]{36}$' or not exists (
      select 1 from lms.enrolment e where e.section_id = p_section and e.student_user_id = k::uuid and e.left_on is null
    ) then
      raise exception 'that student is not in this class';
    end if;
    insert into lms.attendance (student_user_id, on_date, org_id, section_id, status, marked_by, marked_at)
    values (k::uuid, p_on, sec.org_id, p_section, v, auth.uid(), now())
    on conflict (student_user_id, on_date) do update
      set status = excluded.status, section_id = excluded.section_id,
          marked_by = excluded.marked_by, marked_at = excluded.marked_at;
  end loop;
end;
$$;

create or replace function lms.attendance_summary(p_section uuid, p_from date, p_to date)
returns table (
  student_user_id uuid, display_name text, roll_number text,
  present integer, late integer, absent integer, leave integer, rate float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if not lms.can_take_attendance(p_section) then
    raise exception 'this is not your class';
  end if;
  return query
    select e.student_user_id, a.display_name, e.roll_number,
           count(*) filter (where at.status = 'present')::int,
           count(*) filter (where at.status = 'late')::int,
           count(*) filter (where at.status = 'absent')::int,
           count(*) filter (where at.status = 'leave')::int,
           lms.attendance_rate(count(*) filter (where at.status = 'present'),
                               count(*) filter (where at.status = 'late'),
                               count(*) filter (where at.status = 'absent'))
      from lms.enrolment e
      join lms.account a on a.user_id = e.student_user_id
      left join lms.attendance at on at.student_user_id = e.student_user_id
                                 and at.on_date between p_from and p_to
     where e.section_id = p_section and e.left_on is null
     group by e.student_user_id, a.display_name, e.roll_number
     order by case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last, a.display_name;
end;
$$;

-- The child's own days, newest first; each day as YYYY-MM-DD text, the same
-- through PostgREST and the tests' transport.
create or replace function lms.my_attendance(p_days integer default 30)
returns table (on_date text, status text)
language sql stable security definer
set search_path = public, lms
as $$
  select to_char(at.on_date, 'YYYY-MM-DD'), at.status
    from lms.attendance at
   where at.student_user_id = auth.uid()
     and at.on_date > lms.india_today() - least(greatest(coalesce(p_days, 30), 1), 400)
   order by at.on_date desc;
$$;

-- A student's school year so far, for their report.
create or replace function lms.student_attendance(p_student uuid)
returns table (marked integer, rate float8)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  y lms.academic_year;
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  select * into y from lms.academic_year
   where id = lms.current_year((select org_id from lms.account where user_id = p_student));
  return query
    select count(*)::int,
           lms.attendance_rate(count(*) filter (where at.status = 'present'),
                               count(*) filter (where at.status = 'late'),
                               count(*) filter (where at.status = 'absent'))
      from lms.attendance at
     where at.student_user_id = p_student and at.on_date between y.starts_on and y.ends_on;
end;
$$;

-- Every class of this year, today.
create or replace function lms.school_attendance_today()
returns table (section_id uuid, class_name text, students integer, marked integer, present integer)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select sec.id, sec.grade || sec.name,
           (select count(*)::int from lms.enrolment e where e.section_id = sec.id and e.left_on is null),
           (select count(*)::int from lms.enrolment e
              join lms.attendance at on at.student_user_id = e.student_user_id and at.on_date = lms.india_today()
             where e.section_id = sec.id and e.left_on is null),
           (select count(*)::int from lms.enrolment e
              join lms.attendance at on at.student_user_id = e.student_user_id and at.on_date = lms.india_today()
             where e.section_id = sec.id and e.left_on is null and at.status in ('present', 'late'))
      from lms.section sec
     where sec.org_id = org and sec.academic_year_id = lms.current_year(org)
     order by sec.grade, sec.name;
end;
$$;

revoke all on function lms.india_today() from public, anon;
revoke all on function lms.attendance_rate(bigint, bigint, bigint) from public, anon;
revoke all on function lms.can_take_attendance(uuid) from public, anon, authenticated;
revoke all on function lms.attendance_sheet(uuid, date) from public, anon;
revoke all on function lms.mark_attendance(uuid, date, jsonb) from public, anon;
revoke all on function lms.attendance_summary(uuid, date, date) from public, anon;
revoke all on function lms.my_attendance(integer) from public, anon;
revoke all on function lms.student_attendance(uuid) from public, anon;
revoke all on function lms.school_attendance_today() from public, anon;

grant execute on function lms.india_today() to authenticated, service_role;
grant execute on function lms.attendance_rate(bigint, bigint, bigint) to authenticated, service_role;
grant execute on function lms.can_take_attendance(uuid) to service_role;
grant execute on function lms.attendance_sheet(uuid, date) to authenticated, service_role;
grant execute on function lms.mark_attendance(uuid, date, jsonb) to authenticated, service_role;
grant execute on function lms.attendance_summary(uuid, date, date) to authenticated, service_role;
grant execute on function lms.my_attendance(integer) to authenticated, service_role;
grant execute on function lms.student_attendance(uuid) to authenticated, service_role;
grant execute on function lms.school_attendance_today() to authenticated, service_role;
