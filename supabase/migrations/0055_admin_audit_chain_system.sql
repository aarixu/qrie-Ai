-- THE AUDIT LOG, CHAINED; ITS HEAD FOR THE COPY KEPT OUTSIDE; AND THE
-- PLATFORM'S OWN HEALTH.
--
-- A database superuser can switch off the audit log's triggers (0047). So
-- each audit row also gets an entry in admin.audit_chain whose hash covers the
-- row and the entry before it, and admin.audit_verify recomputes the chain: a
-- row changed or deleted behind the triggers breaks it at that entry. A
-- superuser who rewrites the whole chain consistently is caught from outside:
-- the copy checker (tools/admin-alert/src/audit-copy.ts) keeps the hashes of
-- entries it has seen and asks public.audit_head for them again each hour.
-- Only sequence numbers, hashes and counts leave the database that way.
--
-- admin.system_health is the System page: the relay, each scheduled job's
-- last run (pg_cron's cron.job_run_details, where it exists), when the alarm
-- and the audit copy last checked, the migration level (the Supabase CLI's
-- supabase_migrations.schema_migrations, where it exists), the last restore
-- drill (a date a person types), the chain's state, and Cashfree's webhook
-- health from billing's log once plan 3 has made it. What cannot be read
-- says 'not-captured' (for Cashfree: captured false).

create table if not exists admin.audit_chain (
  seq bigint generated always as identity primary key,
  event_id bigint not null unique references admin.audit_event (id),
  prev_hash text not null,
  hash text not null,
  chained_at timestamptz not null default clock_timestamp()
);
revoke all on admin.audit_chain from public, anon, authenticated, service_role;
alter table admin.audit_chain enable row level security;

drop trigger if exists audit_chain_no_change on admin.audit_chain;
create trigger audit_chain_no_change
  before update or delete on admin.audit_chain
  for each row execute function admin.audit_immutable();
drop trigger if exists audit_chain_no_truncate on admin.audit_chain;
create trigger audit_chain_no_truncate
  before truncate on admin.audit_chain
  for each statement execute function admin.audit_immutable();

-- The newest entry. Each append locks this row first, so appends from
-- concurrent transactions queue instead of both chaining onto the same entry.
create table if not exists admin.audit_chain_head (
  id boolean primary key default true check (id),
  seq bigint not null,
  hash text not null
);
revoke all on admin.audit_chain_head from public, anon, authenticated, service_role;
alter table admin.audit_chain_head enable row level security;

create or replace function admin.audit_row_hash(p_prev text, e admin.audit_event)
returns text
language sql stable
set search_path = admin, public
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_prev, e.id::text, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(e.actor::text, ''), e.actor_role, e.actor_name, e.action, e.target_kind, e.target_id, e.reason,
    e.details::text, e.environment), 'utf8')), 'hex')
$$;

-- Chain what is already in the log, oldest first.
insert into admin.audit_chain_head (id, seq, hash) values (true, 0, repeat('0', 64)) on conflict (id) do nothing;
do $$
declare
  e admin.audit_event;
  prev text := repeat('0', 64);
  last_seq bigint := 0;
begin
  if exists (select 1 from admin.audit_chain) then
    return;
  end if;
  for e in select * from admin.audit_event order by id loop
    insert into admin.audit_chain (event_id, prev_hash, hash)
    values (e.id, prev, admin.audit_row_hash(prev, e))
    returning hash, seq into prev, last_seq;
  end loop;
  update admin.audit_chain_head set seq = last_seq, hash = prev where id;
end
$$;

create or replace function admin.audit_chain_append()
returns trigger
language plpgsql security definer
set search_path = admin, public
as $$
declare
  head admin.audit_chain_head;
  new_hash text;
  new_seq bigint;
begin
  select h.* into head from admin.audit_chain_head h where h.id for update;
  new_hash := admin.audit_row_hash(head.hash, new);
  insert into admin.audit_chain (event_id, prev_hash, hash) values (new.id, head.hash, new_hash)
  returning seq into new_seq;
  update admin.audit_chain_head set seq = new_seq, hash = new_hash where id;
  return null;
end;
$$;

