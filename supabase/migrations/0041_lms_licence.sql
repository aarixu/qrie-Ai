-- A LICENCE PER SCHOOL, AND THE FOUNDER'S LIST OF SCHOOLS.
--
-- 1. THE LICENCE. A school may have one: a plan (one short word, such as
--    'pilot' or 'standard'), how many students it covers (seats) and the
--    last day it runs (valid_until). It is set through set_licence, which of
--    the API's roles only the service role may call — Qrie's founder; for now
--    with tools/lms-demo's founder console, as the demo database's owner. No
--    function a signed-in person can call writes it, and no browser reads or
--    writes the table. Each setting is in the school's activity log (0034),
--    with nobody of the school as its actor.
-- 2. WHAT THE ADMIN READS. school_licence: the plan, the seats, the seats in
--    use, the last day and the days left (0 on the last day, below 0 once it
--    has ended; "today" is India's, 0036). A seat is in use for each student
--    in a class of this year (0037's current_year) who has not left (0034).
--    A school with no licence reads one row with no plan, seats, last day or
--    days left: "no licence set". Nothing here locks anyone out when a
--    licence ends.
-- 3. SEATS IN USE, the count above, is seats_used: internal, for
--    school_licence, the founder's list, and the demo's bulk import, which
--    refuses students beyond the seats left (tools/lms-import's preview).
--    The admin's other two ways of putting a child into a class of this
--    year are refused too when every seat is in use (require_seat): bringing
--    back a child who left (0034's restore_account), and moving in a child
--    who is in no class this year (0037's move_student). A child already in
--    a class of this year moves however full the school is.
-- 4. THE FOUNDER'S LIST. founder_schools, of the API's roles the service
--    role's only, like set_licence: every
--    school with its licence, seats in use, students and teachers who have
--    not left, and the day it was last active — the latest attendance mark,
--    hand-in, work published, or ledger event as the server received it
--    (0006's received_at; the phone's clock is not trusted), as India's date.
--
-- Written against packages/lms-client/tests/licence.test.ts, first.

create table if not exists lms.licence (
  org_id uuid primary key references lms.school on delete cascade,
  plan text not null check (plan ~ '^[a-z][a-z0-9-]{0,29}$'),
  seats integer not null check (seats between 1 and 100000),
  valid_until date not null,
  set_at timestamptz not null default now()
);

-- Written only by set_licence; read only through the functions below.
revoke all on lms.licence from public, anon, authenticated;
grant all on lms.licence to service_role;
alter table lms.licence enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Seats in use. Internal.
-- ---------------------------------------------------------------------------

create or replace function lms.seats_used(p_org uuid)
returns integer
language sql stable security definer
set search_path = public, lms
as $$
  select count(distinct e.student_user_id)::int
    from lms.enrolment e
    join lms.account a on a.user_id = e.student_user_id
   where e.org_id = p_org
     and e.left_on is null
     and e.academic_year_id = lms.current_year(p_org)
     and a.org_id = p_org and a.kind = 'student' and a.left_at is null;
$$;

-- ---------------------------------------------------------------------------
-- 1. Setting it: the service role only.
-- ---------------------------------------------------------------------------

create or replace function lms.set_licence(p_code text, p_plan text, p_seats integer, p_until date)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid;
  word text := lower(btrim(coalesce(p_plan, '')));
begin
  select s.org_id into org from lms.school s where s.code = upper(btrim(coalesce(p_code, '')));
  if org is null then
    raise exception 'there is no school with the code %', upper(btrim(coalesce(p_code, '(none)')));
  end if;
  if word !~ '^[a-z][a-z0-9-]{0,29}$' then
    raise exception 'a plan is one word of up to 30 letters, digits or hyphens, like pilot';
  end if;
  if p_seats is null or p_seats not between 1 and 100000 then
    raise exception 'seats are 1 to 100000';
  end if;
  if p_until is null then
    raise exception 'give the last day the licence runs';
  end if;
  insert into lms.licence (org_id, plan, seats, valid_until, set_at)
  values (org, word, p_seats, p_until, now())
  on conflict (org_id) do update
    set plan = excluded.plan, seats = excluded.seats, valid_until = excluded.valid_until, set_at = excluded.set_at;
  perform lms.audit(org, 'licence-set', word,
    jsonb_build_object('seats', p_seats, 'validUntil', to_char(p_until, 'YYYY-MM-DD')));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. What the admin reads. Each day as YYYY-MM-DD text, the same through
--    PostgREST and the tests' transport (as 0036's my_attendance).
-- ---------------------------------------------------------------------------

create or replace function lms.school_licence()
returns table (plan text, seats integer, seats_used integer, valid_until text, days_left integer)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select l.plan, l.seats, lms.seats_used(org),
           to_char(l.valid_until, 'YYYY-MM-DD'), (l.valid_until - lms.india_today())::int
      from lms.school s
      left join lms.licence l on l.org_id = s.org_id
     where s.org_id = org;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The founder's list: the service role only.
-- ---------------------------------------------------------------------------

create or replace function lms.founder_schools()
returns table (
  code text, school_name text, plan text, seats integer, seats_used integer, valid_until text, days_left integer,
  students integer, teachers integer, last_active text, days_since_active integer
)
language sql stable security definer
set search_path = public, lms
as $$
  with seen as (
    select s.org_id,
           (greatest(
              (select max(at.marked_at) from lms.attendance at where at.org_id = s.org_id),
              (select max(sub.submitted_at) from lms.submission sub where sub.org_id = s.org_id),
              (select max(a.published_at) from lms.assignment a where a.org_id = s.org_id),
              (select max(le.received_at) from public.ledger_event le where le.org_id = s.org_id)
            ) at time zone 'Asia/Kolkata')::date as day
      from lms.school s
  )
  select s.code, s.display_name, l.plan, l.seats, lms.seats_used(s.org_id),
         to_char(l.valid_until, 'YYYY-MM-DD'), (l.valid_until - lms.india_today())::int,
         (select count(*)::int from lms.account a where a.org_id = s.org_id and a.kind = 'student' and a.left_at is null),
         (select count(*)::int from lms.account a where a.org_id = s.org_id and a.kind = 'teacher' and a.left_at is null),
         to_char(seen.day, 'YYYY-MM-DD'), (lms.india_today() - seen.day)::int
    from lms.school s
    join seen on seen.org_id = s.org_id
    left join lms.licence l on l.org_id = s.org_id
   order by s.code;
$$;

-- ---------------------------------------------------------------------------
-- 5. No more students than seats (see 3 above).
-- ---------------------------------------------------------------------------

-- Nothing when the school has a seat free or no licence; else a plain
-- refusal. Internal.
create or replace function lms.require_seat(p_org uuid)
returns void
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  seats_allowed integer;
begin
  select l.seats into seats_allowed from lms.licence l where l.org_id = p_org;
  if seats_allowed is not null and lms.seats_used(p_org) >= seats_allowed then
    raise exception 'all % seats of your licence are in use', seats_allowed;
  end if;
end;
$$;

-- 0034's, and a seat for a child brought back into a class of this year.
create or replace function lms.restore_account(p_login_id text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  who lms.account := lms.account_in_school(org, p_login_id);
begin
  if who.left_at is null then
    return;
  end if;
  if who.kind = 'student' and exists (
    select 1 from lms.enrolment e join lms.section sec on sec.id = e.section_id
     where e.student_user_id = who.user_id
       and e.left_on = who.left_at::date
       and sec.academic_year_id = lms.current_year(org)
  ) then
    perform lms.require_seat(org);
  end if;
  insert into public.membership (org_id, user_id, role) values (org, who.user_id, who.kind)
  on conflict do nothing;
  if who.kind = 'student' then
    -- Back into the class they left this year, if it is still this year's.
    update lms.enrolment e set left_on = null
      from lms.section sec
     where e.section_id = sec.id and e.student_user_id = who.user_id
       and e.left_on = who.left_at::date
       and sec.academic_year_id = lms.current_year(org);
  end if;
  update lms.account set left_at = null where user_id = who.user_id;
  perform lms.audit(org, 'restored', who.login_id);
end;
$$;

-- 0037's, and a seat for a child moved in from no class this year.
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
  else
    perform lms.require_seat(org);
  end if;
  insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
  values (org, target.academic_year_id, target.id, who.user_id, roll);
  perform lms.audit(org, 'moved', who.login_id || ' ' || target.grade || target.name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function lms.seats_used(uuid) from public, anon, authenticated;
revoke all on function lms.require_seat(uuid) from public, anon, authenticated;
revoke all on function lms.restore_account(text) from public, anon;
revoke all on function lms.move_student(text, uuid, text) from public, anon;
revoke all on function lms.set_licence(text, text, integer, date) from public, anon, authenticated;
revoke all on function lms.school_licence() from public, anon;
revoke all on function lms.founder_schools() from public, anon, authenticated;

grant execute on function lms.seats_used(uuid) to service_role;
grant execute on function lms.require_seat(uuid) to service_role;
grant execute on function lms.restore_account(text) to authenticated, service_role;
grant execute on function lms.move_student(text, uuid, text) to authenticated, service_role;
grant execute on function lms.set_licence(text, text, integer, date) to service_role;
grant execute on function lms.school_licence() to authenticated, service_role;
grant execute on function lms.founder_schools() to service_role;
