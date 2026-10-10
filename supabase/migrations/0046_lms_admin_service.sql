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
-- And, in its own section at the end, THE HOSTED SIGN-IN'S GUARD: the
-- tables sign_in_guard and sign_in_ip and the functions pin_guard_try,
-- pin_guard_passed and pin_guard_set, which the lms-signin edge function
-- (tools/lms-import/src/signIn.ts) keeps its per-ID lockout and per-address
-- limit in, and which the import and the admin calls write a new PIN's row
-- to. Service role only, like the rest.
--
-- Written against tools/lms-import/tests/admin.test.ts and
-- tools/lms-import/tests/signIn.test.ts, first.

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

-- ---------------------------------------------------------------------------
-- THE HOSTED SIGN-IN'S GUARD.
--
-- Supabase Auth has no per-ID lockout, so on the hosted project its password
-- is not the PIN: it is made from the ID and PIN with a secret only the edge
-- functions and the import CLI hold (tools/lms-import/src/pinGuard.ts). The
-- lms-signin function hands it back only for the right PIN, keeping the
-- demo's rules (tools/lms-demo/src/auth.ts) in these two tables:
--
-- sign_in_guard: one row per ID — its PIN's salt and verifier (made with the
--   same secret, so this table alone cannot be searched for PINs), the wrong
--   tries in a row, and until when the ID is locked.
-- sign_in_ip: per caller address, the tries not yet proven right in its
--   current 15-minute window. The address is the key lms-signin's callerKey
--   reads (tools/lms-import/src/signIn.ts): one address, an IPv6 /64, or
--   every address in the x-forwarded-for chain, as their SHA-256 when they
--   run longer than the 64 characters this table keeps.
--
-- pin_guard_try: counts the try BEFORE the PIN is checked, in one
--   update ... returning, so tries sent at the same moment queue on the row
--   and no more than five in a row get past it; the fifth locks the ID for
--   15 minutes, and the count starts again from 0. Given an address, that
--   address's count goes up first, and after 200 in its window every try
--   from it is refused, whatever the ID, without the ID's row being touched.
--   Answers {verdict: 'busy'}, {verdict: 'locked'}, {verdict: 'unknown'}, or
--   {verdict: 'check', salt, verifier}.
-- pin_guard_passed: the PIN was right. The ID's count and lock are cleared,
--   the address gets this try back, and the answer says whether the account
--   is closed (0034's left_at): {closed: true | false}.
-- pin_guard_set: the row for an ID's new PIN, its count and lock cleared;
--   refused unless the ID is that user's account.
--
-- No API role is granted the tables; only these functions read and write
-- them, and only the service role may call the functions.
-- ---------------------------------------------------------------------------

create table if not exists lms.sign_in_guard (
  login_id text primary key check (login_id ~ '^[A-Z0-9-]{3,40}$'),
  user_id uuid not null references auth.users on delete cascade,
  salt text not null check (salt ~ '^[0-9a-f]{32}$'),
  verifier text not null check (verifier ~ '^[0-9a-f]{64}$'),
  failures int not null default 0 check (failures between 0 and 4),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists lms.sign_in_ip (
  ip text primary key check (char_length(ip) between 1 and 64),
  window_start timestamptz not null default now(),
  failures int not null default 0 check (failures >= 0)
);
create index if not exists sign_in_ip_window on lms.sign_in_ip (window_start);

revoke all on lms.sign_in_guard from public, anon, authenticated, service_role;
revoke all on lms.sign_in_ip from public, anon, authenticated, service_role;
alter table lms.sign_in_guard enable row level security;
alter table lms.sign_in_ip enable row level security;

create or replace function lms.pin_guard_try(p_login text, p_ip text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  v_login text := upper(btrim(coalesce(p_login, '')));
  v_ip text := left(nullif(btrim(coalesce(p_ip, '')), ''), 64);
  v_ip_tries int;
  v_salt text;
  v_verifier text;
begin
  if v_ip is not null then
    -- Each try with an address first forgets every address whose window is over.
    delete from lms.sign_in_ip where window_start <= now() - interval '15 minutes';
    insert into lms.sign_in_ip as s (ip, window_start, failures) values (v_ip, now(), 1)
    on conflict (ip) do update
      set failures = case when s.window_start <= now() - interval '15 minutes' then 1 else s.failures + 1 end,
          window_start = case when s.window_start <= now() - interval '15 minutes' then now() else s.window_start end
    returning s.failures into v_ip_tries;
    if v_ip_tries > 200 then
      return jsonb_build_object('verdict', 'busy');
    end if;
  end if;

  update lms.sign_in_guard g
     set failures = case when g.failures + 1 >= 5 then 0 else g.failures + 1 end,
         locked_until = case when g.failures + 1 >= 5 then now() + interval '15 minutes' end,
         updated_at = now()
   where g.login_id = v_login and (g.locked_until is null or g.locked_until <= now())
  returning g.salt, g.verifier into v_salt, v_verifier;
  if found then
    return jsonb_build_object('verdict', 'check', 'salt', v_salt, 'verifier', v_verifier);
  end if;
  if exists (select 1 from lms.sign_in_guard g where g.login_id = v_login) then
    return jsonb_build_object('verdict', 'locked');
  end if;
  return jsonb_build_object('verdict', 'unknown');
end;
$$;

create or replace function lms.pin_guard_passed(p_login text, p_ip text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  v_login text := upper(btrim(coalesce(p_login, '')));
  v_ip text := left(nullif(btrim(coalesce(p_ip, '')), ''), 64);
  v_user uuid;
begin
  update lms.sign_in_guard g set failures = 0, locked_until = null, updated_at = now()
   where g.login_id = v_login
  returning g.user_id into v_user;
  if v_ip is not null then
    update lms.sign_in_ip s set failures = greatest(s.failures - 1, 0) where s.ip = v_ip;
  end if;
  -- An ID whose row has gone has no account left to sign in to.
  return jsonb_build_object('closed',
    v_user is null or exists (select 1 from lms.account a where a.user_id = v_user and a.left_at is not null));
end;
$$;

create or replace function lms.pin_guard_set(p_user uuid, p_login text, p_salt text, p_verifier text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  v_login text := upper(btrim(coalesce(p_login, '')));
begin
  if not exists (select 1 from lms.account a where a.user_id = p_user and a.login_id = v_login) then
    raise exception 'there is no account % for that user', v_login;
  end if;
  insert into lms.sign_in_guard (login_id, user_id, salt, verifier)
  values (v_login, p_user, p_salt, p_verifier)
  on conflict (login_id) do update
    set user_id = excluded.user_id, salt = excluded.salt, verifier = excluded.verifier,
        failures = 0, locked_until = null, updated_at = now();
end;
$$;

revoke all on function lms.pin_guard_try(text, text) from public, anon, authenticated;
revoke all on function lms.pin_guard_passed(text, text) from public, anon, authenticated;
revoke all on function lms.pin_guard_set(uuid, text, text, text) from public, anon, authenticated;

grant execute on function lms.pin_guard_try(text, text) to service_role;
grant execute on function lms.pin_guard_passed(text, text) to service_role;
grant execute on function lms.pin_guard_set(uuid, text, text, text) to service_role;
