-- ERASURE, WHAT IS KEPT, AND THE CONTEST PURGE (spec sections 2, 7 and 8, plan 5).
--
-- ERASURE HAS ONE DOOR. A request is recorded (owner or ops) with a reference
-- that is never an email address or a phone number, and no requester details
-- (ruling R21). It is verified (owner or ops); a school student must first be
-- marked as left (ruling R19). Only the owner, with a fresh code, starts the
-- erasure (admin.erasure_prepare, called by admin-api), which lists the child's
-- homework photos; admin-api deletes them through the Storage API and then
-- calls admin.erasure_complete with the service role. That refuses while any
-- photo remains, then scrubs the child's login ID from the school's activity
-- log, deletes the auth user (every foreign key to auth.users cascades or sets
-- null except admin.platform_staff's, which restricts, and staff are refused
-- at intake; supabase/tests/admin-privacy.test.ts pins each one), deletes a
-- direct user's solo organisation, and writes one child-erased audit row with
-- counts. Staff logs (admin.audit_event, admin.read_log, admin.case) keep their
-- ids and reasons (ruling R20). The request keeps its ids, not the login ID.
--
-- WHAT IS KEPT: admin.retention_truth() says, table by table, how long each
-- kind of record is kept and which job enforces it, read from this repository
-- on 2026-10-08. A row with no job says "nothing".
--
-- THE CONTEST PURGE: the owner sets a day (admin.contest_purge_set); from that
-- India day the nightly job clears the personal fields of every contest entry
-- made before it (ruling R23). The same job deletes distress flags older than
-- 365 days (ruling R24).

