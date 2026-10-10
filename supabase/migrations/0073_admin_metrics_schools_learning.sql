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

-- ---------------------------------------------------------------------------
-- LEARNING IN AGGREGATE AND THE CONTEST FUNNEL (plan 6, the Learning and
-- Funnel chart pages).
--
-- learn.outcomes_covered_30d  outcomes answered in the 30 days ending that
--   day, by class and subject (dim '<grade>|<subject>'), from answers in the
--   ledger (the tutor and practice) and homework MCQ answers; the platform
--   writes every class and subject of the syllabus map (0 when nobody
--   answered), each school only those its children answered. Children = who
--   answered.
-- learn.outcomes_total  outcomes in the syllabus map (lms.outcome) by class
--   and subject.
-- learn.misconceptions_30d  wrong answers in the 30 days ending that day on
--   LIBRARY questions only (R18: a school's own labels are its teacher's
--   words), from homework MCQ answers and practice answers, by class,
--   subject and the label at the chosen option (as 0040 and 0031 read it);
--   the platform only. Children = who chose it.
-- learn.practice_answers  practice answers the server received that day, at
--   the platform and per school. Children = who practised.
-- funnel.*  contest entries by India day; and cohorts by entry day (R19):
--   entrants, those with a consent record, those with a class sitting, and
--   those with sittings on two India days. Every cohort row carries the
--   cohort's size as its group, and admin.metric_json returns cohorts as
--   window totals only. A recompute rewrites the one cohort of its day; the
--   nightly run rewrites the last 30.
--
-- Every learning and cohort figure is hidden at read for fewer than 10
-- children (R2, R3).
-- ---------------------------------------------------------------------------

