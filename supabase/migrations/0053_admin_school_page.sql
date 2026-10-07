-- ONE SCHOOL'S PAGE, AND WHAT QRIE STAFF MAY DO TO A SCHOOL.
--
-- Reading: the school's detail and health (any staff member), people search
-- and one person's card, the merged activity timeline, weekly counts, and the
-- school's contacts and call notes. People are found by a search of at least
-- two characters, twenty at most; a parent's name is masked in results and
-- shown only on that parent's own card.
--
-- Doing: create a school, set its licence (owner, fresh code; lms.set_licence
-- does the writing), a holiday, offboarding (never a delete: a mark, the
-- school's tutor.enabled switch set to false, and nothing removed; the
-- console's import refuses the school, but no app reads tutor.enabled yet
-- (plan 4) and the school admin's own import is unchanged), an export of its
-- register, contacts and notes, and disabling one person exactly as the
-- school admin's lms.mark_left does (0034), so the school admin's
-- lms.restore_account brings them back. admin.flag_set is replaced here so
-- that only the owner sets tutor.enabled to true (spec section 3).
--
-- Every write checks the environment, takes a reason, and writes one audit
-- row with ids only. Actions on a school's own data also land in the school's
-- activity log, where lms.audit_log now names a staff actor "Qrie staff".

create table if not exists admin.school_contact (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  role text not null check (char_length(role) between 1 and 60),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or char_length(email) <= 120),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);
revoke all on admin.school_contact from public, anon, authenticated;
alter table admin.school_contact enable row level security;

