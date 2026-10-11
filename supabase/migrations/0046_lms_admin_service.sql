-- WHAT THE SCHOOL PORTAL'S ADMIN CALLS NEED FROM THE DATABASE.
--
-- Adding people from the sheets, giving a new PIN and giving a parent a
-- sign-in create or change sign-ins, which takes the service role: on the
-- hosted project the lms-admin edge function does it
-- (tools/lms-import/src/admin.ts), in the demo the demo server
-- (tools/lms-demo/src/import.ts). Both read and write the school through
-- these functions, so the two cannot drift apart. Every one of them is for
-- the service role only; the caller's right to act is checked by the
-- function's caller first (admin_school).
--
-- import_snapshot: what the school has now, as tools/lms-import's preview
--   reads it (SchoolSnapshot): its config and this year (0037's
--   current_year), everybody's ID, kind, name, this year's class and roll,
--   the classes each teacher teaches this year, this year's sections, the
--   subjects, and the licence's seats and those in use (0041).
-- admin_school: the school of an admin who has not left (0034); else null.
-- account_by_login: one account of a school by its ID, for a new PIN.
-- audit_by: an activity-log entry (0034) with the caller as its actor —
--   lms.audit takes the actor from the request, and the service role has none.
-- end_sessions: signs a person out everywhere, where the project keeps
--   sessions in auth.sessions (Supabase does; the demo keeps its own).
-- next_parent_login / attach_parent: a parent's next P-number ID, and, once
--   their account exists, linking it to the child (0045) with the log entry.
--
-- Written against tools/lms-import/tests/admin.test.ts, first.

create or replace function lms.import_snapshot(p_org uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  s lms.school;
  y lms.academic_year;
begin
  select * into s from lms.school where org_id = p_org;
  select * into y from lms.academic_year where id = lms.current_year(p_org);
  if s.org_id is null or y.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'config', jsonb_strip_nulls(jsonb_build_object(
      'code', s.code, 'displayName', s.display_name, 'shortName', s.short_name, 'board', s.board,
      'year', jsonb_build_object('label', y.label, 'startsOn', y.starts_on::text, 'endsOn', y.ends_on::text))),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'loginId', a.login_id, 'kind', a.kind, 'displayName', a.display_name,
               'className', en.class_name, 'roll', en.roll,
               'teaches', coalesce((
                 select jsonb_agg(sec.grade || sec.name || ' ' || sub.name order by sec.grade, sec.name, sub.name)
                   from lms.teaching_assignment ta
                   join lms.section sec on sec.id = ta.section_id and sec.academic_year_id = y.id
                   join lms.subject sub on sub.id = ta.subject_id
                  where ta.teacher_user_id = a.user_id), '[]'::jsonb))
             order by a.login_id)
        from lms.account a
        left join lateral (
          select sec.grade || sec.name as class_name, e.roll_number as roll
            from lms.enrolment e join lms.section sec on sec.id = e.section_id
           where e.student_user_id = a.user_id and e.academic_year_id = y.id and e.left_on is null
           limit 1
        ) en on true
       where a.org_id = p_org), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(sec.grade || sec.name order by sec.grade, sec.name)
                            from lms.section sec where sec.academic_year_id = y.id), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(sub.name order by sub.name) from lms.subject sub where sub.org_id = p_org), '[]'::jsonb),
    'licence', (select jsonb_build_object('seats', l.seats, 'used', lms.seats_used(l.org_id))
                  from lms.licence l where l.org_id = p_org)
  );
end;
$$;

create or replace function lms.admin_school(p_user uuid)
returns uuid
language sql stable security definer
set search_path = public, lms
as $$
  select a.org_id from lms.account a
   where a.user_id = p_user and a.kind = 'admin' and a.left_at is null
     and exists (select 1 from public.membership m where m.org_id = a.org_id and m.user_id = p_user);
$$;

create or replace function lms.account_by_login(p_org uuid, p_login text)
returns jsonb
language sql stable security definer
set search_path = public, lms
as $$
  select jsonb_build_object('userId', a.user_id, 'kind', a.kind, 'displayName', a.display_name, 'leftAt', a.left_at)
    from lms.account a where a.org_id = p_org and a.login_id = upper(btrim(p_login));
$$;

create or replace function lms.audit_by(p_org uuid, p_actor uuid, p_action text, p_target text, p_details jsonb default null)
returns void
language sql volatile security definer
set search_path = public, lms
as $$
  insert into lms.audit_event (org_id, actor, action, target, details)
  values (p_org, p_actor, p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function lms.end_sessions(p_user uuid)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
begin
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;
end;
$$;

-- One more than the school's highest P-number; a gap is never reused.
create or replace function lms.next_parent_login(p_org uuid)
returns text
language sql stable security definer
set search_path = public, lms
as $$
  select s.code || '-P' || (coalesce((select max(substring(a.login_id from '-P([0-9]+)$')::int)
                                         from lms.account a where a.org_id = p_org and a.kind = 'parent'), 0) + 1)
    from lms.school s where s.org_id = p_org;
$$;

create or replace function lms.attach_parent(p_org uuid, p_actor uuid, p_parent_login text, p_child_login text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  parent lms.account;
  child lms.account;
begin
  select * into parent from lms.account where org_id = p_org and login_id = p_parent_login;
  select * into child from lms.account where org_id = p_org and login_id = p_child_login;
  if parent.kind is distinct from 'parent' then
    raise exception '% is not a parent at this school', p_parent_login;
  end if;
  if child.kind is distinct from 'student' or child.left_at is not null then
    raise exception '% is not a student at this school', p_child_login;
  end if;
  insert into lms.guardian (parent_user_id, student_user_id, org_id) values (parent.user_id, child.user_id, p_org)
  on conflict do nothing;
  insert into lms.audit_event (org_id, actor, action, target) values (p_org, p_actor, 'parent-added', p_parent_login || ' ' || p_child_login);
end;
$$;

revoke all on function lms.import_snapshot(uuid) from public, anon, authenticated;
revoke all on function lms.admin_school(uuid) from public, anon, authenticated;
revoke all on function lms.account_by_login(uuid, text) from public, anon, authenticated;
revoke all on function lms.audit_by(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function lms.end_sessions(uuid) from public, anon, authenticated;
revoke all on function lms.next_parent_login(uuid) from public, anon, authenticated;
revoke all on function lms.attach_parent(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function lms.import_snapshot(uuid) to service_role;
grant execute on function lms.admin_school(uuid) to service_role;
grant execute on function lms.account_by_login(uuid, text) to service_role;
grant execute on function lms.audit_by(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function lms.end_sessions(uuid) to service_role;
grant execute on function lms.next_parent_login(uuid) to service_role;
grant execute on function lms.attach_parent(uuid, uuid, text, text) to service_role;
