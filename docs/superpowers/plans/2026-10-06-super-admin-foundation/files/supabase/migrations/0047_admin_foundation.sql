-- THE PLATFORM'S OWN CONSOLE: WHO MAY USE IT, AND A LOG NOBODY CAN EDIT.
--
-- Everything the super admin panel does is a named SECURITY DEFINER function in
-- this schema. No table here is readable or writable by a browser; the panel
-- reaches them only through the functions, and every function begins with
-- admin.require_staff, which is the one definition of "a member of Qrie's
-- staff":
--
--   - a row in admin.platform_staff that is active, AND
--   - a JWT that is not anonymous (children hold the same `authenticated`
--     role staff do, so the role alone proves nothing), AND
--   - a JWT at assurance level aal2 (a second factor was verified).
--
-- The row is read on every call, so removing a person takes effect on their
-- very next click, whatever their token still says. All failures raise the
-- same message: the caller learns nothing about which check refused them.
--
-- THE AUDIT LOG is insert-only for everybody, the service role included:
-- privileges are revoked and a trigger raises on update, delete and truncate.
-- It holds ids, counts, hashes and the typed reason: never a child's words, so
-- it survives an erasure. A superuser can still disable the trigger; that is
-- why the log is also copied off the platform (a later task).
--
-- admin.tripwire() makes hand-written SQL leave a trace: control tables carry a
-- trigger that writes an 'unmanaged-change' row unless the change came through
-- an admin function (which sets admin.session for its own transaction).
--
-- STAFF ARE NOT CHILDREN. Every auth.users insert used to get a solo
-- organisation and a student membership unless app_metadata.provisioned_by was
-- 'school' (0021). A staff account created with provisioned_by = 'staff' gets
-- neither, so staff never appear in cost, adoption or mastery numbers.

create schema if not exists admin;
-- A schema outside `public` gets no default grants: the panel's signed-in
-- staff and the service role (bootstrap, alarm token) each need USAGE.
grant usage on schema admin to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Settings and the environment name
-- ---------------------------------------------------------------------------

