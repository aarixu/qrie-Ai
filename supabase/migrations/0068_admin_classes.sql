-- CLASSES: PENDING, PUBLISH, RETRACT, REJECT, REPORTS AND COST (spec section 8, plan 5).
--
-- The owner publishes a class waiting for review. The owner or ops retracts a
-- published class, or rejects one waiting for review, with a fresh code,
-- because its files are then deleted for good (ruling R15). A removed class is
-- hidden from the catalogue the moment it is retracted; admin-api then deletes
-- its files through the Storage API and calls admin.class_files_removed, which
-- deletes the catalogue row only once Storage holds none of its files, so the
-- topic can be prepared and kept again. What staff did to each class is kept
-- in admin.class_review after the class is gone.

-- ---------------------------------------------------------------------------
-- 1. The catalogue shows only published classes (ruling R16). Every row is
-- 'published' by default (0018), so nothing a student sees today changes.
-- ---------------------------------------------------------------------------
drop policy if exists "anyone may read prepared classes" on public.prepared_class;
drop policy if exists "anyone may read published classes" on public.prepared_class;
create policy "anyone may read published classes" on public.prepared_class
  for select using (review_status = 'published');
drop trigger if exists prepared_class_tripwire on public.prepared_class;
create trigger prepared_class_tripwire after update or delete on public.prepared_class
  for each row execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- 2. What staff did to each class, kept after the class is gone.
-- ---------------------------------------------------------------------------
create table if not exists admin.class_review (
  id bigint generated always as identity primary key,
  class_id text not null,
  topic_ref text not null,
  title text not null,
  version integer,
  action text not null check (action in ('published', 'retracted', 'rejected', 'files-removed')),
  actor uuid,
  actor_name text not null,
  at timestamptz not null default now(),
  reason text not null default '' check (char_length(reason) <= 500),
  files integer
);
create index if not exists class_review_class on admin.class_review (class_id, id);
revoke all on admin.class_review from public, anon, authenticated, service_role;
alter table admin.class_review enable row level security;
drop trigger if exists class_review_tripwire on admin.class_review;
create trigger class_review_tripwire after insert or update or delete on admin.class_review
  for each row execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- 3. What a class cost: usage rows of sittings on its topic, and rows that
-- share a preparation id with them. A floor when any row is unpriced (R18).
-- ---------------------------------------------------------------------------
create or replace function admin.class_cost_for(p_topic text)
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  with s as (select ls.id from public.learning_session ls where ls.topic_ref = p_topic),
       p as (select distinct u.prep_id from public.usage_event u
              where u.session_id in (select id from s) and u.prep_id is not null),
       rows as (select u.inr, u.unpriced, u.bucket from public.usage_cost u
                 where u.session_id in (select id from s) or u.prep_id in (select prep_id from p))
  select jsonb_build_object(
    'inr', round(coalesce(sum(inr), 0), 2),
    'liveInr', round(coalesce(sum(inr) filter (where bucket = 'live'), 0), 2),
    'warmInr', round(coalesce(sum(inr) filter (where bucket = 'warm'), 0), 2),
    'unpriced', coalesce(bool_or(unpriced), false),
    'calls', count(*)::int,
    'sittings', (select count(*)::int from s))
  from rows
$$;
revoke all on function admin.class_cost_for(text) from public, anon, authenticated;

-- Reports about a class: lesson_id is its id, or topic_ref is its topic
-- (ruling R17). open: not closed; unsafe: unsafe and not closed. Counts only.
create or replace function admin.class_reports(p_class text, p_topic text)
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  select jsonb_build_object(
    'total', count(*)::int,
    'open', count(*) filter (where r.status <> 'closed')::int,
    'unsafe', count(*) filter (where r.status <> 'closed' and r.kind = 'unsafe')::int)
  from public.student_report r
  where r.lesson_id = p_class or (p_topic is not null and r.topic_ref = p_topic)
$$;
revoke all on function admin.class_reports(text, text) from public, anon, authenticated;

-- One live class as the console lists it.
create or replace function admin.class_row(p public.prepared_class)
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  select jsonb_build_object(
    'id', p.id, 'topicRef', p.topic_ref, 'title', p.title, 'subtitle', p.subtitle, 'klass', p.klass,
    'subject', p.subject, 'status', p.review_status, 'createdAt', p.created_at, 'publishedAt', p.published_at,
    'version', p.version,
    'reports', admin.class_reports(p.id, p.topic_ref),
    'cost', admin.class_cost_for(p.topic_ref),
    'lastAction', (select jsonb_build_object('action', cr.action, 'byName', cr.actor_name, 'at', cr.at)
                     from admin.class_review cr where cr.class_id = p.id order by cr.id desc limit 1))
