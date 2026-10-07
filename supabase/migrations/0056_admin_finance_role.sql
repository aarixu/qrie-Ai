-- THE FINANCE ROLE (spec section 3): reads billing, records an offline payment,
-- prints invoices. Nothing about children, switches or classes: every plan-1
-- function keeps its own role list, so finance reaches only me() there.

alter table admin.platform_staff drop constraint if exists platform_staff_role_check;
alter table admin.platform_staff add constraint platform_staff_role_check
  check (role in ('owner', 'ops', 'safety', 'finance'));

-- 0047's staff_set names the roles in a literal; where that literal is in the
-- body, it is widened in place. Plan 2's 0054 replaces staff_set (six
-- arguments, with p_env) by a body that takes the roles from the check
-- constraint above and names no role list, so there is nothing to widen and
-- the constraint is all it needs. A body that names 'safety' in any other way
-- stops the migration, so a role list this block does not recognise is
-- noticed instead of silently left without finance.
do $$
declare
  f record;
  body text;
  seen integer := 0;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'admin' and p.proname = 'staff_set' loop
    seen := seen + 1;
    body := pg_get_functiondef(f.oid);
    if position('(''owner'', ''ops'', ''safety'')' in body) > 0 then
      body := replace(body, '(''owner'', ''ops'', ''safety'')', '(''owner'', ''ops'', ''safety'', ''finance'')');
      body := replace(body, 'a role is owner, ops or safety', 'a role is owner, ops, safety or finance');
      execute body;
    elsif position('''safety''' in body) > 0 then
      raise exception 'admin.staff_set names its roles in a way 0056 does not recognise: add finance to it by hand';
    end if;
  end loop;
  if seen = 0 then
    raise exception 'admin.staff_set does not exist';
  end if;
end
$$;

-- me() is how the console learns who is signed in; finance must reach it.
create or replace function admin.me()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['owner', 'ops', 'safety', 'finance']);
begin
  return jsonb_build_object('userId', me.user_id, 'role', me.role,
                            'displayName', me.display_name, 'environment', admin.environment());
end;
$$;
revoke all on function admin.me() from public, anon;
grant execute on function admin.me() to authenticated;
