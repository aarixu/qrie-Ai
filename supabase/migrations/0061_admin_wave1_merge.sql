-- WAVE 1 TOGETHER: PLAN 2 (SCHOOLS, USERS, HEALTH) AND PLAN 3 (BILLING).
--
-- THE STOP IS OPEN TO FINANCE. Spec section 3: "A stop is open to every active
-- staff member on purpose: stopping money or harm must never wait for a second
-- person". 0056 added the finance role, and plan 3's ruling R11 left it out of
-- admin.set_halt's stop branch, which 0048 wrote as require_staff()'s default
-- list (owner, ops, safety). The owner of this build ruled the other way: the
-- stop branch (p_halted true) names every staff role, finance included. Resume
-- (p_halted false) is unchanged: the owner only, with a code verified in the
-- last ten minutes. The rest of the body is 0048's, line for line.
--
-- What this does not change: finance still cannot read Today, the switches or
-- the relay's status (admin.today, admin.flag_list, admin.relay_status keep
-- their lists), and the console shows its stop button only on Today and System,
-- neither of which finance may open. So after this migration a finance member
-- can stop the tutor through the database function, and has no button for it
-- in the console yet.

create or replace function admin.set_halt(p_halted boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff;
  students integer;
begin
  if p_halted is null then
    raise exception 'say whether to stop or resume';
  end if;
  if p_halted then
    me := admin.require_staff(array['owner', 'ops', 'safety', 'finance']);
  else
    me := admin.require_staff(array[]::text[]);
    perform admin.require_fresh_mfa(10);
  end if;
  perform admin.check_environment(p_env);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why, in a few words';
  end if;
  select count(distinct e.user_id)::int into students from public.usage_event e where e.at > now() - interval '10 minutes';
  perform set_config('admin.session', 'on', true);
  update public.relay_control
     set halted = p_halted,
         halted_reason = case when p_halted then btrim(p_reason) else null end,
         halted_at = case when p_halted then now() else null end,
         halted_by = case when p_halted then me.display_name else null end,
         updated_at = now()
   where id;
  perform admin.audit(me, case when p_halted then 'tutor-stopped' else 'tutor-resumed' end,
    'relay', 'relay_control', p_reason, jsonb_build_object('studentsNow', students));
end;
$$;

revoke all on function admin.set_halt(boolean, text, text) from public, anon;
grant execute on function admin.set_halt(boolean, text, text) to authenticated;