-- ---------------------------------------------------------------------------
-- 1. Erasure requests.
-- ---------------------------------------------------------------------------
create table if not exists admin.erasure_request (
  id uuid primary key default gen_random_uuid(),
  received_on date not null,
  due_on date not null,
  channel text not null check (channel in ('email', 'phone', 'letter', 'school', 'in-app')),
  requester text not null check (requester in ('parent', 'student', 'school', 'other')),
  reference text not null check (reference ~ '^[A-Za-z0-9#/_ -]{3,60}$' and reference !~ '[0-9]{10}'),
  subject_kind text not null check (subject_kind in ('school-student', 'direct')),
  org_id uuid references lms.school on delete set null,
  login_id text,
  -- No foreign key on purpose: the row outlives the account it names.
  user_id uuid not null,
  status text not null default 'received' check (status in ('received', 'verified', 'erasing', 'erased', 'refused')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  verified_how text check (verified_how in ('school-confirmed', 'parent-callback', 'in-person', 'account-signed-in')),
  verified_by uuid,
  verified_at timestamptz,
  refused_by uuid,
  refused_at timestamptz,
  refused_reason text check (char_length(refused_reason) <= 500),
  erasing_by uuid,
  erasing_at timestamptz,
  erase_reason text check (char_length(erase_reason) <= 500),
  erased_at timestamptz,
  tallies jsonb
);
create unique index if not exists erasure_one_open_per_child on admin.erasure_request (user_id)
  where status in ('received', 'verified', 'erasing');
revoke all on admin.erasure_request from public, anon, authenticated, service_role;
alter table admin.erasure_request enable row level security;
drop trigger if exists erasure_request_tripwire on admin.erasure_request;
create trigger erasure_request_tripwire after insert or update or delete on admin.erasure_request
  for each row execute function admin.tripwire();

-- Rows that point at one user, per foreign key to auth.users, counted, keyed
-- schema.table.column. The list is read from the catalogue at the moment of
-- asking, so a table added later is counted without a change here (and the
-- test that pins the list fails until someone has looked at it).
create or replace function admin.erasure_counts(p_user uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  fk record;
  n bigint;
  out jsonb := '{}'::jsonb;
begin
  for fk in
    select format('%I.%I', ns.nspname, cl.relname) as tbl, a.attname::text as col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.confrelid = 'auth.users'::regclass and c.contype = 'f' and c.confdeltype in ('c', 'n')
     order by 1, 2
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into n using p_user;
    if n > 0 then
      out := out || jsonb_build_object(fk.tbl || '.' || fk.col, n);
    end if;
  end loop;
  return out;
end;
$$;
revoke all on function admin.erasure_counts(uuid) from public, anon, authenticated;

-- A login ID in free text, replaced where it stands alone. Login IDs are
-- ^[A-Z0-9-]{3,40}$ (0022), so they hold no pattern characters.
create or replace function admin.scrub_login(p_text text, p_login text)
returns text
language sql immutable
set search_path = admin, public
as $$
  select regexp_replace(coalesce(p_text, ''), '(^|[^A-Z0-9-])' || p_login || '($|[^A-Z0-9-])', '\1[erased]\2', 'g')
$$;
revoke all on function admin.scrub_login(text, text) from public, anon, authenticated;

-- Lines of a school's activity log that name a login ID.
create or replace function admin.activity_lines_naming(p_org uuid, p_login text)
returns integer
language sql stable security definer
set search_path = admin, lms, public
as $$
  select case when p_org is null or p_login is null then 0 else (
    select count(*)::int from lms.audit_event e
     where e.org_id = p_org
       and (position(p_login in e.target) > 0 or position(p_login in e.details::text) > 0)) end
$$;
revoke all on function admin.activity_lines_naming(uuid, text) from public, anon, authenticated;

-- One request as the list shows it: no names.
create or replace function admin.erasure_row(r admin.erasure_request)
returns jsonb
language sql stable security definer
set search_path = admin, lms, public
as $$
  select jsonb_build_object(
    'id', r.id, 'receivedOn', r.received_on, 'dueOn', r.due_on, 'daysLeft', r.due_on - lms.india_today(),
    'channel', r.channel, 'requester', r.requester, 'reference', r.reference, 'subjectKind', r.subject_kind,
    'school', (select jsonb_build_object('code', s.code) from lms.school s where s.org_id = r.org_id),
    'loginId', r.login_id, 'status', r.status)
$$;
revoke all on function admin.erasure_row(admin.erasure_request) from public, anon, authenticated;

create or replace function admin.erasure_intake(
  p_channel text, p_requester text, p_reference text, p_code text, p_login text, p_user uuid,
  p_received_on date, p_reason text, p_env text
)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  who lms.account;
  subject uuid;
  kind text;
  login text;
  new_id uuid;
  ref text := btrim(coalesce(p_reference, ''));
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_channel is null or p_channel not in ('email', 'phone', 'letter', 'school', 'in-app') then
    raise exception 'a request came by email, phone, letter, school or in-app';
  end if;
  if p_requester is null or p_requester not in ('parent', 'student', 'school', 'other') then
    raise exception 'the request is from a parent, the student, the school or someone else';
  end if;
  if ref !~ '^[A-Za-z0-9#/_ -]{3,60}$' or ref ~ '[0-9]{10}' then
    raise exception 'a reference is 3 to 60 letters, digits, spaces, #, /, _ or -, and never an email address or a phone number';
  end if;
  if p_received_on is null or p_received_on > lms.india_today() or p_received_on < lms.india_today() - 365 then
    raise exception 'the day it was received is in the last year, not in the future';
  end if;
  if nullif(btrim(coalesce(p_code, '')), '') is not null and nullif(btrim(coalesce(p_login, '')), '') is not null then
    org := admin.school_org(p_code);
    select a.* into who from lms.account a where a.org_id = org and a.login_id = upper(btrim(p_login));
    if who.user_id is null then
      raise exception 'there is no one at this school with the ID %', upper(btrim(p_login));
    end if;
    if who.kind <> 'student' then
      raise exception 'only a student''s account is erased from here';
    end if;
    subject := who.user_id;
    kind := 'school-student';
    login := who.login_id;
  elsif p_user is not null then
    if exists (select 1 from admin.platform_staff s where s.user_id = p_user) then
      raise exception 'a member of staff is not erased from here';
    end if;
    if not admin.is_direct(p_user) then
      raise exception 'that user is not a direct user';
    end if;
    subject := p_user;
    kind := 'direct';
  else
    raise exception 'name the child: a school code and login ID, or a direct user''s ID';
  end if;
  if exists (select 1 from admin.erasure_request e
              where e.user_id = subject and e.status in ('received', 'verified', 'erasing')) then
    raise exception 'this child already has an open request';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.erasure_request (received_on, due_on, channel, requester, reference, subject_kind, org_id,
                                     login_id, user_id, created_by)
  values (p_received_on, p_received_on + 30, p_channel, p_requester, ref, kind, org, login, subject, me.user_id)
  returning id into new_id;
  perform admin.audit(me, 'erasure-requested', 'erasure', new_id::text, p_reason,
    jsonb_build_object('requestId', new_id, 'subjectKind', kind,
                       'school', (select s.code from lms.school s where s.org_id = org)));
  return jsonb_build_object('requestId', new_id);
end;
$$;

create or replace function admin.erasure_requests(p_open_only boolean default true)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
begin
  return coalesce((
    select jsonb_agg(admin.erasure_row(e) order by e.due_on, e.created_at)
      from admin.erasure_request e
     where not coalesce(p_open_only, true) or e.status in ('received', 'verified', 'erasing')), '[]'::jsonb);
end;
$$;

-- One request: the list's fields, the school student's name and whether they
-- have left, and what would be erased while the account exists.
create or replace function admin.erasure_request(p_request uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public, storage
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  r admin.erasure_request;
  who lms.account;
begin
  select * into r from admin.erasure_request e where e.id = p_request;
  if r.id is null then
    raise exception 'there is no such request';
  end if;
  select a.* into who from lms.account a where a.user_id = r.user_id;
  return admin.erasure_row(r) || jsonb_build_object(
    'displayName', case when r.subject_kind = 'school-student' then who.display_name end,
    'left', case when r.subject_kind = 'school-student' and who.user_id is not null then who.left_at is not null end,
    'verifiedHow', r.verified_how,
    'verifiedByName', (select s.display_name from admin.platform_staff s where s.user_id = r.verified_by),
    'refusedReason', r.refused_reason,
    'tallies', r.tallies,
    'preview', case when exists (select 1 from auth.users u where u.id = r.user_id) then jsonb_build_object(
      'rows', admin.erasure_counts(r.user_id),
      'photos', (select count(*)::int from storage.objects o
                  where o.bucket_id = 'lms-work' and split_part(o.name, '/', 3) = r.user_id::text),
      'activityLogLines', admin.activity_lines_naming(r.org_id, r.login_id)) end);
end;
$$;

create or replace function admin.erasure_verify(p_request uuid, p_how text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  r admin.erasure_request;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_how is null or p_how not in ('school-confirmed', 'parent-callback', 'in-person', 'account-signed-in') then
    raise exception 'say how the request was verified: school-confirmed, parent-callback, in-person or account-signed-in';
  end if;
  select * into r from admin.erasure_request e where e.id = p_request for update;
  if r.id is null then
    raise exception 'there is no such request';
  end if;
  if r.status <> 'received' then
    raise exception 'only a received request is verified';
  end if;
  if r.subject_kind = 'school-student'
     and exists (select 1 from lms.account a where a.user_id = r.user_id and a.left_at is null) then
    raise exception 'mark this child as left first (the school admin, or Disable on their card)';
  end if;
  perform set_config('admin.session', 'on', true);
  update admin.erasure_request
     set status = 'verified', verified_how = p_how, verified_by = me.user_id, verified_at = now()
   where id = r.id;
  perform admin.audit(me, 'erasure-verified', 'erasure', r.id::text, p_reason,
    jsonb_build_object('requestId', r.id, 'how', p_how));
end;
$$;

create or replace function admin.erasure_refuse(p_request uuid, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  r admin.erasure_request;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  select * into r from admin.erasure_request e where e.id = p_request for update;
  if r.id is null then
    raise exception 'there is no such request';
  end if;
  if r.status not in ('received', 'verified') then
    raise exception 'only an open request is refused';
  end if;
  perform set_config('admin.session', 'on', true);
  update admin.erasure_request
     set status = 'refused', refused_by = me.user_id, refused_at = now(), refused_reason = left(btrim(p_reason), 500)
   where id = r.id;
  perform admin.audit(me, 'erasure-refused', 'erasure', r.id::text, p_reason, jsonb_build_object('requestId', r.id));
end;
$$;

-- The owner starts an erasure with a fresh code; admin-api is its only caller.
-- Answers the child's homework photos for admin-api to delete. A request
-- already erasing (a retry after Storage failed) is listed again, unchanged.
create or replace function admin.erasure_prepare(p_request uuid, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public, storage
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  r admin.erasure_request;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  select * into r from admin.erasure_request e where e.id = p_request for update;
  if r.id is null or r.status not in ('verified', 'erasing') then
    raise exception 'only a verified request is erased';
  end if;
  if r.status = 'verified' then
    perform set_config('admin.session', 'on', true);
    update admin.erasure_request
       set status = 'erasing', erasing_by = me.user_id, erasing_at = now(), erase_reason = left(btrim(p_reason), 500)
     where id = r.id;
    perform admin.audit(me, 'erasure-started', 'erasure', r.id::text, p_reason, jsonb_build_object('requestId', r.id));
  end if;
  return jsonb_build_object(
    'requestId', r.id,
    'userId', r.user_id,
    'bucket', 'lms-work',
    'objects', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                          where o.bucket_id = 'lms-work' and split_part(o.name, '/', 3) = r.user_id::text), '[]'::jsonb));
end;
$$;

-- admin-api's report, with the service role, once Storage has deleted the photos.
create or replace function admin.erasure_complete(p_request uuid, p_objects_removed integer)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public, storage
as $$
declare
  r admin.erasure_request;
  who admin.platform_staff;
  left_over integer;
  rows_found jsonb;
  log_lines integer := 0;
  solo_orgs uuid[];
  photos integer := greatest(coalesce(p_objects_removed, 0), 0);
begin
  select * into r from admin.erasure_request where id = p_request for update;
  if r.id is null or r.status <> 'erasing' then
    raise exception 'this request is not being erased';
  end if;
  select count(*)::int into left_over
    from storage.objects o
   where o.bucket_id = 'lms-work' and split_part(o.name, '/', 3) = r.user_id::text;
  if left_over > 0 then
    raise exception '% photos of this child are still in storage', left_over;
  end if;
  rows_found := admin.erasure_counts(r.user_id);
  -- A direct user's private solo organisation (0005: every signup gets one;
  -- deleting the user removes the membership, not the organisation). Kept
  -- aside before the user goes, deleted after; a school is never in it.
  select coalesce(array_agg(m.org_id), '{}') into solo_orgs
    from public.membership m
    join public.organization o on o.id = m.org_id and o.kind = 'solo'
   where m.user_id = r.user_id
     and not exists (select 1 from public.membership m2 where m2.org_id = m.org_id and m2.user_id <> r.user_id);
  perform set_config('admin.session', 'on', true);
  if r.login_id is not null and r.org_id is not null then
    update lms.audit_event e
       set target = admin.scrub_login(e.target, r.login_id),
           details = admin.scrub_login(e.details::text, r.login_id)::jsonb
     where e.org_id = r.org_id
       and (position(r.login_id in e.target) > 0 or position(r.login_id in e.details::text) > 0);
    get diagnostics log_lines = row_count;
  end if;
  delete from auth.users u where u.id = r.user_id;
  delete from public.organization o where o.id = any(solo_orgs) and o.kind = 'solo';
  update admin.erasure_request
     set status = 'erased', erased_at = now(), login_id = null,
         tallies = jsonb_build_object('rows', rows_found, 'photos', photos, 'activityLogLines', log_lines)
   where id = r.id;
  select * into who from admin.platform_staff s where s.user_id = r.erasing_by;
  perform admin.audit(who, 'child-erased', 'erasure', r.id::text, coalesce(r.erase_reason, ''),
    jsonb_build_object('rows', rows_found, 'photos', photos, 'activityLogLines', log_lines));
  return jsonb_build_object('requestId', r.id, 'rows', rows_found, 'photos', photos, 'activityLogLines', log_lines);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. What is kept, for how long, and which job keeps to it.
-- ---------------------------------------------------------------------------
create or replace function admin.retention_truth()
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'safety']);
  jobs jsonb;
  v_rows jsonb := '[]'::jsonb;
  item record;
begin
  -- Each scheduled job with its schedule and last run, as admin.system_health
  -- reads them (0055); 'not-captured' where pg_cron's history is not readable.
  if to_regclass('cron.job_run_details') is null then
    select coalesce(jsonb_object_agg(j.jobname, jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'lastStatus', 'not-captured')), '{}'::jsonb)
      into jobs from cron.job j;
  else
    execute $q$
      select coalesce(jsonb_object_agg(j.jobname, jsonb_build_object(
               'name', j.jobname, 'schedule', j.schedule, 'lastStatus', coalesce(d.status, 'never-run'))), '{}'::jsonb)
        from cron.job j
        left join lateral (
          select r.status::text as status from cron.job_run_details r
           where r.jobid = j.jobid order by r.start_time desc nulls last limit 1
        ) d on true
    $q$ into jobs;
  end if;
  for item in
    select * from (values
      (1, 'The tutor''s record of classes and answers', array['public.ledger_event', 'public.learning_session'],
          'what each class and answer was, when, with the child''s user id',
          'until the account is erased (a sitting with no events goes after 90 days)',
          'nothing yet: job purge-old-ledger deletes no event until the server fold sets purge_safe_before, and nothing sets it (0021)',
          null),
      (2, 'A child''s reports, with their words', array['public.student_report'],
          'the kind, the child''s note, the tutor''s line, the lesson and times, with the child''s user id',
          'until the account is erased', 'nothing', null),
      (3, 'Distress flags (no child id, no words)', array['admin.safety_event'],
          'the category, whose words matched, the school, the build and two times', '365 days',
          'job admin-privacy-daily (0069)', 'admin-privacy-daily'),
      (4, 'A parent''s consent: name, phone, time', array['public.consent_record'],
          'the parent''s name and phone, when they consented and how it was verified',
          'until the account is erased', 'nothing', null),
      (5, 'Contest entries: child''s name, phone, address, city, school; parent''s name and phone as typed',
          array['public.contest_signup'],
          'the personal fields as typed, the class, the tuition answer, the campaign and the time',
          'until the purge date clears them, else until the account is erased', 'job admin-privacy-daily (0069)',
          'admin-privacy-daily'),
      (6, 'Phone numbers a code was sent to', array['public.otp_send'],
          'the phone number, the user id and the time', 'no window', 'nothing (0019 says nothing sweeps it)', null),
      (7, 'What each tutor call cost, with the user id', array['public.usage_event', 'public.relay_usage'],
          'each call''s model, tokens, characters and status, and the daily meter, with the user id',
          'until the account is erased', 'nothing', null),
      (8, 'Progress and the learner model', array['public.student_state', 'public.concept_state', 'public.learner_model'],
          'saved app state, mastery per concept and the learner model, with the user id',
          'until the account is erased', 'nothing', null),
      (9, 'School records: homework, answers, marks, attendance, comments, remarks, photos (lms-work)', array['lms.*'],
          'everything the school''s teachers and the child entered, and the homework photos',
          'until the child is erased; leaving keeps them', 'nothing', null),
      (10, 'Staff actions, reads of a child''s words', array['admin.audit_event', 'admin.read_log', 'admin.case'],
          'who did what and why, by id; who opened which report and why', 'forever, insert-only (ids and reasons)',
          'nothing', null),
      (11, 'Cashfree signature failures', array['billing.webhook_event'],
          'webhook deliveries whose signature did not verify', '90 days', 'job billing-states (0060)', 'billing-states')
    ) as t(ord, what, tables, holds, kept, enforced_by, job)
    order by ord
  loop
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'what', item.what, 'tables', to_jsonb(item.tables), 'holds', item.holds, 'kept', item.kept,
      'enforcedBy', item.enforced_by,
      'job', case when item.job is null then null
                  else coalesce(jobs -> item.job,
                                jsonb_build_object('name', item.job, 'schedule', null, 'lastStatus', 'not-scheduled')) end));
  end loop;
  return jsonb_build_object(
    'rows', v_rows,
    'contest', jsonb_build_object(
      'purgeOn', (select s.value #>> '{}' from admin.setting s where s.key = 'contest_purge_on'),
      'purgedAt', (select s.value #>> '{}' from admin.setting s where s.key = 'contest_purged_at')),
    'distressCapture', admin.distress_capture());
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The contest purge and the nightly job.
-- ---------------------------------------------------------------------------
create or replace function admin.contest_purge_set(p_on date, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_on is null or p_on < lms.india_today() + 1 or p_on > lms.india_today() + 730 then
    raise exception 'a purge date is from tomorrow to two years ahead';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.setting (key, value) values ('contest_purge_on', to_jsonb(to_char(p_on, 'YYYY-MM-DD')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin.audit(me, 'contest-purge-set', 'setting', 'contest_purge_on', p_reason,
    jsonb_build_object('on', to_char(p_on, 'YYYY-MM-DD')));
end;
$$;

-- From the purge day on, clears the personal fields of every contest entry
-- made before that India day that still holds any of them. Class, the tuition
-- answer, campaign, time and user id stay, for counts. Internal.
create or replace function admin.contest_purge_due()
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  purge_on date;
  cleared integer := 0;
begin
  select (s.value #>> '{}')::date into purge_on from admin.setting s where s.key = 'contest_purge_on';
  if purge_on is null or lms.india_today() < purge_on then
    return 0;
  end if;
  update public.contest_signup c
     set student_name = '', student_phone = null, address = null, parent_name_unverified = null,
         parent_phone_unverified = null, school_name = null, city = null
   where c.created_at < (purge_on::timestamp at time zone 'Asia/Kolkata')
     and (c.student_name <> '' or c.student_phone is not null or c.address is not null
          or c.parent_name_unverified is not null or c.parent_phone_unverified is not null
          or c.school_name is not null or c.city is not null);
  get diagnostics cleared = row_count;
  if cleared > 0 then
    insert into admin.setting (key, value) values ('contest_purged_at', to_jsonb(now()::text))
    on conflict (key) do update set value = excluded.value, updated_at = now();
    perform admin.audit_service('contest-purged', 'contest', to_char(purge_on, 'YYYY-MM-DD'), '',
      jsonb_build_object('entries', cleared));
  end if;
  return cleared;
end;
$$;
revoke all on function admin.contest_purge_due() from public, anon, authenticated;

-- The nightly job (01:15 India time): the contest purge, and distress flags
-- older than 365 days.
create or replace function admin.privacy_daily()
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  entries integer;
  flags integer;
begin
  perform set_config('admin.session', 'on', true);
  entries := admin.contest_purge_due();
  delete from admin.safety_event e where e.received_at < now() - interval '365 days';
  get diagnostics flags = row_count;
  return jsonb_build_object('contestEntriesCleared', entries, 'flagsDeleted', flags);
end;
$$;

select cron.schedule('admin-privacy-daily', '45 19 * * *', $job$ select admin.privacy_daily(); $job$);

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
revoke all on function admin.erasure_intake(text, text, text, text, text, uuid, date, text, text) from public, anon;
revoke all on function admin.erasure_requests(boolean) from public, anon;
revoke all on function admin.erasure_request(uuid) from public, anon;
revoke all on function admin.erasure_verify(uuid, text, text, text) from public, anon;
revoke all on function admin.erasure_refuse(uuid, text, text) from public, anon;
revoke all on function admin.erasure_prepare(uuid, text, text) from public, anon;
revoke all on function admin.erasure_complete(uuid, integer) from public, anon, authenticated;
revoke all on function admin.retention_truth() from public, anon;
revoke all on function admin.contest_purge_set(date, text, text) from public, anon;
revoke all on function admin.privacy_daily() from public, anon, authenticated;

grant execute on function admin.erasure_intake(text, text, text, text, text, uuid, date, text, text) to authenticated;
grant execute on function admin.erasure_requests(boolean) to authenticated;
grant execute on function admin.erasure_request(uuid) to authenticated;
grant execute on function admin.erasure_verify(uuid, text, text, text) to authenticated;
grant execute on function admin.erasure_refuse(uuid, text, text) to authenticated;
grant execute on function admin.erasure_prepare(uuid, text, text) to authenticated;
grant execute on function admin.erasure_complete(uuid, integer) to service_role;
grant execute on function admin.retention_truth() to authenticated;
grant execute on function admin.contest_purge_set(date, text, text) to authenticated;
grant execute on function admin.privacy_daily() to service_role;