$$;
revoke all on function admin.class_row(public.prepared_class) from public, anon, authenticated;

-- One removed class: its latest files-removed review row.
create or replace function admin.removed_class_row(p_review bigint)
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  select jsonb_build_object(
    'id', cr.class_id, 'topicRef', cr.topic_ref, 'title', cr.title, 'removedAt', cr.at,
    'byName', cr.actor_name, 'reason', cr.reason, 'reports', admin.class_reports(cr.class_id, cr.topic_ref))
  from admin.class_review cr where cr.id = p_review
$$;
revoke all on function admin.removed_class_row(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The functions the console calls.
-- ---------------------------------------------------------------------------
create or replace function admin.classes(p_status text default null)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'safety']);
begin
  if p_status is not null and p_status not in ('pending', 'published', 'retracted', 'removed') then
    raise exception 'a class status is pending, published, retracted or removed';
  end if;
  if p_status = 'removed' then
    return coalesce((
      select jsonb_agg(admin.removed_class_row(x.id) order by x.at desc)
        from (select distinct on (cr.class_id) cr.id, cr.at
                from admin.class_review cr
               where cr.action = 'files-removed'
               order by cr.class_id, cr.id desc) x), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(admin.class_row(p) order by p.created_at desc, p.id)
      from public.prepared_class p
     where p_status is null or p.review_status = p_status), '[]'::jsonb);
end;
$$;

create or replace function admin.class_detail(p_class text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public, storage
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'safety']);
  p public.prepared_class;
  last_removed bigint;
  topic text;
  by_kind jsonb;
  by_status jsonb;
begin
  select * into p from public.prepared_class x where x.id = p_class;
  select cr.id into last_removed from admin.class_review cr
   where cr.class_id = p_class and cr.action = 'files-removed' order by cr.id desc limit 1;
  if p.id is null and not exists (select 1 from admin.class_review cr where cr.class_id = p_class) then
    raise exception 'there is no class with the ID %', p_class;
  end if;
  topic := coalesce(p.topic_ref, (select cr.topic_ref from admin.class_review cr where cr.class_id = p_class order by cr.id desc limit 1));
  select jsonb_build_object(
           'wrong', count(*) filter (where r.kind = 'wrong')::int, 'rude', count(*) filter (where r.kind = 'rude')::int,
           'unsafe', count(*) filter (where r.kind = 'unsafe')::int, 'other', count(*) filter (where r.kind = 'other')::int),
         jsonb_build_object(
           'new', count(*) filter (where r.status = 'new')::int, 'seen', count(*) filter (where r.status = 'seen')::int,
           'triaged', count(*) filter (where r.status = 'triaged')::int, 'closed', count(*) filter (where r.status = 'closed')::int)
    into by_kind, by_status
    from public.student_report r
   where r.lesson_id = p_class or (topic is not null and r.topic_ref = topic);
  return jsonb_build_object(
    'live', case when p.id is null then null else admin.class_row(p) end,
    'removed', case when last_removed is null then null else admin.removed_class_row(last_removed) end,
    'reportsByKind', by_kind,
    'reportsByStatus', by_status,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('action', cr.action, 'byName', cr.actor_name, 'at', cr.at,
                                          'reason', cr.reason, 'files', cr.files) order by cr.id)
        from admin.class_review cr where cr.class_id = p_class), '[]'::jsonb),
    'filesInStorage', (select count(*)::int from storage.objects o
                        where o.bucket_id = 'classes' and o.name like admin.like_escape(p_class) || '/%'));
end;
$$;