create table if not exists admin.school_note (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  kind text not null check (kind in ('call', 'note')),
  body text not null check (char_length(body) between 1 and 2000),
  author uuid,
  author_name text not null,
  at timestamptz not null default now()
);
create index if not exists school_note_time on admin.school_note (org_id, at desc);
revoke all on admin.school_note from public, anon, authenticated;
alter table admin.school_note enable row level security;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create or replace function admin.school_detail(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
  org uuid;
  sch lms.school;
  yr lms.academic_year;
  lic lms.licence;
  prof admin.school_profile;
  counts jsonb;
begin
  org := admin.school_org(p_code);
  select s.* into sch from lms.school s where s.org_id = org;
  select y.* into yr from lms.academic_year y where y.id = lms.current_year(org);
  select l.* into lic from lms.licence l where l.org_id = org;
  select p.* into prof from admin.school_profile p where p.org_id = org;
  select jsonb_build_object(
           'students', count(*) filter (where t.kind = 'student' and t.here),
           'teachers', count(*) filter (where t.kind = 'teacher' and t.here),
           'admins', count(*) filter (where t.kind = 'admin' and t.here),
           'parents', count(*) filter (where t.kind = 'parent' and t.here),
           'left', count(*) filter (where not t.here),
           'studentsEverUsed', count(*) filter (where t.kind = 'student' and t.here and t.used),
           'teachersEverUsed', count(*) filter (where t.kind = 'teacher' and t.here and t.used))
    into counts
    from (
      select a.kind, a.left_at is null as here,
             case a.kind
               when 'student' then
                 exists (select 1 from lms.submission s where s.org_id = org and s.student_user_id = a.user_id)
                 or exists (select 1 from public.ledger_event e where e.org_id = org and e.user_id = a.user_id)
               when 'teacher' then
                 exists (select 1 from lms.assignment w where w.org_id = org and w.created_by = a.user_id and w.published_at is not null)
                 or exists (select 1 from lms.attendance m where m.org_id = org and m.marked_by = a.user_id)
               else false
             end as used
        from lms.account a
       where a.org_id = org
    ) t;
  return jsonb_build_object(
    'orgId', org,
    'code', sch.code,
    'name', sch.display_name,
    'shortName', sch.short_name,
    'board', sch.board,
    'createdOn', to_char((sch.created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'year', case when yr.id is null then null else jsonb_build_object(
              'label', yr.label, 'startsOn', to_char(yr.starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(yr.ends_on, 'YYYY-MM-DD')) end,
    'licence', case when lic.org_id is null then null else jsonb_build_object(
              'plan', lic.plan, 'seats', lic.seats, 'seatsUsed', lms.seats_used(org),
              'validUntil', to_char(lic.valid_until, 'YYYY-MM-DD'), 'daysLeft', lic.valid_until - lms.india_today()) end,
    'counts', counts,
    'quietUntil', to_char(prof.quiet_until, 'YYYY-MM-DD'),
    'offboardedAt', prof.offboarded_at,
    'health', admin.school_health_for(org)
  );
end;
$$;

create or replace function admin.school_weekly(p_code text, p_weeks integer default 8)
returns table (week_start date, published integer, handed_in integer, attendance_marked integer)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff();
  org uuid;
  n integer := least(greatest(coalesce(p_weeks, 8), 1), 26);
  this_week date := date_trunc('week', lms.india_today()::timestamp)::date;
begin
  org := admin.school_org(p_code);
  return query
    select w.d,
           (select count(*)::int from lms.assignment a
             where a.org_id = org and a.published_at is not null
               and (a.published_at at time zone 'Asia/Kolkata')::date between w.d and w.d + 6),
           (select count(*)::int from lms.submission s
             where s.org_id = org and (s.submitted_at at time zone 'Asia/Kolkata')::date between w.d and w.d + 6),
           (select count(*)::int from (
              select distinct m.section_id, m.on_date from lms.attendance m
               where m.org_id = org and m.on_date between w.d and w.d + 6) x)
      from (select (this_week - 7 * g)::date as d from generate_series(0, n - 1) g) w
     order by w.d;
end;
$$;

create or replace function admin.school_people(p_code text, p_query text, p_limit integer default 20)
returns table (login_id text, kind text, display_name text, class_name text, left_school boolean)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  q text := btrim(coalesce(p_query, ''));
begin
  org := admin.school_org(p_code);
  if char_length(q) < 2 then
    raise exception 'type at least 2 letters of a name or an ID';
  end if;
  return query
    select a.login_id, a.kind,
           case when a.kind = 'parent' then left(a.display_name, 1) || '…' else a.display_name end,
           en.class_name, a.left_at is not null
      from lms.account a
      left join lateral (
        select sec.grade || sec.name as class_name
          from lms.enrolment e join lms.section sec on sec.id = e.section_id
         where e.student_user_id = a.user_id and e.academic_year_id = lms.current_year(org) and e.left_on is null
         limit 1
      ) en on true
     where a.org_id = org
       and (a.login_id like admin.like_escape(upper(q)) || '%'
            or a.display_name ilike '%' || admin.like_escape(q) || '%')
     order by a.left_at is not null, a.kind, a.display_name
     limit least(greatest(coalesce(p_limit, 20), 1), 20);
end;
$$;

create or replace function admin.school_person(p_code text, p_login text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  who lms.account;
  cls text;
  roll text;
  last_at timestamptz;
begin
  org := admin.school_org(p_code);
  select a.* into who from lms.account a where a.org_id = org and a.login_id = upper(btrim(coalesce(p_login, '')));
  if who.user_id is null then
    raise exception 'there is no one at this school with the ID %', upper(btrim(coalesce(p_login, '(none)')));
  end if;
  select sec.grade || sec.name, e.roll_number into cls, roll
    from lms.enrolment e join lms.section sec on sec.id = e.section_id
   where e.student_user_id = who.user_id and e.academic_year_id = lms.current_year(org) and e.left_on is null
   limit 1;
  last_at := case
    when who.kind = 'student' then greatest(
      (select max(s.submitted_at) from lms.submission s where s.org_id = org and s.student_user_id = who.user_id),
      (select max(e.received_at) from public.ledger_event e where e.org_id = org and e.user_id = who.user_id))
    when who.kind in ('teacher', 'admin') then greatest(
      (select max(w.published_at) from lms.assignment w where w.org_id = org and w.created_by = who.user_id),
      (select max(m.marked_at) from lms.attendance m where m.org_id = org and m.marked_by = who.user_id))
  end;
  return jsonb_build_object(
    'loginId', who.login_id,
    'kind', who.kind,
    'displayName', who.display_name,
    'className', cls,
    'roll', roll,
    'createdOn', to_char((who.created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'leftOn', to_char((who.left_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'lastActiveOn', to_char((last_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'teaches', case when who.kind = 'teacher' then (
      select count(*)::int from lms.teaching_assignment ta join lms.section sec on sec.id = ta.section_id
       where ta.teacher_user_id = who.user_id and sec.academic_year_id = lms.current_year(org)) end,
    'children', case when who.kind = 'parent' then (
      select count(*)::int from lms.guardian g where g.parent_user_id = who.user_id) end,
    'parents', case when who.kind = 'student' then (
      select count(*)::int from lms.guardian g where g.student_user_id = who.user_id) end
  );
end;
$$;

create or replace function admin.school_activity(p_code text, p_before timestamptz default null, p_limit integer default 50)
returns table (at timestamptz, source text, actor text, action text, target text, reason text)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  n integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  return query
    select t.at, t.source, t.actor, t.action, t.target, t.reason
      from (
        select e.at, 'school'::text as source,
               coalesce(case when ps.user_id is not null then 'Qrie staff: ' || ps.display_name end,
                        case a.kind when 'student' then 'A student' when 'parent' then 'A parent' else a.display_name end,
                        'The system') as actor,
               e.action, e.target, ''::text as reason
          from lms.audit_event e
          left join lms.account a on a.user_id = e.actor
          left join admin.platform_staff ps on ps.user_id = e.actor
         where e.org_id = org and (p_before is null or e.at < p_before)
        union all
        select e.at, 'qrie'::text,
               -- A service row (plan 1's audit_service; plan 3's "Cashfree") has no actor.
               case when e.actor is null then e.actor_name else 'Qrie staff: ' || e.actor_name end,
               e.action, e.target_id, e.reason
          from admin.audit_event e
         where ((e.target_kind = 'school' and e.target_id = sc)
                or (e.target_kind = 'flag' and e.target_id like '% @ ' || sc))
           and (p_before is null or e.at < p_before)
      ) t
     order by t.at desc
     limit n;
end;
$$;

create or replace function admin.school_notes(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  prof admin.school_profile;
begin
  org := admin.school_org(p_code);
  select p.* into prof from admin.school_profile p where p.org_id = org;
  return jsonb_build_object(
    'quietUntil', to_char(prof.quiet_until, 'YYYY-MM-DD'),
    'offboardedAt', prof.offboarded_at,
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', c.role, 'phone', c.phone, 'email', c.email)
                       order by c.name)
        from admin.school_contact c where c.org_id = org), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.at, 'kind', x.kind, 'authorName', x.author_name, 'body', x.body)
                       order by x.at desc)
        from (select n.* from admin.school_note n where n.org_id = org order by n.at desc limit 100) x), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Doing
-- ---------------------------------------------------------------------------

create or replace function admin.school_create(
  p_code text, p_name text, p_board text, p_year_label text, p_starts_on date, p_ends_on date, p_reason text, p_env text
)
returns uuid
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  sc text := upper(btrim(coalesce(p_code, '')));
  org uuid;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if sc !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'a school code is 3 to 12 capital letters or digits';
  end if;
  if exists (select 1 from lms.school s where s.code = sc) then
    raise exception 'there is already a school with the code %', sc;
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'give the school a name of up to 120 characters';
  end if;
  if p_board is null or p_board not in ('CBSE', 'ICSE', 'STATE', 'OTHER') then
    raise exception 'a board is CBSE, ICSE, STATE or OTHER';
  end if;
  if char_length(btrim(coalesce(p_year_label, ''))) not between 1 and 20 then
    raise exception 'name the year, like 2026-27';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on <= p_starts_on then
    raise exception 'the year must end after it starts';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into public.organization (kind, name) values ('school', btrim(p_name)) returning id into org;
  insert into lms.school (org_id, code, display_name, board) values (org, sc, btrim(p_name), p_board);
  insert into lms.academic_year (org_id, label, starts_on, ends_on) values (org, btrim(p_year_label), p_starts_on, p_ends_on);
  insert into admin.school_profile (org_id) values (org);
  perform lms.audit(org, 'school-created', sc);
  perform admin.audit(me, 'school-created', 'school', sc, p_reason, jsonb_build_object('orgId', org, 'board', p_board));
  return org;
end;
$$;

create or replace function admin.school_set_licence(p_code text, p_plan text, p_seats integer, p_until date, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  org uuid;
  sc text;
  was lms.licence;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  select l.* into was from lms.licence l where l.org_id = org;
  perform set_config('admin.session', 'on', true);
  perform lms.set_licence(sc, p_plan, p_seats, p_until);
  perform admin.audit(me, 'licence-set', 'school', sc, p_reason, jsonb_build_object(
    'before', case when was.org_id is null then null else jsonb_build_object(
                'plan', was.plan, 'seats', was.seats, 'validUntil', to_char(was.valid_until, 'YYYY-MM-DD')) end,
    'after', (select jsonb_build_object('plan', l.plan, 'seats', l.seats, 'validUntil', to_char(l.valid_until, 'YYYY-MM-DD'))
                from lms.licence l where l.org_id = org)));
end;
$$;

create or replace function admin.school_quiet_set(p_code text, p_until date, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  was date;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  if p_until is not null and (p_until < lms.india_today() or p_until > lms.india_today() + 90) then
    raise exception 'a holiday ends between today and 90 days from now';
  end if;
  select p.quiet_until into was from admin.school_profile p where p.org_id = org;
  perform set_config('admin.session', 'on', true);
  insert into admin.school_profile (org_id, quiet_until) values (org, p_until)
  on conflict (org_id) do update set quiet_until = excluded.quiet_until, updated_at = now();
  perform admin.audit(me, 'school-quiet-set', 'school', sc, p_reason,
    jsonb_build_object('before', to_char(was, 'YYYY-MM-DD'), 'until', to_char(p_until, 'YYYY-MM-DD')));
end;
$$;

create or replace function admin.school_offboard(p_code text, p_offboard boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  org uuid;
  sc text;
  was jsonb;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_offboard is null then
    raise exception 'say whether to offboard the school or bring it back';
  end if;
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  perform set_config('admin.session', 'on', true);
  insert into admin.school_profile (org_id, offboarded_at, offboarded_by)
  values (org, case when p_offboard then now() end, case when p_offboard then me.user_id end)
  on conflict (org_id) do update
    set offboarded_at = case when p_offboard then coalesce(admin.school_profile.offboarded_at, now()) end,
        offboarded_by = case when p_offboard then coalesce(admin.school_profile.offboarded_by, me.user_id) end,
        updated_at = now();
  if p_offboard then
    select v.value into was from admin.app_flag v where v.key = 'tutor.enabled' and v.scope = 'school' and v.scope_id = sc;
    insert into admin.app_flag (key, scope, scope_id, value, updated_by)
    values ('tutor.enabled', 'school', sc, 'false'::jsonb, me.user_id)
    on conflict (key, scope, scope_id) do update
      set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
    perform admin.audit(me, 'flag-set', 'flag', 'tutor.enabled @ ' || sc, p_reason,
      jsonb_build_object('before', was, 'after', false));
  end if;
  perform admin.audit(me, case when p_offboard then 'school-offboarded' else 'school-brought-back' end,
    'school', sc, p_reason, '{}'::jsonb);
end;
$$;

-- Plan 1's admin.flag_set (0050), replaced with one rule more: setting
-- tutor.enabled to true, at a school or everywhere, is the owner's. Spec
-- section 3 lets ops stop the tutor but not resume it. Everything else is
-- 0050's body unchanged; the grants stay as 0050 set them.
create or replace function admin.flag_set(p_key text, p_scope text, p_scope_id text, p_value jsonb, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  def admin.flag_def;
  before jsonb;
  sid text := coalesce(p_scope_id, '');
begin
  select d.* into def from admin.flag_def d where d.key = p_key;
  if def.key is null then
    raise exception 'there is no switch called %', coalesce(p_key, '(nothing)');
  end if;
  if p_key = 'tutor.enabled' and p_value = 'true'::jsonb then
    perform admin.require_staff(array[]::text[]);
  end if;
  if def.guarded then
    perform admin.require_fresh_mfa(10);
  end if;
  perform admin.check_environment(p_env);
  if p_scope not in ('global', 'school') or (p_scope = 'school' and not def.school_scoped) then
    raise exception 'this switch cannot be set for %', coalesce(p_scope, '(nothing)');
  end if;
  if p_scope = 'global' then
    sid := '';
  elsif not exists (select 1 from lms.school s where s.code = upper(sid)) then
    raise exception 'there is no school with the code %', sid;
  else
    sid := upper(sid);
  end if;
  if not admin.flag_valid(def.kind, p_value) then
    raise exception 'the value does not suit this switch (%)', def.kind;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why, in a few words';
  end if;
  select v.value into before from admin.app_flag v where v.key = p_key and v.scope = p_scope and v.scope_id = sid;
  perform set_config('admin.session', 'on', true);
  insert into admin.app_flag (key, scope, scope_id, value, updated_by)
  values (p_key, p_scope, sid, p_value, me.user_id)
  on conflict (key, scope, scope_id) do update
    set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  perform admin.audit(me, 'flag-set', 'flag', p_key || case when sid = '' then '' else ' @ ' || sid end, p_reason,
    jsonb_build_object('before', before, 'after', p_value));
end;
$$;

create or replace function admin.school_export(p_code text, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  org uuid;
  sch lms.school;
  people jsonb;
  parents jsonb;
  work jsonb;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.* into sch from lms.school s where s.org_id = org;
  select coalesce(jsonb_agg(jsonb_build_object(
           'loginId', a.login_id, 'kind', a.kind, 'displayName', a.display_name,
           'className', en.class_name, 'roll', en.roll,
           'leftOn', to_char((a.left_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'))
         order by a.kind, a.login_id), '[]'::jsonb)
    into people
    from lms.account a
    left join lateral (
      select sec.grade || sec.name as class_name, e.roll_number as roll
        from lms.enrolment e join lms.section sec on sec.id = e.section_id
       where e.student_user_id = a.user_id and e.academic_year_id = lms.current_year(org) and e.left_on is null
       limit 1
    ) en on true
   where a.org_id = org and a.kind in ('student', 'teacher', 'admin');
  select coalesce(jsonb_agg(jsonb_build_object(
           'loginId', p.login_id,
           'children', (select coalesce(jsonb_agg(c.login_id order by c.login_id), '[]'::jsonb)
                          from lms.guardian g join lms.account c on c.user_id = g.student_user_id
                         where g.parent_user_id = p.user_id))
         order by p.login_id), '[]'::jsonb)
    into parents
    from lms.account p
   where p.org_id = org and p.kind = 'parent';
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', w.title, 'kind', w.kind, 'className', sec.grade || sec.name, 'subject', sub.name,
           'publishedOn', to_char((w.published_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
           'dueOn', to_char((w.due_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
           'handedIn', (select count(distinct s.student_user_id)::int from lms.submission s where s.assignment_id = w.id))
         order by w.published_at), '[]'::jsonb)
    into work
    from lms.assignment w
    join lms.section sec on sec.id = w.section_id
    join lms.subject sub on sub.id = w.subject_id
   where w.org_id = org and w.published_at is not null;
  perform admin.audit(me, 'school-exported', 'school', sch.code, p_reason, jsonb_build_object(
    'people', jsonb_array_length(people), 'parents', jsonb_array_length(parents), 'work', jsonb_array_length(work)));
  return jsonb_build_object(
    'school', jsonb_build_object('code', sch.code, 'name', sch.display_name, 'board', sch.board),
    'exportedAt', now(), 'people', people, 'parents', parents, 'work', work);
end;
$$;

create or replace function admin.school_person_disable(p_code text, p_login text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  who lms.account;
  classes jsonb;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  select a.* into who from lms.account a where a.org_id = org and a.login_id = upper(btrim(coalesce(p_login, '')));
  if who.user_id is null then
    raise exception 'there is no one at this school with the ID %', upper(btrim(coalesce(p_login, '(none)')));
  end if;
  if who.left_at is not null then
    return;
  end if;
  if who.kind = 'admin' and not exists (
    select 1 from lms.account a
     where a.org_id = org and a.kind = 'admin' and a.left_at is null and a.user_id <> who.user_id
  ) then
    raise exception 'this is the school''s only admin; add another admin first';
  end if;
  perform set_config('admin.session', 'on', true);
  -- What lms.mark_left (0034) does, statement for statement; lms.audit's actor
  -- is auth.uid(), here the member of staff.
  update lms.account set left_at = now() where user_id = who.user_id;
  delete from public.membership where org_id = org and user_id = who.user_id;
  if who.kind = 'student' then
    update lms.enrolment set left_on = current_date where student_user_id = who.user_id and left_on is null;
    perform lms.audit(org, 'left', who.login_id);
  else
    select coalesce(jsonb_agg(sec.grade || sec.name || ' ' || sub.name), '[]'::jsonb) into classes
      from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
      join lms.subject sub on sub.id = ta.subject_id
     where ta.teacher_user_id = who.user_id;
    delete from lms.teaching_assignment where teacher_user_id = who.user_id and org_id = org;
    perform lms.audit(org, 'left', who.login_id, jsonb_build_object('classes', classes));
  end if;
  -- Then signed out everywhere (0046).
  perform lms.end_sessions(who.user_id);
  perform admin.audit(me, 'person-disabled', 'school', sc, p_reason,
    jsonb_build_object('loginId', who.login_id, 'kind', who.kind));
end;
$$;

create or replace function admin.school_contact_set(
  p_code text, p_id uuid, p_name text, p_role text, p_phone text, p_email text, p_reason text, p_env text
)
returns uuid
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[[:space:]-]', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  out_id uuid;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'give the contact a name of up to 80 characters';
  end if;
  if char_length(btrim(coalesce(p_role, ''))) not between 1 and 60 then
    raise exception 'say who they are, such as Principal, in up to 60 characters';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'give a phone number or an email';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'write the phone number with its country code, like +919876543210';
  end if;
  if v_email is not null and (char_length(v_email) > 120 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'that is not an email address';
  end if;
  perform set_config('admin.session', 'on', true);
  if p_id is null then
    insert into admin.school_contact (org_id, name, role, phone, email)
    values (org, btrim(p_name), btrim(p_role), v_phone, v_email)
    returning id into out_id;
  else
    update admin.school_contact c
       set name = btrim(p_name), role = btrim(p_role), phone = v_phone, email = v_email, updated_at = now()
     where c.id = p_id and c.org_id = org
    returning c.id into out_id;
    if out_id is null then
      raise exception 'there is no such contact at this school';
    end if;
  end if;
  perform admin.audit(me, 'school-contact-set', 'school', sc, p_reason, jsonb_build_object('contactId', out_id));
  return out_id;
end;
$$;

create or replace function admin.school_contact_remove(p_code text, p_id uuid, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  perform set_config('admin.session', 'on', true);
  delete from admin.school_contact c where c.id = p_id and c.org_id = org;
  if not found then
    raise exception 'there is no such contact at this school';
  end if;
  perform admin.audit(me, 'school-contact-removed', 'school', sc, p_reason, jsonb_build_object('contactId', p_id));
end;
$$;

create or replace function admin.school_note_add(p_code text, p_kind text, p_body text, p_reason text, p_env text)
returns uuid
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  out_id uuid;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  if p_kind is null or p_kind not in ('call', 'note') then
    raise exception 'a note is a call or a note';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'write the note in 1 to 2000 characters';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.school_note (org_id, kind, body, author, author_name)
  values (org, p_kind, btrim(p_body), me.user_id, me.display_name)
  returning id into out_id;
  perform admin.audit(me, 'school-note-added', 'school', sc, p_reason, jsonb_build_object('noteId', out_id, 'kind', p_kind));
  return out_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The school's own activity log (0034), unchanged except that an actor who is
-- Qrie staff reads "Qrie staff" (spec section 13).
-- ---------------------------------------------------------------------------

create or replace function lms.audit_log(p_limit integer default 100)
returns table (at timestamptz, actor_name text, action text, target text, details jsonb)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select e.at,
           coalesce(a.display_name,
                    case when exists (select 1 from admin.platform_staff ps where ps.user_id = e.actor) then 'Qrie staff' end),
           e.action, e.target, e.details
      from lms.audit_event e
      left join lms.account a on a.user_id = e.actor
     where e.org_id = org
     order by e.at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. (create or replace keeps lms.audit_log's own grants from 0034.)
-- ---------------------------------------------------------------------------

revoke all on function admin.school_detail(text) from public, anon;
revoke all on function admin.school_weekly(text, integer) from public, anon;
revoke all on function admin.school_people(text, text, integer) from public, anon;
revoke all on function admin.school_person(text, text) from public, anon;
revoke all on function admin.school_activity(text, timestamptz, integer) from public, anon;
revoke all on function admin.school_notes(text) from public, anon;
revoke all on function admin.school_create(text, text, text, text, date, date, text, text) from public, anon;
revoke all on function admin.school_set_licence(text, text, integer, date, text, text) from public, anon;
revoke all on function admin.school_quiet_set(text, date, text, text) from public, anon;
revoke all on function admin.school_offboard(text, boolean, text, text) from public, anon;
revoke all on function admin.school_export(text, text, text) from public, anon;
revoke all on function admin.school_person_disable(text, text, text, text) from public, anon;
revoke all on function admin.school_contact_set(text, uuid, text, text, text, text, text, text) from public, anon;
revoke all on function admin.school_contact_remove(text, uuid, text, text) from public, anon;
revoke all on function admin.school_note_add(text, text, text, text, text) from public, anon;

grant execute on function admin.school_detail(text) to authenticated;
grant execute on function admin.school_weekly(text, integer) to authenticated;
grant execute on function admin.school_people(text, text, integer) to authenticated;
grant execute on function admin.school_person(text, text) to authenticated;
grant execute on function admin.school_activity(text, timestamptz, integer) to authenticated;
grant execute on function admin.school_notes(text) to authenticated;
grant execute on function admin.school_create(text, text, text, text, date, date, text, text) to authenticated;
grant execute on function admin.school_set_licence(text, text, integer, date, text, text) to authenticated;
grant execute on function admin.school_quiet_set(text, date, text, text) to authenticated;
grant execute on function admin.school_offboard(text, boolean, text, text) to authenticated;
grant execute on function admin.school_export(text, text, text) to authenticated;
grant execute on function admin.school_person_disable(text, text, text, text) to authenticated;
grant execute on function admin.school_contact_set(text, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function admin.school_contact_remove(text, uuid, text, text) to authenticated;
grant execute on function admin.school_note_add(text, text, text, text, text) to authenticated;
