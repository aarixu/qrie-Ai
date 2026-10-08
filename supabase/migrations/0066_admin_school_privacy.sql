-- WHO IS RESPONSIBLE FOR A SCHOOL'S CHILDREN'S DATA, AND WHO IS TOLD (spec section 2).
-- Counsel decides both; the owner records what counsel decided, per school.
-- While either is undecided, nobody can be added to the school (T2), on the
-- databases that hold real children (HOSTED and STAGING: ruling R13).

create table if not exists admin.school_privacy (
  org_id uuid primary key references lms.school on delete cascade,
  fiduciary text not null default 'undecided' check (fiduciary in ('undecided', 'school', 'qrie')),
  recipient text not null default 'undecided' check (recipient in ('undecided', 'school', 'parent', 'school-and-parent')),
  basis text check (basis is null or char_length(basis) between 3 and 200),
  decided_by uuid,
  decided_at timestamptz
);
revoke all on admin.school_privacy from public, anon, authenticated, service_role;
alter table admin.school_privacy enable row level security;
drop trigger if exists school_privacy_tripwire on admin.school_privacy;
create trigger school_privacy_tripwire after insert or update or delete on admin.school_privacy
  for each row execute function admin.tripwire();

-- T2: internal. NULL when the school may import people; else the sentence the
-- person importing is shown. Plan 4's admin.import_refusal calls this.
create or replace function admin.privacy_import_refusal(p_org uuid)
returns text
language sql stable security definer
set search_path = admin, public
as $$
  select case
    when admin.environment() not in ('HOSTED', 'STAGING') then null
    when exists (select 1 from admin.school_privacy p
                  where p.org_id = p_org and p.fiduciary <> 'undecided' and p.recipient <> 'undecided') then null
    else 'Qrie has not yet recorded who is responsible for this school''s children''s data and who is told if a child may be at risk. '
         || 'The owner records both on the Privacy page; until then nobody can be added to this school.'
  end
$$;
revoke all on function admin.privacy_import_refusal(uuid) from public, anon, authenticated, service_role;

-- Every school and its decision, for owner, ops and safety. A school with no
-- row reads 'undecided'.
create or replace function admin.school_privacy_list()
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'safety']);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'code', s.code,
             'name', s.display_name,
             'fiduciary', coalesce(p.fiduciary, 'undecided'),
             'recipient', coalesce(p.recipient, 'undecided'),
             'basis', p.basis,
             'decidedAt', p.decided_at,
             'decidedByName', st.display_name,
             'importBlocked', admin.privacy_import_refusal(s.org_id) is not null)
           order by s.code)
      from lms.school s
      left join admin.school_privacy p on p.org_id = s.org_id
      left join admin.platform_staff st on st.user_id = p.decided_by), '[]'::jsonb);
end;
$$;

-- The owner records counsel's decision for one school, with a fresh code. The
-- audit row keeps the before and after, not the basis text.
create or replace function admin.school_privacy_set(
  p_code text, p_fiduciary text, p_recipient text, p_basis text, p_reason text, p_env text
)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  org uuid;
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  prior admin.school_privacy;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  if p_fiduciary is null or p_fiduciary not in ('undecided', 'school', 'qrie') then
    raise exception 'the data fiduciary is school, qrie or undecided';
  end if;
  if p_recipient is null or p_recipient not in ('undecided', 'school', 'parent', 'school-and-parent') then
    raise exception 'who is told is school, parent, school-and-parent or undecided';
  end if;
  if ((p_fiduciary <> 'undecided' or p_recipient <> 'undecided') and v_basis is null)
     or (v_basis is not null and char_length(v_basis) not between 3 and 200) then
    raise exception 'say what the decision rests on, in a few words (for example: counsel''s letter of 2026-11-02)';
  end if;
  select * into prior from admin.school_privacy p where p.org_id = org;
  perform set_config('admin.session', 'on', true);
  insert into admin.school_privacy (org_id, fiduciary, recipient, basis, decided_by, decided_at)
  values (org, p_fiduciary, p_recipient, v_basis, me.user_id, now())
  on conflict (org_id) do update
    set fiduciary = excluded.fiduciary, recipient = excluded.recipient, basis = excluded.basis,
        decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  perform admin.audit(me, 'school-privacy-set', 'school', upper(btrim(p_code)), p_reason,
    jsonb_build_object(
      'from', jsonb_build_object('fiduciary', coalesce(prior.fiduciary, 'undecided'),
                                 'recipient', coalesce(prior.recipient, 'undecided')),
      'to', jsonb_build_object('fiduciary', p_fiduciary, 'recipient', p_recipient)));
end;
$$;

revoke all on function admin.school_privacy_list() from public, anon;
revoke all on function admin.school_privacy_set(text, text, text, text, text, text) from public, anon;
grant execute on function admin.school_privacy_list() to authenticated;
grant execute on function admin.school_privacy_set(text, text, text, text, text, text) to authenticated;