drop trigger if exists audit_chain_append on admin.audit_event;
create trigger audit_chain_append
  after insert on admin.audit_event
  for each row execute function admin.audit_chain_append();

create or replace function admin.audit_verify()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  r record;
  ev admin.audit_event;
  prev text := repeat('0', 64);
  first_break bigint;
  unchained bigint;
begin
  for r in select c.seq, c.event_id, c.prev_hash, c.hash from admin.audit_chain c order by c.seq loop
    select e.* into ev from admin.audit_event e where e.id = r.event_id;
    if ev.id is null or r.prev_hash <> prev or r.hash <> admin.audit_row_hash(prev, ev) then
      first_break := r.seq;
      exit;
    end if;
    prev := r.hash;
  end loop;
  select count(*) into unchained
    from admin.audit_event e
   where not exists (select 1 from admin.audit_chain c where c.event_id = e.id);
  return jsonb_build_object(
    'entries', (select count(*) from admin.audit_chain),
    'headSeq', (select max(c.seq) from admin.audit_chain c),
    'headHash', (select c.hash from admin.audit_chain c order by c.seq desc limit 1),
    'intact', first_break is null and unchained = 0,
    'firstBreakSeq', first_break,
    'unchained', unchained
  );
end;
$$;

create or replace function admin.alert_token_matches(p_token text)
returns boolean
language sql stable security definer
set search_path = admin, public
as $$
  select p_token is not null
     and exists (select 1 from admin.alert_token t
                  where t.id and t.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex'))
$$;

-- What the copy checker asks, with the alarm's token. Hashes and counts only.
create or replace function public.audit_head(p_token text, p_seqs bigint[] default '{}'::bigint[])
returns jsonb
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  v jsonb;
begin
  -- A wrong token is answered and counted, as public.alert_snapshot does (0051).
  if not admin.alert_token_matches(p_token) then
    insert into admin.alert_miss default values;
    delete from admin.alert_miss m where m.at < now() - interval '1 hour';
    return jsonb_build_object('error', 'not-allowed');
  end if;
  v := admin.audit_verify();
  insert into admin.setting (key, value) values ('audit_copy_last_seen', to_jsonb(now()::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object(
    'at', now(),
    'entries', v -> 'entries',
    'headSeq', v -> 'headSeq',
    'headHash', v -> 'headHash',
    'intact', v -> 'intact',
    'firstBreakSeq', v -> 'firstBreakSeq',
    'unchained', v -> 'unchained',
    'known', coalesce((
      select jsonb_agg(jsonb_build_object('seq', k.seq, 'hash', c.hash) order by k.seq)
        from (select distinct x as seq from unnest((coalesce(p_seqs, '{}'::bigint[]))[1:200]) x) k
        left join admin.audit_chain c on c.seq = k.seq), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The System page
-- ---------------------------------------------------------------------------

create or replace function admin.system_health()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
  rc record;
  recent integer;
  failed integer;
  jobs jsonb;
  level text;
  drill date;
  alarm_seen text;
  copy_seen text;
  reconciled_seen text;
  cashfree jsonb;
  chain jsonb := admin.audit_verify();
begin
  select c.halted, c.halted_reason into rc from public.relay_control c where c.id;
  select count(*)::int, count(*) filter (where e.status = 0 or e.status >= 500)::int
    into recent, failed
    from public.usage_event e where e.at > now() - interval '5 minutes';
  if to_regclass('cron.job_run_details') is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'lastStatus', 'not-captured', 'lastStartedAt', null, 'lastEndedAt', null) order by j.jobname), '[]'::jsonb)
      into jobs from cron.job j;
  else
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
               'lastStatus', coalesce(d.status, 'never-run'), 'lastStartedAt', d.start_time, 'lastEndedAt', d.end_time)
             order by j.jobname), '[]'::jsonb)
        from cron.job j
        left join lateral (
          select r.status::text as status, r.start_time, r.end_time
            from cron.job_run_details r
           where r.jobid = j.jobid
           order by r.start_time desc nulls last
           limit 1
        ) d on true
    $q$ into jobs;
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    level := 'not-captured';
  else
    execute 'select max(version)::text from supabase_migrations.schema_migrations' into level;
  end if;
  select (s.value #>> '{}')::date into drill from admin.setting s where s.key = 'restore_drill_on';
  select s.value #>> '{}' into alarm_seen from admin.setting s where s.key = 'alert_last_seen';
  select s.value #>> '{}' into copy_seen from admin.setting s where s.key = 'audit_copy_last_seen';
  select s.value #>> '{}' into reconciled_seen from admin.setting s where s.key = 'billing_reconciled_at';
  -- Cashfree (spec section 9): plan 3's webhook log, once its migration has
  -- made it. Counts and minutes only; never a payload.
  if to_regclass('billing.webhook_event') is null then
    cashfree := jsonb_build_object('captured', false, 'lastWebhookMinutesAgo', null,
                                   'signatureFailures24h', null, 'unprocessed', null);
  else
    execute $q$
      select jsonb_build_object(
        'captured', true,
        'lastWebhookMinutesAgo', (select floor(extract(epoch from now() - max(w.received_at)) / 60)::int
                                    from billing.webhook_event w where w.signature_ok),
        'signatureFailures24h', (select count(*)::int from billing.webhook_event w
                                  where not w.signature_ok and w.received_at > now() - interval '24 hours'),
        'unprocessed', (select count(*)::int from billing.webhook_event w where w.status = 'stored'))
    $q$ into cashfree;
  end if;
  cashfree := cashfree || jsonb_build_object('reconciledMinutesAgo',
    case when reconciled_seen is null then null else floor(extract(epoch from now() - reconciled_seen::timestamptz) / 60)::int end);
  return jsonb_build_object(
    'environment', admin.environment(),
    'generatedAt', now(),
    -- No control row reads as stopped, as the relay's own claim treats it.
    'relay', jsonb_build_object('halted', coalesce(rc.halted, true), 'haltedReason', rc.halted_reason,
                                'events5m', recent, 'failures5m', failed),
    'jobs', jobs,
    'alarm', jsonb_build_object('lastCheckMinutesAgo',
      case when alarm_seen is null then null else floor(extract(epoch from now() - alarm_seen::timestamptz) / 60)::int end),
    'auditCopy', jsonb_build_object('lastCheckMinutesAgo',
      case when copy_seen is null then null else floor(extract(epoch from now() - copy_seen::timestamptz) / 60)::int end),
    'migrations', jsonb_build_object('level', level),
    'restoreDrill', jsonb_build_object('on', to_char(drill, 'YYYY-MM-DD'), 'daysAgo', lms.india_today() - drill),
    'auditChain', jsonb_build_object('entries', chain -> 'entries', 'intact', chain -> 'intact',
                                     'firstBreakSeq', chain -> 'firstBreakSeq', 'unchained', chain -> 'unchained',
                                     'head', left(chain ->> 'headHash', 12)),
    'cashfree', cashfree
  );
end;
$$;

create or replace function admin.restore_drill_set(p_on date, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_on is null or p_on > lms.india_today() or p_on < lms.india_today() - 365 then
    raise exception 'a restore drill date is in the last year, not in the future';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.setting (key, value) values ('restore_drill_on', to_jsonb(to_char(p_on, 'YYYY-MM-DD')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin.audit(me, 'restore-drill-recorded', 'setting', 'restore_drill_on', p_reason,
    jsonb_build_object('on', to_char(p_on, 'YYYY-MM-DD')));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function admin.audit_row_hash(text, admin.audit_event) from public, anon, authenticated;
revoke all on function admin.audit_chain_append() from public, anon, authenticated;
revoke all on function admin.audit_verify() from public, anon, authenticated;
revoke all on function admin.alert_token_matches(text) from public, anon, authenticated;
revoke all on function public.audit_head(text, bigint[]) from public;
revoke all on function admin.system_health() from public, anon;
revoke all on function admin.restore_drill_set(date, text, text) from public, anon;

grant execute on function public.audit_head(text, bigint[]) to anon, authenticated, service_role;
grant execute on function admin.system_health() to authenticated;
grant execute on function admin.restore_drill_set(date, text, text) to authenticated;
