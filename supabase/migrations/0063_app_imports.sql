-- NO NEW PEOPLE FOR A SCHOOL THAT MAY NOT TAKE THEM (plan 4).
--
-- Spec section 10: when a school is suspended, "new imports stop"; plan 3's
-- merge note 10 left that to this plan. Plan 2's admin.api_gate already
-- refused staff an import for an offboarded school, but the school admin's own
-- import (supabase/functions/lms-admin, tools/lms-import) asked nothing.
--
-- One internal answer, admin.import_refusal(org): NULL when the school may
-- import people, otherwise one English sentence the person is shown. It is
-- asked by admin.api_gate('people-import') for staff, and by the LMS lane's
-- import code through the service-role door lms.import_refusal, before any
-- sheet is read.
--
-- Seam T2 (wave 2): the last question is admin.privacy_import_refusal, a stub
-- here that refuses nothing. Plan 5 replaces it (same signature, internal) so
-- that a school whose data-protection decision is undecided cannot import.

-- Plan 5 replaces this (same signature, internal): it refuses while the
-- school's data-protection decision is undecided. Until then it refuses nothing.
create or replace function admin.privacy_import_refusal(p_org uuid)
returns text
language sql stable security definer
set search_path = admin, public
as $$
  select null::text
$$;

create or replace function admin.import_refusal(p_org uuid)
returns text
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  st text;
begin
  if exists (select 1 from admin.school_profile p where p.org_id = p_org and p.offboarded_at is not null) then
    return 'This school is offboarded from Qrie, so no new people can be added.';
  end if;
  select f.state into st from billing.state_for(p_org, lms.india_today()) f;
  if st in ('suspended', 'ended') then
    return 'This school''s licence has ended and its grace period is over, so no new people can be added until it is renewed.';
  end if;
  return admin.privacy_import_refusal(p_org);
end;
$$;

-- The LMS lane's service-role door to the same answer (lms-admin and the demo
-- server call lms.* functions only).
create or replace function lms.import_refusal(p_org uuid)
returns text
language sql stable security definer
set search_path = public, lms
as $$
  select admin.import_refusal(p_org)
$$;

revoke all on function admin.privacy_import_refusal(uuid) from public, anon, authenticated, service_role;
revoke all on function admin.import_refusal(uuid) from public, anon, authenticated, service_role;
revoke all on function lms.import_refusal(uuid) from public, anon, authenticated;
grant execute on function lms.import_refusal(uuid) to service_role;

-- 0054's admin.api_gate, line for line, with one block replaced: the
-- offboarded check for 'people-import' becomes admin.import_refusal, so staff
-- are refused an offboarded, suspended or ended school (and, with plan 5, a
-- school whose privacy decision is undecided) with the sentence that says why.
create or replace function admin.api_gate(p_action text, p_code text, p_target text, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff;
  org uuid;
  sc text;
  refusal text;
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
  -- A committed import makes sign-ins and answers with their PINs, as a new PIN
  -- does: both hand out a credential, so both want a code from the last 10
  -- minutes (R3; spec section 6's stolen session).
  if p_action in ('people-import', 'pin-reset', 'staff-invite') then
    perform admin.require_fresh_mfa(10);
  end if;
  if p_action <> 'people-preview' then
    perform admin.check_environment(p_env);
    perform admin.require_reason(p_reason);
  end if;
  if p_action <> 'staff-invite' then
    org := admin.school_org(p_code);
    select s.code into sc from lms.school s where s.org_id = org;
    if p_action = 'people-import' then
      refusal := admin.import_refusal(org);
      if refusal is not null then
        raise exception '%', refusal;
      end if;
    end if;
    -- A teacher's or a school admin's sign-in opens other people's children's
    -- work, which ops may not see (spec section 3), so here only the owner
    -- hands one out (R22). For an import, admin-api passes p_target
    -- 'teachers' whenever the request carries a teachers sheet, the only sheet
    -- that makes teachers and school admins; for a new PIN, p_target is the
    -- login ID.
    if (p_action = 'people-import' and p_target = 'teachers')
       or (p_action = 'pin-reset' and exists (
             select 1 from lms.account a
              where a.org_id = org and a.login_id = upper(btrim(coalesce(p_target, '')))
                and a.kind in ('teacher', 'admin'))) then
      perform admin.require_staff(array[]::text[]);
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

revoke all on function admin.api_gate(text, text, text, text, text) from public, anon;
grant execute on function admin.api_gate(text, text, text, text, text) to authenticated;