create or replace function admin.metric_family_learning(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  day_start timestamptz := admin.ist_start(p_day);
  day_end timestamptz := admin.ist_start(p_day + 1);
  win_start timestamptz := admin.ist_start(p_day + 1) - interval '30 days';
  n integer;
  total integer := 0;
begin
  -- Outcomes answered, and the syllabus map's size.
  with answers as materialized (
    select le.user_id, le.org_id, unnest(le.outcome_ids) as outcome
      from public.ledger_event le
     where le.kind = 'answered' and le.received_at >= win_start and le.received_at < day_end
    union all
    select s.student_user_id, s.org_id, unnest(i.outcome_ids)
      from lms.submission s
      join lms.submission_answer sa on sa.submission_id = s.id
      join lms.item i on i.id = sa.item_id
     where s.submitted_at >= win_start and s.submitted_at < day_end
  ), g as materialized (
    select a.user_id, a.org_id, o.id as outcome, o.grade || '|' || o.subject as gs,
           exists (select 1 from lms.school sc where sc.org_id = a.org_id) as at_school
      from answers a
      join lms.outcome o on o.id = a.outcome
  ), syllabus as (
    select o.grade || '|' || o.subject as gs, count(*) as outcomes
      from lms.outcome o
     group by o.grade, o.subject
  )
  insert into admin.metric_daily (day, metric, org_id, dim, value, children)
  select p_day, 'learn.outcomes_covered_30d', null::uuid, sy.gs,
         (select count(distinct g.outcome) from g where g.gs = sy.gs),
         (select count(distinct g.user_id) from g where g.gs = sy.gs)::int
    from syllabus sy
  union all
  select p_day, 'learn.outcomes_covered_30d', g.org_id, g.gs, count(distinct g.outcome), count(distinct g.user_id)::int
    from g where g.at_school
   group by g.org_id, g.gs
  union all
  select p_day, 'learn.outcomes_total', null::uuid, sy.gs, sy.outcomes, null::int
    from syllabus sy;
  get diagnostics n = row_count;
  total := total + n;

  -- Misconceptions: wrong options of library questions only.
  with wrong as materialized (
    select s.student_user_id as user_id, sa.item_id, sa.chosen_index::int as chosen
      from lms.submission s
      join lms.submission_answer sa on sa.submission_id = s.id
     where s.submitted_at >= win_start and s.submitted_at < day_end and sa.chosen_index is not null
    union all
    select le.user_id,
           case when le.payload ->> 'itemId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (le.payload ->> 'itemId')::uuid end,
           case when le.payload ->> 'chosenIndex' ~ '^[0-9]{1,2}$' then (le.payload ->> 'chosenIndex')::int end
      from public.ledger_event le
     where le.kind = 'answered' and le.source = 'practice'
       and le.received_at >= win_start and le.received_at < day_end
  ), labelled as (
    select w.user_id,
           coalesce(
             (select o.grade || '|' || o.subject from lms.outcome o
               where o.id = any (i.outcome_ids) order by o.position, o.id limit 1),
             case when i.grade is not null and i.subject is not null then i.grade || '|' || i.subject end
           ) as gs,
           case when jsonb_typeof(i.misconceptions) = 'array'
                then nullif(btrim(i.misconceptions ->> w.chosen), '') end as label
      from wrong w
      join lms.item i on i.id = w.item_id
     where i.org_id is null and i.kind = 'mcq' and w.chosen is not null and w.chosen <> i.correct_index
  )
  insert into admin.metric_daily (day, metric, org_id, dim, value, children)
  select p_day, 'learn.misconceptions_30d', null::uuid, l.gs || '|' || left(l.label, 120), count(*), count(distinct l.user_id)::int
    from labelled l
   where l.gs is not null and l.label is not null
   group by l.gs || '|' || left(l.label, 120);
  get diagnostics n = row_count;
  total := total + n;

  -- Practice answers that day.
  with p as materialized (
    select le.user_id, le.org_id,
           exists (select 1 from lms.school sc where sc.org_id = le.org_id) as at_school
      from public.ledger_event le
     where le.kind = 'answered' and le.source = 'practice'
       and le.received_at >= day_start and le.received_at < day_end
  )
  insert into admin.metric_daily (day, metric, org_id, dim, value, children)
  select p_day, 'learn.practice_answers', null::uuid, '', count(*), count(distinct p.user_id)::int from p
  union all
  select p_day, 'learn.practice_answers', p.org_id, '', count(*), count(distinct p.user_id)::int
    from p where p.at_school group by p.org_id;
  get diagnostics n = row_count;
  return total + n;
end;
$$;

create or replace function admin.metric_family_funnel(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  c date;
  n integer;
  total integer := 0;
begin
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, 'funnel.entries', '', count(*)
    from public.contest_signup cs
   where cs.created_at >= admin.ist_start(p_day) and cs.created_at < admin.ist_start(p_day + 1);
  get diagnostics n = row_count;
  total := total + n;

  for c in
    select p_day - k from generate_series(0, case when p_nightly then 29 else 0 end) k
  loop
    delete from admin.metric_daily m
     where m.day = c and m.metric in ('funnel.cohort', 'funnel.verified', 'funnel.first_class', 'funnel.second_day');
    with ent as materialized (
      select cs.user_id
        from public.contest_signup cs
       where cs.created_at >= admin.ist_start(c) and cs.created_at < admin.ist_start(c + 1)
    ), f as (
      select count(*)::bigint as entrants,
             (count(*) filter (where exists (select 1 from public.consent_record cr where cr.user_id = ent.user_id)))::bigint as verified,
             (count(*) filter (where exists (select 1 from public.learning_session ls
                                             where ls.user_id = ent.user_id and ls.source = 'class')))::bigint as first_class,
             (count(*) filter (where (select count(distinct (ls.received_at at time zone 'Asia/Kolkata')::date)
                                        from public.learning_session ls where ls.user_id = ent.user_id) >= 2))::bigint as second_day
        from ent
    )
    insert into admin.metric_daily (day, metric, dim, value, children)
    select c, x.metric, '', x.value, f.entrants::int
      from f
     cross join lateral (values
       ('funnel.cohort', f.entrants),
       ('funnel.verified', f.verified),
       ('funnel.first_class', f.first_class),
       ('funnel.second_day', f.second_day)) as x(metric, value);
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end;
$$;

insert into admin.metric_family (name, position, fn) values
  ('learning', 80, 'admin.metric_family_learning'),
  ('funnel', 90, 'admin.metric_family_funnel')
on conflict (name) do update set position = excluded.position, fn = excluded.fn;

do $cat$
begin
perform set_config('admin.session', 'on', true);
insert into admin.metric_def (key, position, pages, label, unit, day_kind, kind, scope, child_figure, total)
values
  ('learn.outcomes_covered_30d', 400, array['learning'], 'Outcomes answered in 30 days', 'count', 'india', 'window', 'both', true, 'none'),
  ('learn.outcomes_total', 401, array['learning'], 'Outcomes in the syllabus map', 'count', 'india', 'daily', 'platform', false, 'none'),
  ('learn.misconceptions_30d', 410, array['learning'], 'Answers showing a misconception, 30 days', 'count', 'india', 'window', 'platform', true, 'none'),
  ('learn.practice_answers', 420, array['learning'], 'Practice answers', 'count', 'india', 'daily', 'both', true, 'none'),
  ('funnel.entries', 450, array['funnel'], 'Contest entries', 'count', 'india', 'daily', 'platform', false, 'sum'),
  ('funnel.cohort', 451, array['funnel'], 'Entrants', 'count', 'india', 'cohort', 'platform', true, 'sum'),
  ('funnel.verified', 452, array['funnel'], 'A parent verified', 'count', 'india', 'cohort', 'platform', true, 'sum'),
  ('funnel.first_class', 453, array['funnel'], 'Had a first class', 'count', 'india', 'cohort', 'platform', true, 'sum'),
  ('funnel.second_day', 454, array['funnel'], 'Came back on a second day', 'count', 'india', 'cohort', 'platform', true, 'sum')
on conflict (key) do update set position = excluded.position, pages = excluded.pages, label = excluded.label,
  unit = excluded.unit, day_kind = excluded.day_kind, kind = excluded.kind, scope = excluded.scope,
  child_figure = excluded.child_figure, total = excluded.total;
perform set_config('admin.session', '', true);
end;
$cat$;

revoke all on function admin.metric_family_learning(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.metric_family_funnel(date, boolean) from public, anon, authenticated, service_role;
