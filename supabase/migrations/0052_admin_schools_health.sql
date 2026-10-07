-- SCHOOLS AT A GLANCE: THE LIST, AND EACH SCHOOL'S HEALTH CARD.
--
-- The console reads the LMS lane's tables and the tutor's through SECURITY
-- DEFINER functions, like every admin function (0047). Every function a
-- browser may call begins with admin.require_staff.
--
-- THE HEALTH CARD is nine signals, each green, amber, red or grey ("cannot
-- tell yet") with a one-sentence reason. Every threshold is in
-- admin.school_health_for and nowhere else. The school's label is its worst
-- signal written out; at the same colour, safety comes first, then licence,
-- payment, seats, teaching, learning, attendance, activation, last active.
-- Counts only: no child is named, listed or ranked.
--
-- PAYMENT comes from admin.school_payment_signal. Until billing replaces it
-- in place (same signature, same grants) it says grey: "No billing account
-- yet."
--
-- ON HOLIDAY: admin.school_profile.quiet_until turns the teaching, learning,
-- attendance and last-active signals grey until that day, because there is
-- no school calendar in the schema.

-- The payment signal: internal, called only by other definer functions.
create or replace function admin.school_payment_signal(p_org uuid)
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  select jsonb_build_object('level', 'grey', 'reason', 'No billing account yet.')
$$;

create table if not exists admin.school_profile (
  org_id uuid primary key references lms.school on delete cascade,
  quiet_until date,
  offboarded_at timestamptz,
  offboarded_by uuid,
  updated_at timestamptz not null default now()
);
revoke all on admin.school_profile from public, anon, authenticated;
alter table admin.school_profile enable row level security;

drop trigger if exists school_profile_tripwire on admin.school_profile;
create trigger school_profile_tripwire
  after insert or update or delete on admin.school_profile
  for each row execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- Helpers. Internal.
-- ---------------------------------------------------------------------------

create or replace function admin.school_org(p_code text)
returns uuid
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  org uuid;
begin
  select s.org_id into org from lms.school s where s.code = upper(btrim(coalesce(p_code, '')));
  if org is null then
    raise exception 'there is no school with the code %', upper(btrim(coalesce(p_code, '(none)')));
  end if;
  return org;
end;
$$;

create or replace function admin.require_reason(p_reason text)
returns void
language plpgsql immutable
as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why, in a few words';
  end if;
end;
$$;

create or replace function admin.signal(p_key text, p_level text, p_reason text)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('key', p_key, 'level', p_level, 'reason', p_reason)
$$;

-- '1 unread report', '3 unread reports'.
create or replace function admin.count_of(p_n integer, p_thing text)
returns text
language sql immutable
as $$
  select p_n || ' ' || p_thing || case when p_n = 1 then '' else 's' end
$$;

-- 'today', 'in 1 day', 'in 9 days'.
create or replace function admin.in_days(p_n integer)
returns text
language sql immutable
as $$
  select case when p_n = 0 then 'today' when p_n = 1 then 'in 1 day' else 'in ' || p_n || ' days' end
$$;

-- '60%', rounded down; '0%' of nothing.
create or replace function admin.pct(p_part integer, p_whole integer)
returns text
language sql immutable
as $$
  select case when coalesce(p_whole, 0) = 0 then '0%' else (p_part * 100 / p_whole) || '%' end
$$;

-- A typed search term, made safe for LIKE (backslash is LIKE's default escape).
create or replace function admin.like_escape(p_text text)
returns text
language sql immutable
as $$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- ---------------------------------------------------------------------------
-- The health card. Internal; every threshold of the card is here.
-- ---------------------------------------------------------------------------

create or replace function admin.school_health_for(p_org uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  today date := lms.india_today();
  quiet_day date;
  quiet boolean;
  quiet_reason text;
  lic lms.licence;
  days_left integer;
  used integer;
  students integer;
  first_added date;
  did_something integer;
  has_classes boolean;
  last_pub timestamptz;
  due_recently boolean;
  handed integer;
  last_mark date;
  tutor_used boolean;
  unread integer;
  unread_unsafe integer;
  last_active date;
  pay jsonb := admin.school_payment_signal(p_org);
  s_licence jsonb;
  s_payment jsonb;
  s_seats jsonb;
  s_activation jsonb;
  s_teaching jsonb;
  s_learning jsonb;
  s_attendance jsonb;
  s_safety jsonb;
  s_last jsonb;
  worst jsonb;
  out_level text;
  out_label text;
begin
  select p.quiet_until into quiet_day from admin.school_profile p where p.org_id = p_org;
  quiet := quiet_day is not null and quiet_day >= today;
  quiet_reason := 'On holiday until ' || to_char(quiet_day, 'YYYY-MM-DD') || '; not counted.';

  -- Licence (0041).
  select l.* into lic from lms.licence l where l.org_id = p_org;
  days_left := lic.valid_until - today;
  s_licence := case
    when lic.org_id is null then admin.signal('licence', 'grey', 'No licence is set.')
    when days_left < 0 then admin.signal('licence', 'red', 'The licence ended on ' || to_char(lic.valid_until, 'YYYY-MM-DD') || '.')
    when days_left <= 7 then admin.signal('licence', 'red', 'The licence ends ' || admin.in_days(days_left) || '.')
    when days_left <= 30 then admin.signal('licence', 'amber', 'The licence ends ' || admin.in_days(days_left) || '.')
    else admin.signal('licence', 'green', days_left || ' days of licence left.')
  end;

  -- Payment (billing; a stub until plan 3).
  s_payment := admin.signal('payment', pay ->> 'level', pay ->> 'reason');

  -- Seats (0041).
  used := lms.seats_used(p_org);
  s_seats := case
    when lic.org_id is null then admin.signal('seats', 'grey', 'No licence, so no seats are counted.')
    when used > lic.seats then admin.signal('seats', 'red', used || ' of ' || lic.seats || ' seats used: more than bought.')
    when used * 10 >= lic.seats * 9 then admin.signal('seats', 'amber', used || ' of ' || lic.seats || ' seats used.')
    else admin.signal('seats', 'green', used || ' of ' || lic.seats || ' seats used.')
  end;

  -- Activation: students who have handed in work or have a ledger event here.
  select count(*) filter (where a.left_at is null)::int,
         min((a.created_at at time zone 'Asia/Kolkata')::date)
    into students, first_added
    from lms.account a
   where a.org_id = p_org and a.kind = 'student';
  select count(*)::int into did_something
    from lms.account a
   where a.org_id = p_org and a.kind = 'student' and a.left_at is null
     and (exists (select 1 from lms.submission s where s.org_id = p_org and s.student_user_id = a.user_id)
          or exists (select 1 from public.ledger_event e where e.org_id = p_org and e.user_id = a.user_id));
  s_activation := case
    when students = 0 then admin.signal('activation', 'grey', 'No students yet.')
    when today - first_added < 14 then admin.signal('activation', 'grey', 'Fewer than 14 days since the first students were added.')
    when did_something * 100 >= students * 60 then admin.signal('activation', 'green', admin.pct(did_something, students) || ' of students have done something.')
    when did_something * 100 >= students * 30 then admin.signal('activation', 'amber', admin.pct(did_something, students) || ' of students have done something.')
    else admin.signal('activation', 'red', admin.pct(did_something, students) || ' of students have done something.')
  end;

  -- Teaching: homework published (0023).
  select exists (
    select 1 from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
     where ta.org_id = p_org and sec.academic_year_id = lms.current_year(p_org)
  ) into has_classes;
  select max(a.published_at) into last_pub from lms.assignment a where a.org_id = p_org and a.published_at is not null;
  s_teaching := case
    when not has_classes then admin.signal('teaching', 'grey', 'No classes are set up yet.')
    when quiet then admin.signal('teaching', 'grey', quiet_reason)
    when last_pub > now() - interval '7 days' then admin.signal('teaching', 'green', 'Homework was published in the last 7 days.')
    when last_pub > now() - interval '14 days' then admin.signal('teaching', 'amber', 'No homework published in 7 days.')
    when last_pub is null then admin.signal('teaching', 'red', 'No homework has been published yet.')
    else admin.signal('teaching', 'red', 'No homework published in 14 days.')
  end;

  -- Learning: students who handed in work in the last 7 days, when something was due.
  select exists (
    select 1 from lms.assignment a
     where a.org_id = p_org and a.published_at is not null
       and a.due_at > now() - interval '7 days' and a.due_at <= now()
  ) into due_recently;
  select count(distinct s.student_user_id)::int into handed
    from lms.submission s
    join lms.account a on a.user_id = s.student_user_id and a.left_at is null
   where s.org_id = p_org and s.submitted_at > now() - interval '7 days';
  s_learning := case
    when students = 0 or not due_recently then admin.signal('learning', 'grey', 'Nothing was due in the last 7 days.')
    when quiet then admin.signal('learning', 'grey', quiet_reason)
    when handed * 100 >= students * 30 then admin.signal('learning', 'green', admin.pct(handed, students) || ' of students handed in work in the last 7 days.')
    when handed * 100 >= students * 10 then admin.signal('learning', 'amber', admin.pct(handed, students) || ' of students handed in work in the last 7 days.')
    else admin.signal('learning', 'red', admin.pct(handed, students) || ' of students handed in work in the last 7 days.')
  end;

  -- Attendance (0036), by the day it was marked.
  select max((at.marked_at at time zone 'Asia/Kolkata')::date) into last_mark from lms.attendance at where at.org_id = p_org;
  s_attendance := case
    when last_mark is null then admin.signal('attendance', 'grey', 'Attendance is not used at this school.')
    when quiet then admin.signal('attendance', 'grey', quiet_reason)
    when today - last_mark <= 2 then admin.signal('attendance', 'green', 'Attendance was marked on ' || to_char(last_mark, 'YYYY-MM-DD') || '.')
    when today - last_mark < 7 then admin.signal('attendance', 'amber', 'Attendance not marked in ' || (today - last_mark) || ' days.')
    else admin.signal('attendance', 'red', 'Attendance not marked in ' || (today - last_mark) || ' days.')
  end;

  -- Safety (0019): unread reports by this school's children. Counts only.
  select count(*) filter (where r.status = 'new')::int,
         count(*) filter (where r.status = 'new' and r.kind = 'unsafe')::int
    into unread, unread_unsafe
    from public.student_report r
   where r.org_id = p_org;
  select exists (
    select 1 from public.learning_session ls
     where ls.org_id = p_org and ls.source in ('class', 'quiz', 'diagnostic', 'doubt')
  ) into tutor_used;
  s_safety := case
    when unread_unsafe > 0 then admin.signal('safety', 'red', admin.count_of(unread_unsafe, 'unread unsafe report') || '.')
    when unread > 0 then admin.signal('safety', 'amber', admin.count_of(unread, 'unread report') || '.')
    when not tutor_used then admin.signal('safety', 'grey', 'Nobody at this school has used the tutor, where the report button is.')
    else admin.signal('safety', 'green', 'No unread reports.')
  end;

  -- Last active: the four sources lms.founder_schools reads (0041:135-143).
  select (greatest(
            (select max(at.marked_at) from lms.attendance at where at.org_id = p_org),
            (select max(sub.submitted_at) from lms.submission sub where sub.org_id = p_org),
            (select max(a.published_at) from lms.assignment a where a.org_id = p_org),
            (select max(le.received_at) from public.ledger_event le where le.org_id = p_org)
          ) at time zone 'Asia/Kolkata')::date
    into last_active;
  s_last := case
    when last_active is null then admin.signal('lastActive', 'grey', 'No activity yet.')
    when quiet then admin.signal('lastActive', 'grey', quiet_reason)
    when today - last_active <= 3 then admin.signal('lastActive', 'green', 'Last active on ' || to_char(last_active, 'YYYY-MM-DD') || '.')
    when today - last_active <= 14 then admin.signal('lastActive', 'amber', 'Last active ' || (today - last_active) || ' days ago.')
    else admin.signal('lastActive', 'red', 'Not active for ' || (today - last_active) || ' days.')
  end;

  -- The label: the first red, else the first amber, in priority order.
  select t.x into worst
    from jsonb_array_elements(jsonb_build_array(
           s_safety, s_licence, s_payment, s_seats, s_teaching, s_learning, s_attendance, s_activation, s_last
         )) with ordinality as t(x, n)
   where t.x ->> 'level' in ('red', 'amber')
   order by case t.x ->> 'level' when 'red' then 0 else 1 end, t.n
   limit 1;
  if worst is not null then
    out_level := worst ->> 'level';
    out_label := case out_level when 'red' then 'Needs attention: ' else 'Watch: ' end
              || lower(left(worst ->> 'reason', 1)) || rtrim(substr(worst ->> 'reason', 2), '.');
  elsif 'green' in (s_licence ->> 'level', s_payment ->> 'level', s_seats ->> 'level', s_activation ->> 'level',
                    s_teaching ->> 'level', s_learning ->> 'level', s_attendance ->> 'level', s_safety ->> 'level',
                    s_last ->> 'level') then
    out_level := 'green';
    out_label := 'Healthy';
  else
    out_level := 'grey';
    out_label := 'Not enough to tell yet';
  end if;

  return jsonb_build_object(
    'level', out_level,
    'label', out_label,
    'quietUntil', case when quiet then to_char(quiet_day, 'YYYY-MM-DD') end,
    'lastActiveOn', to_char(last_active, 'YYYY-MM-DD'),
    'students', students,
    'signals', jsonb_build_array(s_licence, s_payment, s_seats, s_activation, s_teaching, s_learning, s_attendance, s_safety, s_last)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- What the console calls.
-- ---------------------------------------------------------------------------

create or replace function admin.school_health(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
  org uuid;
begin
  org := admin.school_org(p_code);
  return admin.school_health_for(org) || jsonb_build_object('code', (select s.code from lms.school s where s.org_id = org));
end;
$$;

create or replace function admin.school_index()
returns table (code text, name text)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff();
begin
  return query select s.code, s.display_name from lms.school s order by s.display_name;
end;
$$;

create or replace function admin.school_list()
returns table (
  org_id uuid, code text, name text, plan text, seats integer, seats_used integer, valid_until text, days_left integer,
  payment_level text, payment_reason text, health_level text, health_label text, last_active text,
  students integer, teachers integer, offboarded boolean
)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff();
begin
  return query
    select s.org_id, s.code, s.display_name, l.plan, l.seats, lms.seats_used(s.org_id),
           to_char(l.valid_until, 'YYYY-MM-DD'), (l.valid_until - lms.india_today())::int,
           x.pay ->> 'level', x.pay ->> 'reason', x.h ->> 'level', x.h ->> 'label', x.h ->> 'lastActiveOn',
           (x.h ->> 'students')::int,
           (select count(*)::int from lms.account a where a.org_id = s.org_id and a.kind = 'teacher' and a.left_at is null),
           p.offboarded_at is not null
      from lms.school s
      left join lms.licence l on l.org_id = s.org_id
      left join admin.school_profile p on p.org_id = s.org_id
      cross join lateral (select admin.school_health_for(s.org_id) as h, admin.school_payment_signal(s.org_id) as pay) x
     order by s.code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function admin.school_payment_signal(uuid) from public, anon, authenticated;
revoke all on function admin.school_org(text) from public, anon, authenticated;
revoke all on function admin.require_reason(text) from public, anon, authenticated;
revoke all on function admin.signal(text, text, text) from public, anon, authenticated;
revoke all on function admin.count_of(integer, text) from public, anon, authenticated;
revoke all on function admin.in_days(integer) from public, anon, authenticated;
revoke all on function admin.pct(integer, integer) from public, anon, authenticated;
revoke all on function admin.like_escape(text) from public, anon, authenticated;
revoke all on function admin.school_health_for(uuid) from public, anon, authenticated;
revoke all on function admin.school_health(text) from public, anon;
revoke all on function admin.school_index() from public, anon;
revoke all on function admin.school_list() from public, anon;

grant execute on function admin.school_health(text) to authenticated;
grant execute on function admin.school_index() to authenticated;
grant execute on function admin.school_list() to authenticated;