create or replace function admin.class_publish(p_class text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  p public.prepared_class;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  select * into p from public.prepared_class x where x.id = p_class for update;
  if p.id is null then
    raise exception 'there is no class with the ID %', p_class;
  end if;
  if p.review_status <> 'pending' then
    raise exception 'only a class waiting for review can be published';
  end if;
  perform set_config('admin.session', 'on', true);
  update public.prepared_class set review_status = 'published', published_at = now() where id = p.id;
  insert into admin.class_review (class_id, topic_ref, title, version, action, actor, actor_name, reason)
  values (p.id, p.topic_ref, p.title, p.version, 'published', me.user_id, me.display_name, left(btrim(p_reason), 500));
  perform admin.audit(me, 'class-published', 'class', p.id, p_reason,
    jsonb_build_object('classId', p.id, 'topicRef', p.topic_ref, 'version', p.version));
end;
$$;

-- Hides a class at once and lists its files for admin-api to delete. A class
-- already retracted (a retry after Storage failed) is listed again, unchanged.
create or replace function admin.class_remove_prepare(p_class text, p_action text, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public, storage
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  p public.prepared_class;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_action is null or p_action not in ('retract', 'reject') then
    raise exception 'say retract or reject';
  end if;
  select * into p from public.prepared_class x where x.id = p_class for update;
  if p.id is null then
    raise exception 'there is no class with the ID %', p_class;
  end if;
  if p_action = 'retract' and p.review_status not in ('published', 'retracted') then
    raise exception 'only a published class can be retracted';
  end if;
  if p_action = 'reject' and p.review_status not in ('pending', 'retracted') then
    raise exception 'only a class waiting for review can be rejected';
  end if;
  if p.review_status <> 'retracted' then
    perform set_config('admin.session', 'on', true);
    update public.prepared_class set review_status = 'retracted', retracted_at = now() where id = p.id;
    insert into admin.class_review (class_id, topic_ref, title, version, action, actor, actor_name, reason)
    values (p.id, p.topic_ref, p.title, p.version, case when p_action = 'retract' then 'retracted' else 'rejected' end,
            me.user_id, me.display_name, left(btrim(p_reason), 500));
    perform admin.audit(me, case when p_action = 'retract' then 'class-retracted' else 'class-rejected' end, 'class', p.id,
      p_reason, jsonb_build_object('classId', p.id, 'topicRef', p.topic_ref, 'version', p.version));
  end if;
  return jsonb_build_object(
    'classId', p.id,
    'bucket', 'classes',
    'objects', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                          where o.bucket_id = 'classes' and o.name like admin.like_escape(p.id) || '/%'), '[]'::jsonb));
end;
$$;

-- admin-api's report, with the service role, once Storage has deleted the
-- files: the catalogue row goes, and the class_review row says how many.
create or replace function admin.class_files_removed(p_class text, p_removed integer)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public, storage
as $$
declare
  p public.prepared_class;
  left_over integer;
  last_review admin.class_review;
  who admin.platform_staff;
begin
  select * into p from public.prepared_class x where x.id = p_class for update;
  if p.id is null or p.review_status <> 'retracted' then
    raise exception 'this class is not being removed';
  end if;
  select count(*)::int into left_over from storage.objects o
   where o.bucket_id = 'classes' and o.name like admin.like_escape(p.id) || '/%';
  if left_over > 0 then
    raise exception '% files of this class are still in storage', left_over;
  end if;
  select * into last_review from admin.class_review cr
   where cr.class_id = p.id and cr.action in ('retracted', 'rejected') order by cr.id desc limit 1;
  select * into who from admin.platform_staff s where s.user_id = last_review.actor;
  perform set_config('admin.session', 'on', true);
  insert into admin.class_review (class_id, topic_ref, title, version, action, actor, actor_name, reason, files)
  values (p.id, p.topic_ref, p.title, p.version, 'files-removed', last_review.actor,
          coalesce(last_review.actor_name, 'service role'), coalesce(last_review.reason, ''), greatest(coalesce(p_removed, 0), 0));
  delete from public.prepared_class where id = p.id;
  if who.user_id is null then
    perform admin.audit_service('class-files-removed', 'class', p.id, '',
      jsonb_build_object('files', greatest(coalesce(p_removed, 0), 0), 'topicRef', p.topic_ref));
  else
    perform admin.audit(who, 'class-files-removed', 'class', p.id, '',
      jsonb_build_object('files', greatest(coalesce(p_removed, 0), 0), 'topicRef', p.topic_ref));
  end if;
  return jsonb_build_object('classId', p.id, 'removed', greatest(coalesce(p_removed, 0), 0));
end;
$$;

revoke all on function admin.classes(text) from public, anon;
revoke all on function admin.class_detail(text) from public, anon;
revoke all on function admin.class_publish(text, text, text) from public, anon;
revoke all on function admin.class_remove_prepare(text, text, text, text) from public, anon;
revoke all on function admin.class_files_removed(text, integer) from public, anon, authenticated;

grant execute on function admin.classes(text) to authenticated;
grant execute on function admin.class_detail(text) to authenticated;
grant execute on function admin.class_publish(text, text, text) to authenticated;
grant execute on function admin.class_remove_prepare(text, text, text, text) to authenticated;
grant execute on function admin.class_files_removed(text, integer) to service_role;
