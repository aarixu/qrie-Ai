-- REMOTE SWITCHES FOR EVERY APP, FROM ONE REGISTRY.
--
-- Several controls are compile-time constants today (PROTOTYPE_ONLY_PREPARED in
-- apps/classroom/src/lib/prototype.ts) or environment variables: changing one
-- is a deploy. A flag is a named switch whose value lives in the database, set
-- from the panel and read by the apps. Three rules keep it safe:
--
--   1. A flag must be registered (admin.flag_def) with a type and a SAFE
--      DEFAULT. The panel cannot invent a key, and cannot store a value of the
--      wrong type.
--   2. The apps read only 'public' flags, through public.app_config(), and
--      never a table. If the read fails, the app falls back to the safe
--      default it was built with: a switch that cannot be read never turns a
--      feature on.
--   3. Setting a flag is audited with the value before and after; a flag marked
--      guarded also needs the second factor re-verified.
--
-- A flag is global, or for one school (by its school code). A school's value
-- overrides the global one for that school only.

create table if not exists admin.flag_def (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{2,60}$'),
  kind text not null check (kind in ('bool', 'text', 'tone')),
  safe_default jsonb not null,
  school_scoped boolean not null default false,
  guarded boolean not null default false,
  description text not null
);
revoke all on admin.flag_def from public, anon, authenticated;
alter table admin.flag_def enable row level security;

create table if not exists admin.app_flag (
  key text not null references admin.flag_def on delete restrict,
  scope text not null default 'global' check (scope in ('global', 'school')),
  scope_id text not null default '',
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (key, scope, scope_id),
  check ((scope = 'global' and scope_id = '') or (scope = 'school' and scope_id ~ '^[A-Z0-9]{3,12}$'))
);
revoke all on admin.app_flag from public, anon, authenticated;
alter table admin.app_flag enable row level security;

drop trigger if exists app_flag_tripwire on admin.app_flag;
create trigger app_flag_tripwire
  after insert or update or delete on admin.app_flag
  for each row execute function admin.tripwire();

insert into admin.flag_def (key, kind, safe_default, school_scoped, guarded, description) values
  ('banner.message',        'text', '""',    false, false, 'A notice shown at the top of every app; empty for none.'),
  ('banner.tone',           'tone', '"info"', false, false, 'info or warning.'),
  ('tutor.enabled',         'bool', 'true',  true,  true,  'Whether the tutor is offered; false shows a pause notice.'),
  ('tutor.only_prepared',   'bool', 'false', false, true,  'Teach only classes that are already prepared (replaces PROTOTYPE_ONLY_PREPARED).'),
  ('tutor.compose_live_classes', 'bool', 'false', false, true, 'Lay out live classes with the board composer.'),
  ('contest.entries_open',  'bool', 'true',  false, true,  'Whether the contest form accepts entries.'),
  ('app.min_version.classroom', 'text', '"0.0.0"', false, false, 'Oldest tutor build allowed to run.'),
  ('app.min_version.student',   'text', '"0.0.0"', false, false, 'Oldest student-app build allowed to run.'),
  ('app.min_version.lms',       'text', '"0.0.0"', false, false, 'Oldest teacher-app build allowed to run.')
on conflict (key) do nothing;

create or replace function admin.flag_valid(p_kind text, p_value jsonb)
returns boolean
language sql immutable
as $$
  select case p_kind
    when 'bool' then jsonb_typeof(p_value) = 'boolean'
    when 'text' then jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') <= 280
    when 'tone' then jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') in ('info', 'warning')
    else false
  end
$$;

create or replace function admin.flag_list()
returns table (key text, kind text, description text, guarded boolean, school_scoped boolean,
               safe_default jsonb, scope text, scope_id text, value jsonb, updated_at timestamptz)
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
begin
  return query
    select d.key, d.kind, d.description, d.guarded, d.school_scoped, d.safe_default,
           v.scope, v.scope_id, v.value, v.updated_at
      from admin.flag_def d
      left join admin.app_flag v on v.key = d.key
     order by d.key, v.scope, v.scope_id;
end;
$$;

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

-- What the apps read: every flag with its value, the school's over the global,
-- the safe default where nothing is set. Public by design, and so it holds no
-- secret: a flag's value is something an app would show or obey anyway.
create or replace function public.app_config(p_school text default null)
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  select coalesce(jsonb_object_agg(d.key, coalesce(sv.value, gv.value, d.safe_default)), '{}'::jsonb)
    from admin.flag_def d
    left join admin.app_flag gv on gv.key = d.key and gv.scope = 'global'
    left join admin.app_flag sv on sv.key = d.key and sv.scope = 'school'
                               and sv.scope_id = upper(coalesce(p_school, '-'))
$$;

revoke all on function admin.flag_valid(text, jsonb) from public, anon, authenticated;
revoke all on function admin.flag_list() from public, anon;
revoke all on function admin.flag_set(text, text, text, jsonb, text, text) from public, anon;
revoke all on function public.app_config(text) from public;

grant execute on function admin.flag_list() to authenticated;
grant execute on function admin.flag_set(text, text, text, jsonb, text, text) to authenticated;
grant execute on function public.app_config(text) to anon, authenticated, service_role;
