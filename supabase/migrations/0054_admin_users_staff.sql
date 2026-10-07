-- USERS AND STAFF: THE SECOND DOOR, STAFF INVITATIONS, THE GATE THE admin-api
-- FUNCTION ASKS FIRST, AND THE AUDIT LOG'S VIEWER.
--
-- DIRECT USERS came on their own (the tutor's anonymous and permanent
-- sign-ins): an auth.users row that is not a school account (lms.account),
-- not staff (admin.platform_staff), and not made by a school or for staff
-- (app_metadata.provisioned_by). The console counts them, finds one by at
-- least 8 characters of its user ID, and shows a card with no name, phone or
-- address. The one action is a block: recorded here, then applied to the
-- sign-in service by admin-api with the service role.
--
-- STAFF: staff_set takes the environment and accepts only an account made for
-- staff (plan 1's deferred M2). An invitation adds an INACTIVE row; turning it
-- on needs a verified authenticator wherever the platform records factors
-- (auth.mfa_factors). Which roles exist is platform_staff's own check
-- constraint; these functions turn its refusal into a sentence.
--
-- THE GATE: admin-api calls admin.api_gate with the caller's own token before
-- it does anything with the service role, so who may act is decided here.

create table if not exists admin.user_block (
  user_id uuid primary key references auth.users on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid
);
revoke all on admin.user_block from public, anon, authenticated;
alter table admin.user_block enable row level security;
drop trigger if exists user_block_tripwire on admin.user_block;
create trigger user_block_tripwire
  after insert or update or delete on admin.user_block
  for each row execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- Direct users
-- ---------------------------------------------------------------------------

create or replace function admin.is_direct(p_user uuid)
returns boolean
language sql stable security definer
set search_path = admin, lms, public
as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_user
       and coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') not in ('school', 'staff')
       and not exists (select 1 from lms.account a where a.user_id = u.id)
       and not exists (select 1 from admin.platform_staff s where s.user_id = u.id)
  )
$$;

