-- A NEW SCHOOL YEAR, AND MOVING A CHILD.
--
-- start_new_year, the admin's, in the week the new session begins:
--   - a new academic year, with this year's sections (each grade and name)
--     and any a child moving up needs;
--   - every teacher keeps the classes they teach — the same grade, section
--     and subject — in the new year, to the children moving up into them;
--   - every child goes up a class in the same section, their roll kept;
--     Class 12 leaves the school (0034's left: no sign-in, no membership);
--   - last year's enrolments close, so last year's classes show nobody.
-- move_student, the admin's: a child kept back, or in the wrong section,
-- to another section of this year, keeping their roll or taking a new one.
--
-- "This year" (0034's current_year) becomes the latest year that has begun,
-- or begins within the week — so a new year started a few days early is
-- this year at once, and the summer break before it is still last year.
--
-- Written against packages/lms-client/tests/new-year.test.ts, first.

create or replace function lms.current_year(p_org uuid)
returns uuid
language sql stable security definer
set search_path = public, lms
as $$
  select y.id from lms.academic_year y
   where y.org_id = p_org
   order by (y.starts_on <= lms.india_today() + 7) desc, y.starts_on desc
   limit 1;
$$;

-- Finds or makes a section of a year.
create or replace function lms.ensure_section(p_org uuid, p_year uuid, p_grade integer, p_name text)
returns uuid
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  found uuid;
begin
  select id into found from lms.section where academic_year_id = p_year and grade = p_grade and name = p_name;
  if found is null then
    insert into lms.section (org_id, academic_year_id, grade, name) values (p_org, p_year, p_grade, p_name)
    returning id into found;
  end if;
  return found;
end;
$$;

create or replace function lms.start_new_year(p_label text, p_starts_on date, p_ends_on date)
returns table (promoted integer, graduated integer, sections integer)
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  cur lms.academic_year;
  fresh uuid;
  e record;
  made integer;
  up integer := 0;
  out_ integer := 0;
begin
  select * into cur from lms.academic_year where id = lms.current_year(org);
  if p_label is null or char_length(btrim(p_label)) not between 1 and 20 then
    raise exception 'a year is named in 1 to 20 characters, like 2027-28';
  end if;
  if exists (select 1 from lms.academic_year where org_id = org and label = btrim(p_label)) then
    raise exception 'a year called % already exists', btrim(p_label);
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on <= p_starts_on then
    raise exception 'that year ends before it starts';
  end if;
  if p_starts_on > lms.india_today() + 7 then
    raise exception 'start the new year in the week it begins, not before';
  end if;
  if cur.id is not null and p_starts_on <= cur.starts_on then
    raise exception 'the new year must start after %', cur.label;
  end if;

  insert into lms.academic_year (org_id, label, starts_on, ends_on)
  values (org, btrim(p_label), p_starts_on, p_ends_on)
  returning id into fresh;

  -- Sections: each of this year's, for the children joining and moving up.
  insert into lms.section (org_id, academic_year_id, grade, name)
  select org, fresh, s.grade, s.name from lms.section s where s.academic_year_id = cur.id;

  -- Teachers: the same classes in the new year.
  insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id)
  select org, ns.id, ta.subject_id, ta.teacher_user_id
    from lms.teaching_assignment ta
    join lms.section os on os.id = ta.section_id and os.academic_year_id = cur.id
    join lms.section ns on ns.academic_year_id = fresh and ns.grade = os.grade and ns.name = os.name
  on conflict (section_id, subject_id, teacher_user_id) do nothing;

  -- Children: up a class, or out of the school after Class 12.
  for e in
    select en.*, sec.grade, sec.name
      from lms.enrolment en join lms.section sec on sec.id = en.section_id
     where en.academic_year_id = cur.id and en.left_on is null
  loop
    update lms.enrolment set left_on = greatest(lms.india_today(), e.joined_on) where id = e.id;
    if e.grade >= 12 then
      update lms.account set left_at = now() where user_id = e.student_user_id and left_at is null;
      delete from public.membership where org_id = org and user_id = e.student_user_id;
      out_ := out_ + 1;
    else
      insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
      values (org, fresh, lms.ensure_section(org, fresh, e.grade + 1, e.name), e.student_user_id, e.roll_number);
      up := up + 1;
    end if;
  end loop;

  select count(*) into made from lms.section where academic_year_id = fresh;
  perform lms.audit(org, 'year-started', btrim(p_label),
    jsonb_build_object('promoted', up, 'graduated', out_, 'sections', made));
  return query select up, out_, made;
end;
$$;

-- This year's sections, with how many children each has.
create or replace function lms.school_sections()
returns table (section_id uuid, class_name text, grade smallint, students integer)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select sec.id, sec.grade || sec.name, sec.grade,
           (select count(*)::int from lms.enrolment e where e.section_id = sec.id and e.left_on is null)
      from lms.section sec
     where sec.org_id = org and sec.academic_year_id = lms.current_year(org)
     order by sec.grade, sec.name;
end;
$$;

create or replace function lms.move_student(p_login_id text, p_section uuid, p_roll text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  who lms.account := lms.account_in_school(org, p_login_id);
  target lms.section;
  now_in lms.enrolment;
  roll text;
begin
  if who.kind <> 'student' then
    raise exception '% is not a student', who.login_id;
  end if;
  select * into target from lms.section
   where id = p_section and org_id = org and academic_year_id = lms.current_year(org);
  if target.id is null then
    raise exception 'that is not a class of this year in your school';
  end if;
  select * into now_in from lms.enrolment
   where student_user_id = who.user_id and academic_year_id = target.academic_year_id and left_on is null;
  roll := btrim(coalesce(p_roll, now_in.roll_number, ''));
  if roll !~ '^[A-Za-z0-9]{1,20}$' then
    raise exception 'a roll number is letters or digits, up to 20';
  end if;
  if exists (
    select 1 from lms.enrolment e
     where e.section_id = target.id and e.left_on is null and e.roll_number = roll and e.student_user_id <> who.user_id
  ) then
    raise exception 'roll % in % is taken', roll, target.grade || target.name;
  end if;
  if now_in.id is not null then
    if now_in.section_id = target.id and now_in.roll_number = roll then
      return;
    end if;
    update lms.enrolment set left_on = greatest(lms.india_today(), now_in.joined_on) where id = now_in.id;
  end if;
  insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
  values (org, target.academic_year_id, target.id, who.user_id, roll);
  perform lms.audit(org, 'moved', who.login_id || ' ' || target.grade || target.name);
end;
$$;

revoke all on function lms.ensure_section(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function lms.start_new_year(text, date, date) from public, anon;
revoke all on function lms.school_sections() from public, anon;
revoke all on function lms.move_student(text, uuid, text) from public, anon;
revoke all on function lms.current_year(uuid) from public, anon;
grant execute on function lms.ensure_section(uuid, uuid, integer, text) to service_role;
grant execute on function lms.start_new_year(text, date, date) to authenticated, service_role;
grant execute on function lms.school_sections() to authenticated, service_role;
grant execute on function lms.move_student(text, uuid, text) to authenticated, service_role;
grant execute on function lms.current_year(uuid) to authenticated, service_role;
