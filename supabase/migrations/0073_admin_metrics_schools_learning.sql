-- SCHOOLS OVER TIME, SIGN-INS PER SCHOOL (plan 6, the Schools chart page).
--
-- Per school, each India day:
--   school.health        the health card's level, one row valued 1 (snapshot)
--   school.students      active student accounts (snapshot)
--   school.seats_used    lms.seats_used (snapshot)
--   school.seats_bought  the licence's seats, when there is a licence (snapshot)
--   school.activated     students who have handed in work or have a ledger
--                        event here (snapshot; admin.school_health_for's
--                        activation, 0052:186-196)
--   school.handed_in_7d  students who handed in work in the 7 days ending that
--                        day (the health card's learning count, 0052:221-230)
--   school.homework_published  homework published that day
--   school.active        1 when attendance was marked, work handed in,
--                        homework published or a ledger event received there
--                        that day, else 0 (the health card's last-active
--                        sources, 0052:266-273)
--   school.signins       students whose last sign-in (auth.users.last_sign_in_at)
--                        fell that day, written only where that column exists
--                        (R14); a student is counted once a day (snapshot)
--
-- Snapshots are written by the nightly run only (R7). Activation, hand-ins and
-- sign-ins are figures about a school's children: each carries the school's
-- active student count, and admin.metric_json hides it for fewer than 10
-- (R2, R3).

create or replace function admin.metric_family_schools(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  day_start timestamptz := admin.ist_start(p_day);
  day_end timestamptz := admin.ist_start(p_day + 1);
  readable boolean := admin.signins_readable();
  sc record;
  h jsonb;
  students integer;
  signins integer;
  n integer;
  total integer := 0;
begin
  for sc in select s.org_id from lms.school s order by s.code loop
    select count(*)::int into students
      from lms.account a
     where a.org_id = sc.org_id and a.kind = 'student' and a.left_at is null;

    if p_nightly then
      h := admin.school_health_for(sc.org_id);
      insert into admin.metric_daily (day, metric, org_id, dim, value, children)
      select p_day, 'school.health', sc.org_id, coalesce(h ->> 'level', 'grey'), 1, null::int
      union all select p_day, 'school.students', sc.org_id, '', students, null
      union all select p_day, 'school.seats_used', sc.org_id, '', lms.seats_used(sc.org_id), null
      union all select p_day, 'school.seats_bought', sc.org_id, '', l.seats, null
                  from lms.licence l where l.org_id = sc.org_id
      union all select p_day, 'school.activated', sc.org_id, '', count(*), students
                  from lms.account a
                 where a.org_id = sc.org_id and a.kind = 'student' and a.left_at is null
                   and (exists (select 1 from lms.submission s where s.org_id = sc.org_id and s.student_user_id = a.user_id)
                        or exists (select 1 from public.ledger_event e where e.org_id = sc.org_id and e.user_id = a.user_id));
      get diagnostics n = row_count;
      total := total + n;

      if readable then
        execute 'select count(distinct a.user_id)::int
                   from lms.account a
                   join auth.users u on u.id = a.user_id
                  where a.org_id = $1 and a.kind = ''student'' and a.left_at is null
                    and u.last_sign_in_at >= $2 and u.last_sign_in_at < $3'
          into signins using sc.org_id, day_start, day_end;
        insert into admin.metric_daily (day, metric, org_id, dim, value, children)
        values (p_day, 'school.signins', sc.org_id, '', signins, students);
        total := total + 1;
      end if;
    end if;

    insert into admin.metric_daily (day, metric, org_id, dim, value, children)
    select p_day, 'school.homework_published', sc.org_id, '', count(*), null::int
      from lms.assignment a
     where a.org_id = sc.org_id and a.published_at >= day_start and a.published_at < day_end
    union all
    select p_day, 'school.active', sc.org_id, '',
           case when exists (select 1 from lms.attendance at
                              where at.org_id = sc.org_id and at.marked_at >= day_start and at.marked_at < day_end)
                  or exists (select 1 from lms.submission s
                              where s.org_id = sc.org_id and s.submitted_at >= day_start and s.submitted_at < day_end)
                  or exists (select 1 from lms.assignment a
                              where a.org_id = sc.org_id and a.published_at >= day_start and a.published_at < day_end)
                  or exists (select 1 from public.ledger_event le
                              where le.org_id = sc.org_id and le.received_at >= day_start and le.received_at < day_end)
                then 1 else 0 end, null::int
    union all
    select p_day, 'school.handed_in_7d', sc.org_id, '', count(distinct s.student_user_id), students
      from lms.submission s
      join lms.account a on a.user_id = s.student_user_id and a.left_at is null
     where s.org_id = sc.org_id and s.submitted_at >= day_end - interval '7 days' and s.submitted_at < day_end;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end;
$$;

insert into admin.metric_family (name, position, fn) values
  ('schools', 70, 'admin.metric_family_schools')
on conflict (name) do update set position = excluded.position, fn = excluded.fn;

do $cat$
begin
perform set_config('admin.session', 'on', true);
insert into admin.metric_def (key, position, pages, label, unit, day_kind, kind, scope, child_figure, total, why)
values
  ('school.health', 300, array['schools'], 'Health', 'count', 'india', 'snapshot', 'school', false, 'none', null),
  ('school.students', 310, array['schools'], 'Students', 'count', 'india', 'snapshot', 'school', false, 'last', null),
  ('school.seats_used', 320, array['schools'], 'Seats used', 'count', 'india', 'snapshot', 'school', false, 'last', null),
  ('school.seats_bought', 321, array['schools'], 'Seats bought', 'count', 'india', 'snapshot', 'school', false, 'last', null),
  ('school.activated', 330, array['schools'], 'Students who have done anything', 'count', 'india', 'snapshot', 'school', true, 'last', null),
  ('school.handed_in_7d', 340, array['schools'], 'Students who handed in work in 7 days', 'count', 'india', 'window', 'school', true, 'last', null),
  ('school.homework_published', 350, array['schools'], 'Homework published', 'count', 'india', 'daily', 'school', false, 'sum', null),
  ('school.active', 360, array['schools'], 'Any activity (0 or 1)', 'count', 'india', 'daily', 'school', false, 'none', null),
  ('school.signins', 370, array['schools'], 'Students who signed in', 'count', 'india', 'snapshot', 'school', true, 'none',
   'This database does not record when people sign in (auth.users has no last_sign_in_at).')
on conflict (key) do update set position = excluded.position, pages = excluded.pages, label = excluded.label,
  unit = excluded.unit, day_kind = excluded.day_kind, kind = excluded.kind, scope = excluded.scope,
  child_figure = excluded.child_figure, total = excluded.total, why = excluded.why;
perform set_config('admin.session', '', true);
end;
$cat$;

revoke all on function admin.metric_family_schools(date, boolean) from public, anon, authenticated, service_role;