create or replace function admin.direct_user_json(p_user uuid)
returns jsonb
language sql stable security definer
set search_path = admin, lms, public
as $$
  select jsonb_build_object(
    'userId', u.id,
    'ref', left(u.id::text, 8),
    'createdOn', to_char((u.created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'anonymous', u.is_anonymous,
    'lastActiveOn', to_char((greatest(
        (select max(e.at) from public.usage_event e where e.user_id = u.id),
        (select max(ls.received_at) from public.learning_session ls where ls.user_id = u.id),
        (select max(le.received_at) from public.ledger_event le where le.user_id = u.id)
      ) at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'sessions', (select count(*)::int from public.learning_session ls where ls.user_id = u.id),
    'schoolCode', (select s.code from public.membership m join lms.school s on s.org_id = m.org_id
                    where m.user_id = u.id order by m.created_at limit 1),
    'contestEntry', exists (select 1 from public.contest_signup c where c.user_id = u.id),
    'consent', exists (select 1 from public.consent_record r where r.user_id = u.id),
    'blocked', exists (select 1 from admin.user_block b where b.user_id = u.id))
    from auth.users u
   where u.id = p_user
$$;

create or replace function admin.direct_users_summary()
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  answer jsonb;
begin
  with direct as (
    select u.id, u.is_anonymous, u.created_at
      from auth.users u
     where coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') not in ('school', 'staff')
       and not exists (select 1 from lms.account a where a.user_id = u.id)
       and not exists (select 1 from admin.platform_staff s where s.user_id = u.id)
  )
  select jsonb_build_object(
           'total', count(*),
           'anonymous', count(*) filter (where d.is_anonymous),
           'permanent', count(*) filter (where not d.is_anonymous),
           'createdLast7Days', count(*) filter (where d.created_at > now() - interval '7 days'),
           'activeLast7Days', count(*) filter (where
              exists (select 1 from public.usage_event e where e.user_id = d.id and e.at > now() - interval '7 days')
              or exists (select 1 from public.learning_session ls where ls.user_id = d.id and ls.received_at > now() - interval '7 days')),
           'withContestEntry', count(*) filter (where exists (select 1 from public.contest_signup c where c.user_id = d.id)),
           'withConsent', count(*) filter (where exists (select 1 from public.consent_record r where r.user_id = d.id)),
           'blocked', count(*) filter (where exists (select 1 from admin.user_block b where b.user_id = d.id)))
    into answer
    from direct d;
  return answer;
end;
$$;

create or replace function admin.direct_user_find(p_ref text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  ref text := lower(btrim(coalesce(p_ref, '')));
begin
  if ref !~ '^[0-9a-f-]{8,36}$' then
    raise exception 'type at least the first 8 characters of the user ID';
  end if;
  return coalesce((
    select jsonb_agg(admin.direct_user_json(f.id) order by f.created_at)
      from (select u.id, u.created_at from auth.users u
             where u.id::text like ref || '%' and admin.is_direct(u.id)
             order by u.created_at
             limit 5) f), '[]'::jsonb);
end;
$$;

create or replace function admin.direct_user(p_user uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
begin
  if not admin.is_direct(p_user) then
    raise exception 'this is not a direct user';
  end if;
  return admin.direct_user_json(p_user);
end;
$$;

create or replace function admin.direct_user_block(p_user uuid, p_blocked boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_blocked is null then
    raise exception 'say whether to block or unblock';
  end if;
  if exists (select 1 from lms.account a where a.user_id = p_user) then
    raise exception 'this account belongs to a school; disable it from the school''s page';
  end if;
  if exists (select 1 from admin.platform_staff s where s.user_id = p_user) then
    raise exception 'staff are changed on the staff page';
  end if;
  if not admin.is_direct(p_user) then
    raise exception 'this is not a direct user';
  end if;
  perform set_config('admin.session', 'on', true);
  if p_blocked then
    insert into admin.user_block (user_id, blocked_by) values (p_user, me.user_id) on conflict (user_id) do nothing;
    perform lms.end_sessions(p_user);
  else
    delete from admin.user_block b where b.user_id = p_user;
  end if;
  perform admin.audit(me, case when p_blocked then 'user-blocked' else 'user-unblocked' end,
    'user', p_user::text, p_reason, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

-- 'verified' or 'none' from Supabase Auth's factor table; 'not-captured'
-- where there is no such table (the test harness).
create or replace function admin.factor_state(p_user uuid)
returns text
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  ok boolean;
begin
  if to_regclass('auth.mfa_factors') is null then
    return 'not-captured';
  end if;
  execute 'select exists (select 1 from auth.mfa_factors f where f.user_id = $1
             and f.factor_type::text = ''totp'' and f.status::text = ''verified'')'
     into ok using p_user;
  return case when ok then 'verified' else 'none' end;
end;
$$;

drop function if exists admin.staff_set(uuid, text, text, boolean, text);

create or replace function admin.staff_set(p_user uuid, p_role text, p_name text, p_active boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  anon boolean;
  made_by text;
  was_active boolean;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'give the person a name of up to 80 characters';
  end if;
  perform admin.require_reason(p_reason);
  if p_user = me.user_id and (p_role is distinct from 'owner' or not coalesce(p_active, true)) then
    raise exception 'you cannot demote or deactivate yourself';
  end if;
  select u.is_anonymous, coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') into anon, made_by
    from auth.users u where u.id = p_user;
  if not found then
    raise exception 'there is no such account';
  end if;
  if anon then
    raise exception 'an anonymous account cannot be staff';
  end if;
  if made_by <> 'staff' then
    raise exception 'only an account made for staff can be staff';
  end if;
  select s.active into was_active from admin.platform_staff s where s.user_id = p_user;
  if coalesce(p_active, true) and not coalesce(was_active, false) and admin.factor_state(p_user) = 'none' then
    raise exception 'this person has not set up an authenticator yet';
  end if;
  perform set_config('admin.session', 'on', true);
  begin
    insert into admin.platform_staff (user_id, role, display_name, active, created_by, deactivated_at)
    values (p_user, p_role, btrim(p_name), coalesce(p_active, true), me.user_id,
            case when coalesce(p_active, true) then null else now() end)
    on conflict (user_id) do update
      set role = excluded.role, display_name = excluded.display_name, active = excluded.active,
          deactivated_at = case when excluded.active then null
                                else coalesce(admin.platform_staff.deactivated_at, now()) end;
  exception when check_violation or not_null_violation then
    raise exception 'there is no staff role called %', coalesce(p_role, '(none)');
  end;
  perform admin.audit(me, 'staff-set', 'staff', p_user::text, p_reason,
    jsonb_build_object('role', p_role, 'active', coalesce(p_active, true)));
end;
$$;

create or replace function admin.staff_invite(p_user uuid, p_role text, p_name text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  anon boolean;
  made_by text;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'give the person a name of up to 80 characters';
  end if;
  perform admin.require_reason(p_reason);
  select u.is_anonymous, coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') into anon, made_by
    from auth.users u where u.id = p_user;
  if not found then
    raise exception 'there is no such account';
  end if;
  if anon then
    raise exception 'an anonymous account cannot be staff';
  end if;
  if made_by <> 'staff' then
    raise exception 'only an account made for staff can be staff';
  end if;
  if exists (select 1 from admin.platform_staff s where s.user_id = p_user) then
    raise exception 'this person is already on the staff list';
  end if;
  perform set_config('admin.session', 'on', true);
  begin
    insert into admin.platform_staff (user_id, role, display_name, active, created_by)
    values (p_user, p_role, btrim(p_name), false, me.user_id);
  exception when check_violation or not_null_violation then
    raise exception 'there is no staff role called %', coalesce(p_role, '(none)');
  end;
  perform admin.audit(me, 'staff-invited', 'staff', p_user::text, p_reason, jsonb_build_object('role', p_role));
end;
$$;

create or replace function admin.staff_roster()
returns table (user_id uuid, email text, role text, display_name text, status text, factor text,
               created_at timestamptz, deactivated_at timestamptz)
language plpgsql stable security definer
set search_path = admin, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
begin
  return query
    select s.user_id, u.email::text, s.role, s.display_name,
           case when s.active then 'active' when s.deactivated_at is null then 'invited' else 'off' end,
           admin.factor_state(s.user_id), s.created_at, s.deactivated_at
      from admin.platform_staff s
      join auth.users u on u.id = s.user_id
    union all
    select u.id, u.email::text, null::text, null::text, 'account-only', admin.factor_state(u.id), u.created_at, null::timestamptz
      from auth.users u
     where u.raw_app_meta_data ->> 'provisioned_by' = 'staff'
       and not exists (select 1 from admin.platform_staff s2 where s2.user_id = u.id)
    order by 7;
end;
$$;

-- ---------------------------------------------------------------------------
-- The gate admin-api asks, as the caller, before it acts with the service role
-- ---------------------------------------------------------------------------

create or replace function admin.api_gate(p_action text, p_code text, p_target text, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff;
  org uuid;
  sc text;
begin
  if p_action in ('people-preview', 'people-import', 'pin-reset') then
    me := admin.require_staff(array['ops']);
  elsif p_action = 'staff-invite' then
    me := admin.require_staff(array[]::text[]);
  else
    -- The staff check first, so a stranger learns nothing about the actions.
    me := admin.require_staff();
    raise exception 'there is no such action';
  end if;
  if p_action in ('pin-reset', 'staff-invite') then
    perform admin.require_fresh_mfa(10);
  end if;
  if p_action <> 'people-preview' then
    perform admin.check_environment(p_env);
    perform admin.require_reason(p_reason);
  end if;
  if p_action <> 'staff-invite' then
    org := admin.school_org(p_code);
    select s.code into sc from lms.school s where s.org_id = org;
    if p_action = 'people-import'
       and exists (select 1 from admin.school_profile p where p.org_id = org and p.offboarded_at is not null) then
      raise exception 'this school is offboarded; bring it back before adding people';
    end if;
  end if;
  if p_action = 'people-import' then
    perform admin.audit(me, 'people-import-requested', 'school', sc, p_reason, '{}'::jsonb);
  elsif p_action = 'pin-reset' then
    perform admin.audit(me, 'pin-reset-requested', 'school', sc, p_reason,
      jsonb_build_object('loginId', upper(btrim(coalesce(p_target, '')))));
  elsif p_action = 'staff-invite' then
    perform admin.audit(me, 'staff-invite-requested', 'staff', '', p_reason,
      jsonb_build_object('emailSha256', encode(sha256(convert_to(lower(btrim(coalesce(p_target, ''))), 'utf8')), 'hex')));
  end if;
  return jsonb_build_object('actor', me.user_id, 'orgId', org);
end;
$$;

-- ---------------------------------------------------------------------------
-- The audit log's viewer
-- ---------------------------------------------------------------------------

create or replace function admin.audit_list(
  p_actor uuid default null, p_action text default null, p_from date default null, p_to date default null,
  p_before bigint default null, p_limit integer default 100
)
returns table (id bigint, at timestamptz, actor uuid, actor_name text, actor_role text, action text,
               target_kind text, target_id text, reason text, details jsonb, environment text)
language plpgsql stable security definer
set search_path = admin, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
begin
  return query
    select e.id, e.at, e.actor, e.actor_name, e.actor_role, e.action, e.target_kind, e.target_id, e.reason, e.details, e.environment
      from admin.audit_event e
     where (p_actor is null or e.actor = p_actor)
       and (p_action is null or btrim(p_action) = '' or e.action like admin.like_escape(lower(btrim(p_action))) || '%')
       and (p_from is null or e.at >= (p_from::timestamp at time zone 'Asia/Kolkata'))
       and (p_to is null or e.at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
       and (p_before is null or e.id < p_before)
     order by e.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function admin.is_direct(uuid) from public, anon, authenticated;
revoke all on function admin.direct_user_json(uuid) from public, anon, authenticated;
revoke all on function admin.factor_state(uuid) from public, anon, authenticated;
revoke all on function admin.direct_users_summary() from public, anon;
revoke all on function admin.direct_user_find(text) from public, anon;
revoke all on function admin.direct_user(uuid) from public, anon;
revoke all on function admin.direct_user_block(uuid, boolean, text, text) from public, anon;
revoke all on function admin.staff_set(uuid, text, text, boolean, text, text) from public, anon;
revoke all on function admin.staff_invite(uuid, text, text, text, text) from public, anon;
revoke all on function admin.staff_roster() from public, anon;
revoke all on function admin.api_gate(text, text, text, text, text) from public, anon;
revoke all on function admin.audit_list(uuid, text, date, date, bigint, integer) from public, anon;

grant execute on function admin.direct_users_summary() to authenticated;
grant execute on function admin.direct_user_find(text) to authenticated;
grant execute on function admin.direct_user(uuid) to authenticated;
grant execute on function admin.direct_user_block(uuid, boolean, text, text) to authenticated;
grant execute on function admin.staff_set(uuid, text, text, boolean, text, text) to authenticated;
grant execute on function admin.staff_invite(uuid, text, text, text, text) to authenticated;
grant execute on function admin.staff_roster() to authenticated;
grant execute on function admin.api_gate(text, text, text, text, text) to authenticated;
grant execute on function admin.audit_list(uuid, text, date, date, bigint, integer) to authenticated;
