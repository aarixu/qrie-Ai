-- THE HOSTED SIGN-IN'S GUARD: a per-ID lockout and a per-address limit in
-- front of Supabase Auth, kept for the lms-signin edge function
-- (tools/lms-import/src/signIn.ts); the import and the admin calls
-- (tools/lms-import/src/admin.ts) write a new PIN's row through it.
--
-- Numbered 0076 rather than added to 0046: 0046 is already applied to the
-- LMS's Supabase project, where 0047-0075 are the admin console's (branch
-- admin). It needs only what 0021-0046 make (lms.account, 0034's left_at).
--
-- Written against tools/lms-import/tests/signIn.test.ts and
-- tools/lms-import/tests/admin.test.ts, first.

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
