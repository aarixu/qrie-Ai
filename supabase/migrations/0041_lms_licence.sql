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
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function lms.seats_used(uuid) from public, anon, authenticated;
revoke all on function lms.set_licence(text, text, integer, date) from public, anon, authenticated;
revoke all on function lms.school_licence() from public, anon;
revoke all on function lms.founder_schools() from public, anon, authenticated;

grant execute on function lms.seats_used(uuid) to service_role;
grant execute on function lms.set_licence(text, text, integer, date) to service_role;
grant execute on function lms.school_licence() to authenticated, service_role;
grant execute on function lms.founder_schools() to service_role;