create table if not exists admin.setting (
  key text primary key check (key ~ '^[a-z][a-z_]{1,40}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
revoke all on admin.setting from public, anon, authenticated;
alter table admin.setting enable row level security;

insert into admin.setting (key, value) values ('environment', '"UNSET"') on conflict (key) do nothing;

create or replace function admin.environment()
returns text
language sql stable security definer
set search_path = admin, public
as $$
  select coalesce((select value #>> '{}' from admin.setting where key = 'environment'), 'UNSET')
$$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

create table if not exists admin.platform_staff (
  user_id uuid primary key references auth.users on delete restrict,
  role text not null check (role in ('owner', 'ops', 'safety')),
  display_name text not null check (char_length(display_name) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  deactivated_at timestamptz
);
revoke all on admin.platform_staff from public, anon, authenticated;
alter table admin.platform_staff enable row level security;

-- ---------------------------------------------------------------------------
-- The audit log
-- ---------------------------------------------------------------------------

create table if not exists admin.audit_event (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  actor uuid,
  actor_role text not null,
  actor_name text not null,
  action text not null check (char_length(action) between 1 and 60),
  target_kind text not null default '' check (char_length(target_kind) <= 40),
  target_id text not null default '' check (char_length(target_id) <= 200),
  reason text not null default '' check (char_length(reason) <= 500),
  details jsonb not null default '{}'::jsonb,
  environment text not null
);
create index if not exists audit_event_time on admin.audit_event (at desc);
revoke all on admin.audit_event from public, anon, authenticated, service_role;
alter table admin.audit_event enable row level security;

create or replace function admin.audit_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'the audit log is insert-only' using errcode = '42501';
end;
$$;

drop trigger if exists audit_no_change on admin.audit_event;
create trigger audit_no_change
  before update or delete on admin.audit_event
  for each row execute function admin.audit_immutable();
drop trigger if exists audit_no_truncate on admin.audit_event;
create trigger audit_no_truncate
  before truncate on admin.audit_event
  for each statement execute function admin.audit_immutable();

create or replace function admin.audit(
  p_who admin.platform_staff, p_action text, p_kind text, p_id text, p_reason text, p_details jsonb default '{}'::jsonb
)
returns void
language sql volatile security definer
set search_path = admin, public
as $$
  insert into admin.audit_event (actor, actor_role, actor_name, action, target_kind, target_id, reason, details, environment)
  values (p_who.user_id, p_who.role, p_who.display_name, p_action, coalesce(p_kind, ''),
          left(coalesce(p_id, ''), 200), left(coalesce(p_reason, ''), 500),
          coalesce(p_details, '{}'::jsonb), admin.environment());
$$;

create or replace function admin.audit_service(
  p_action text, p_kind text, p_id text, p_reason text, p_details jsonb default '{}'::jsonb
)
returns void
language sql volatile security definer
set search_path = admin, public
as $$
  insert into admin.audit_event (actor, actor_role, actor_name, action, target_kind, target_id, reason, details, environment)
  values (null, 'service', 'service role', p_action, coalesce(p_kind, ''),
          left(coalesce(p_id, ''), 200), left(coalesce(p_reason, ''), 500),
          coalesce(p_details, '{}'::jsonb), admin.environment());
$$;

create or replace function admin.tripwire()
returns trigger
language plpgsql security definer
set search_path = admin, public
as $$
begin
  if coalesce(current_setting('admin.session', true), '') <> 'on' then
    insert into admin.audit_event (actor, actor_role, actor_name, action, target_kind, details, environment)
    values (auth.uid(), 'unmanaged', 'direct database change', 'unmanaged-change', tg_table_name,
            jsonb_build_object('op', tg_op), admin.environment());
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who is staff: the one check every admin function begins with
-- ---------------------------------------------------------------------------

create or replace function admin.require_staff(p_roles text[] default array['owner', 'ops', 'safety'])
returns admin.platform_staff
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff;
begin
  select s.* into me from admin.platform_staff s where s.user_id = auth.uid() and s.active;
  if me.user_id is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (me.role = 'owner' or me.role = any (coalesce(p_roles, '{}'::text[]))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return me;
end;
$$;

-- A guarded action wants the second factor verified a moment ago, not merely
-- at some point in the session. The JWT's amr list carries one entry per
-- method with the time it was verified.
create or replace function admin.require_fresh_mfa(p_minutes integer default 10)
returns void
language plpgsql stable security definer
set search_path = admin, public
as $$
begin
  if not exists (
    select 1
      from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
     where a ->> 'method' = 'totp'
       and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - greatest(p_minutes, 1) * 60
  ) then
    raise exception 'confirm with your authenticator code first' using errcode = '42501';
  end if;
end;
$$;

create or replace function admin.check_environment(p_env text)
returns void
language plpgsql stable security definer
set search_path = admin, public
as $$
begin
  if p_env is distinct from admin.environment() then
    raise exception 'this console is %, not %', admin.environment(), coalesce(p_env, '(nothing)');
  end if;
end;
$$;

create or replace function admin.me()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
begin
  return jsonb_build_object('userId', me.user_id, 'role', me.role,
                            'displayName', me.display_name, 'environment', admin.environment());
end;
$$;

create or replace function admin.staff_list()
returns table (user_id uuid, role text, display_name text, active boolean, created_at timestamptz, deactivated_at timestamptz)
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
begin
  return query
    select s.user_id, s.role, s.display_name, s.active, s.created_at, s.deactivated_at
      from admin.platform_staff s
     order by s.created_at;
end;
$$;

create or replace function admin.staff_set(p_user uuid, p_role text, p_name text, p_active boolean, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  anon boolean;
begin
  perform admin.require_fresh_mfa(10);
  if p_role not in ('owner', 'ops', 'safety') then
    raise exception 'a role is owner, ops or safety';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'give the person a name of up to 80 characters';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why, in a few words';
  end if;
  if p_user = me.user_id and (p_role <> 'owner' or not coalesce(p_active, true)) then
    raise exception 'you cannot demote or deactivate yourself';
  end if;
  select u.is_anonymous into anon from auth.users u where u.id = p_user;
  if not found then
    raise exception 'there is no such account';
  end if;
  if anon then
    raise exception 'an anonymous account cannot be staff';
  end if;
  insert into admin.platform_staff (user_id, role, display_name, active, created_by, deactivated_at)
  values (p_user, p_role, btrim(p_name), coalesce(p_active, true), me.user_id,
          case when coalesce(p_active, true) then null else now() end)
  on conflict (user_id) do update
    set role = excluded.role, display_name = excluded.display_name, active = excluded.active,
        deactivated_at = case when excluded.active then null else coalesce(admin.platform_staff.deactivated_at, now()) end;
  perform admin.audit(me, 'staff-set', 'staff', p_user::text, p_reason,
    jsonb_build_object('role', p_role, 'active', coalesce(p_active, true)));
end;
$$;

-- The first owner, made once from a laptop with the service role.
create or replace function admin.bootstrap_owner(p_user uuid, p_name text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
begin
  if exists (select 1 from admin.platform_staff where role = 'owner' and active) then
    raise exception 'there is already an owner';
  end if;
  if not exists (select 1 from auth.users where id = p_user and not is_anonymous) then
    raise exception 'there is no such permanent account';
  end if;
  insert into admin.platform_staff (user_id, role, display_name) values (p_user, 'owner', btrim(p_name))
  on conflict (user_id) do update set role = 'owner', active = true, deactivated_at = null, display_name = excluded.display_name;
  perform admin.audit_service('owner-bootstrapped', 'staff', p_user::text, 'first owner', '{}'::jsonb);
end;
$$;

create or replace function admin.set_environment(p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
begin
  if p_env is null or p_env not in ('HOSTED', 'STAGING', 'DEMO', 'TEST') then
    raise exception 'the environment is HOSTED, STAGING, DEMO or TEST';
  end if;
  insert into admin.setting (key, value) values ('environment', to_jsonb(p_env))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin.audit_service('environment-set', 'setting', 'environment', '', jsonb_build_object('environment', p_env));
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff are not children: no solo organisation for provisioned_by = 'staff'
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  when (coalesce(new.raw_app_meta_data ->> 'provisioned_by', '') not in ('school', 'staff'))
  execute function public.provision_solo_org();

-- ---------------------------------------------------------------------------
-- Grants. PostgreSQL gives EXECUTE to PUBLIC on a new function, so every
-- function says who may call it. Helpers are reached only by other definer
-- functions, which run as the owner and need no grant.
-- ---------------------------------------------------------------------------

revoke all on function admin.environment() from public, anon, authenticated;
revoke all on function admin.audit_immutable() from public, anon, authenticated;
revoke all on function admin.audit(admin.platform_staff, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function admin.audit_service(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function admin.tripwire() from public, anon, authenticated;
revoke all on function admin.require_staff(text[]) from public, anon, authenticated;
revoke all on function admin.require_fresh_mfa(integer) from public, anon, authenticated;
revoke all on function admin.check_environment(text) from public, anon, authenticated;
revoke all on function admin.me() from public, anon;
revoke all on function admin.staff_list() from public, anon;
revoke all on function admin.staff_set(uuid, text, text, boolean, text) from public, anon;
revoke all on function admin.bootstrap_owner(uuid, text) from public, anon, authenticated;
revoke all on function admin.set_environment(text) from public, anon, authenticated;

grant execute on function admin.me() to authenticated;
grant execute on function admin.staff_list() to authenticated;
grant execute on function admin.staff_set(uuid, text, text, boolean, text) to authenticated;
grant execute on function admin.bootstrap_owner(uuid, text) to service_role;
grant execute on function admin.set_environment(text) to service_role;
