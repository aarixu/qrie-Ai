-- THE FINAL REVIEW'S FIXES (supabase/tests/admin-final-fixes.test.ts).
--
-- 1. THE TRIPWIRE ON FIVE MORE CONTROL TABLES. 0047 says control tables carry
--    admin.tripwire(), so hand-written SQL leaves an 'unmanaged-change' row
--    (spec section 6). Five did not: admin.platform_staff (who is staff, and
--    with which role), admin.setting (the environment, among others: on
--    HOSTED it also turns the privacy import gate on, 0066),
--    admin.flag_def (whether a switch is guarded, and its safe default),
--    admin.cap_override (the one-day ceiling raise) and admin.alert_token.
--    They do now. Every function that writes them sets admin.session for its
--    own transaction first. Those that already did: staff_set, staff_invite,
--    set_caps, revert_caps, restore_drill_set, safety_capture_set,
--    contest_purge_set, public.keep_safety_event and admin.privacy_daily
--    (which calls admin.contest_purge_due). Those that did not are replaced
--    below with their bodies unchanged and that one line added:
--    admin.bootstrap_owner and admin.set_environment (0047),
--    admin.alert_token_set (0051), public.alert_snapshot (0065),
--    public.audit_head (0055), admin.billing_reconcile_due and
--    admin.billing_reconcile_done (0059). A later migration that writes one
--    of these tables sets admin.session itself, or leaves a row.
--
-- 2. INVOICE NUMBERS FROM 10,000. 0057's billing.format_number padded with
--    lpad(n, 4), which also CUTS to 4: the 10,000th invoice of a year became
--    QRIE/26-27/1000, collided with the 1,000th, and stopped invoicing for
--    the rest of the year. Now at least four digits, all of them kept (up to
--    99999, which fits the 16-character number).
--
-- 3. WRONG ALARM TOKENS, SHOWN. 0051 and 0065 count a wrong token in
--    admin.alert_miss and say the count is how an attack becomes visible, but
--    nothing read it. admin.system_health (0055's body unchanged otherwise)
--    now carries alarm.tokenMisses1h: wrong tokens given to
--    public.alert_snapshot or public.audit_head in the last hour.
--
-- 4. CLASS PREPARATION BACK ON IS THE OWNER'S. Spec section 3: everything that
--    makes money flow again needs the owner. Setting tutor.only_prepared to
--    false lets the tutor app prepare a new class for any topic (and spend on
--    it), so admin.flag_set (0053's body otherwise unchanged) asks for the
--    owner then, as it already did for tutor.enabled = true (R23).
--
-- 5. A SCHOOL CAN FOLLOW THE PLATFORM AGAIN. A school's own tutor.enabled
--    value wins over the platform's (public.app_config: school, then global,
--    then the safe default), and flag_set only ever upserts: a school switched
--    back on with its own value ignored the platform's switch from then on,
--    and nothing but hand-written SQL could undo it. admin.flag_clear deletes
--    a school's own value of a school-scoped switch, audited as
--    'flag-cleared'. It is judged as setting the school to the value it will
--    then follow: when that brings the school's tutor back on, it is the
--    owner's (R23); otherwise owner or ops. Guarded switches need a fresh code.

-- ---------------------------------------------------------------------------
-- 1. The tripwire
-- ---------------------------------------------------------------------------

drop trigger if exists platform_staff_tripwire on admin.platform_staff;
create trigger platform_staff_tripwire
  after insert or update or delete on admin.platform_staff
  for each row execute function admin.tripwire();

drop trigger if exists setting_tripwire on admin.setting;
create trigger setting_tripwire
  after insert or update or delete on admin.setting
  for each row execute function admin.tripwire();

drop trigger if exists flag_def_tripwire on admin.flag_def;
create trigger flag_def_tripwire
  after insert or update or delete on admin.flag_def
  for each row execute function admin.tripwire();

drop trigger if exists cap_override_tripwire on admin.cap_override;
create trigger cap_override_tripwire
  after insert or update or delete on admin.cap_override
  for each row execute function admin.tripwire();

drop trigger if exists alert_token_tripwire on admin.alert_token;
create trigger alert_token_tripwire
  after insert or update or delete on admin.alert_token
  for each row execute function admin.tripwire();

-- 0047's admin.bootstrap_owner, with admin.session set before its write.
create or replace function admin.bootstrap_owner(p_user uuid, p_name text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
begin
  if exists (select 1 from admin.platform_staff where role = 'owner' and active) then
    raise exception 'there is already an owner';
  end if;
  if not exists (select 1 from auth.users where id = p_user and not is_anonymous) then
    raise exception 'there is no such permanent account';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.platform_staff (user_id, role, display_name) values (p_user, 'owner', btrim(p_name))
  on conflict (user_id) do update set role = 'owner', active = true, deactivated_at = null, display_name = excluded.display_name;
  perform admin.audit_service('owner-bootstrapped', 'staff', p_user::text, 'first owner', '{}'::jsonb);
end;
$$;

-- 0047's admin.set_environment, with admin.session set before its write.
create or replace function admin.set_environment(p_env text, p_force boolean default false)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  current_env text := admin.environment();
begin
  if p_env is null or p_env not in ('HOSTED', 'STAGING', 'DEMO', 'TEST') then
    raise exception 'the environment is HOSTED, STAGING, DEMO or TEST';
  end if;
  if current_env = p_env then
    return;
  end if;
  if current_env <> 'UNSET' and not coalesce(p_force, false) then
    raise exception 'the environment is already %; pass force to change it', current_env;
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.setting (key, value) values ('environment', to_jsonb(p_env))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin.audit_service('environment-set', 'setting', 'environment', '',
    jsonb_build_object('environment', p_env, 'from', current_env));
end;
$$;

-- 0051's admin.alert_token_set, with admin.session set before its write.
create or replace function admin.alert_token_set(p_token text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'the alarm token is at least 32 characters';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.alert_token (id, token_hash)
  values (true, encode(sha256(convert_to(p_token, 'utf8')), 'hex'))
  on conflict (id) do update set token_hash = excluded.token_hash, rotated_at = now();
  perform admin.audit_service('alarm-token-rotated', 'setting', 'alert_token', '', '{}'::jsonb);
end;
$$;

-- 0065's public.alert_snapshot, with admin.session set before its write to
-- admin.setting. A wrong token writes only admin.alert_miss, which has no
-- tripwire.
create or replace function public.alert_snapshot(p_token text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  expected text;
  utc_day date := (now() at time zone 'utc')::date;
  rc record;
  units integer;
  rep record;
  cls integer;
  recent integer;
  failed integer;
  distress integer;
  prev_seen timestamptz;
  since timestamptz;
begin
  -- A wrong token is ANSWERED, not raised: an exception would roll back the
  -- insert below, and the count of misses is how an attack becomes visible.
  select t.token_hash into expected from admin.alert_token t where t.id;
  if expected is null or p_token is null
     or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> expected then
    insert into admin.alert_miss default values;
    delete from admin.alert_miss m where m.at < now() - interval '1 hour';
    return jsonb_build_object('error', 'not-allowed');
  end if;

  select c.halted, c.global_units_per_day into rc from public.relay_control c where c.id;
  select coalesce(max(b.units), 0) into units from public.relay_budget_day b where b.day = utc_day;
  select count(*) filter (where r.status = 'new')::int as new_count,
         count(*) filter (where r.status = 'new' and r.kind = 'unsafe')::int as unsafe_new,
         coalesce(floor(extract(epoch from now() - min(r.received_at) filter (where r.status = 'new')) / 60), 0)::int as oldest_minutes
    into rep from public.student_report r;
  select count(*)::int into cls from public.prepared_class p where p.review_status = 'pending';
  select count(*)::int, count(*) filter (where e.status = 0 or e.status >= 500)::int
    into recent, failed from public.usage_event e where e.at > now() - interval '5 minutes';
  -- The previous good check, read before this one overwrites it below.
  begin
    select (s.value #>> '{}')::timestamptz into prev_seen from admin.setting s where s.key = 'alert_last_seen';
  exception when others then
    prev_seen := null;
  end;
  since := greatest(now() - interval '24 hours', least(coalesce(prev_seen, now()), now() - interval '15 minutes'));
  select count(*)::int into distress from admin.safety_event e where e.received_at > since;

  perform set_config('admin.session', 'on', true);
  insert into admin.setting (key, value) values ('alert_last_seen', to_jsonb(now()::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object(
    'at', now(),
    'halted', coalesce(rc.halted, false),
    'ceilingUnits', rc.global_units_per_day,
    'unitsToday', units,
    'newReports', rep.new_count,
    'unsafeNewReports', rep.unsafe_new,
    'oldestNewReportMinutes', rep.oldest_minutes,
    'pendingClasses', cls,
    'relayEvents5m', recent,
    'relayFailures5m', failed,
    'distressFlags', distress,
    'distressWindowMinutes', round(extract(epoch from now() - since) / 60)::int
  );
end;
$$;

-- 0055's public.audit_head, with admin.session set before its write to
-- admin.setting.
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
  perform set_config('admin.session', 'on', true);
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

-- 0059's admin.billing_reconcile_due, with admin.session set before its write.
create or replace function admin.billing_reconcile_due(p_force boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, public
as $$
declare
  started timestamptz;
begin
  select billing.ts_or_null(s.value #>> '{}') into started from admin.setting s where s.key = 'billing_reconcile_started';
  if not coalesce(p_force, false) and started is not null and started > now() - interval '55 minutes' then
    return jsonb_build_object('due', false);
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.setting (key, value) values ('billing_reconcile_started', to_jsonb(now()::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object(
    'due', true,
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('linkId', x.link_id, 'status', x.status,
                                          'createdMinutesAgo', x.mins) order by x.checked nulls first, x.created_at)
        from (select l.link_id, l.status, l.last_checked_at as checked, l.created_at,
                     floor(extract(epoch from now() - l.created_at) / 60)::int as mins
                from billing.payment_link l
               where (l.status in ('creating', 'active', 'partly_paid') or billing.link_unrecorded(l.id) > 0)
                 and l.created_at > now() - interval '180 days'
               order by l.last_checked_at nulls first, l.created_at
               limit 50) x), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object('refundId', x.refund_id, 'orderId', x.cf_order_id, 'status', x.status,
                                          'createdMinutesAgo', x.mins) order by x.created_at)
        from (select r.refund_id, p.cf_order_id, r.status, r.created_at,
                     floor(extract(epoch from now() - r.created_at) / 60)::int as mins
                from billing.refund r join billing.payment p on p.id = r.payment_id
               where r.status in ('requested', 'pending')
               order by r.created_at
               limit 50) x), '[]'::jsonb));
end;
$$;

-- 0059's admin.billing_reconcile_done, with admin.session set before its write.
create or replace function admin.billing_reconcile_done(p_value jsonb)
returns void
language plpgsql volatile security definer
set search_path = admin, billing, public
as $$
begin
  perform set_config('admin.session', 'on', true);
  insert into admin.setting (key, value) values ('billing_reconciled_at', to_jsonb(now()::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin.audit_service('billing-reconciled', 'billing', 'reconcile', '',
    jsonb_build_object('checked', coalesce(billing.int_or_null(p_value ->> 'checked'), 0),
                       'changed', coalesce(billing.int_or_null(p_value ->> 'changed'), 0),
                       'failed', coalesce(billing.int_or_null(p_value ->> 'failed'), 0)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Invoice and credit-note numbers
-- ---------------------------------------------------------------------------

create or replace function billing.format_number(p_series text, p_fy text, p_n integer) returns text language plpgsql immutable as $$
begin
  if p_n > 99999 then
    raise exception 'the % series is full for this year', case p_series when 'invoice' then 'invoice' else 'credit note' end;
  end if;
  return case p_series when 'invoice' then 'QRIE/' else 'QRCN/' end || p_fy || '/'
      || lpad(p_n::text, greatest(4, char_length(p_n::text)), '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The System page, with the last hour's wrong alarm tokens
-- ---------------------------------------------------------------------------

-- 0055's admin.system_health, line for line, with alarm.tokenMisses1h added.
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
  misses integer;
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
  -- Wrong tokens given to the alarm or the audit copy in the last hour.
  select count(*)::int into misses from admin.alert_miss m where m.at > now() - interval '1 hour';
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
      case when alarm_seen is null then null else floor(extract(epoch from now() - alarm_seen::timestamptz) / 60)::int end,
      'tokenMisses1h', misses),
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

-- ---------------------------------------------------------------------------
-- 4. admin.flag_set: tutor.only_prepared = false is the owner's
-- ---------------------------------------------------------------------------

-- 0053's admin.flag_set, with one rule more after R23's: setting
-- tutor.only_prepared to false is the owner's. The grants stay as 0050 set them.
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
  if p_key = 'tutor.only_prepared' and p_value = 'false'::jsonb then
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

-- ---------------------------------------------------------------------------
-- 5. admin.flag_clear: a school follows the platform's value again
-- ---------------------------------------------------------------------------

create or replace function admin.flag_clear(p_key text, p_scope_id text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  def admin.flag_def;
  sid text := upper(btrim(coalesce(p_scope_id, '')));
  before jsonb;
  follows jsonb;
begin
  select d.* into def from admin.flag_def d where d.key = p_key;
  if def.key is null then
    raise exception 'there is no switch called %', coalesce(p_key, '(nothing)');
  end if;
  if not def.school_scoped then
    raise exception 'this switch cannot be set for one school';
  end if;
  if def.guarded then
    perform admin.require_fresh_mfa(10);
  end if;
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if not exists (select 1 from lms.school s where s.code = sid) then
    raise exception 'there is no school with the code %', coalesce(nullif(sid, ''), '(nothing)');
  end if;
  select v.value into before from admin.app_flag v where v.key = p_key and v.scope = 'school' and v.scope_id = sid;
  if before is null then
    raise exception '% has no value of its own for %', sid, p_key;
  end if;
  -- What the school follows once its own value is gone: the platform's value,
  -- else the safe default (public.app_config's order).
  select coalesce((select g.value from admin.app_flag g where g.key = p_key and g.scope = 'global'), def.safe_default)
    into follows;
  if p_key = 'tutor.enabled' and follows = 'true'::jsonb and before is distinct from 'true'::jsonb then
    perform admin.require_staff(array[]::text[]);
  end if;
  perform set_config('admin.session', 'on', true);
  delete from admin.app_flag v where v.key = p_key and v.scope = 'school' and v.scope_id = sid;
  perform admin.audit(me, 'flag-cleared', 'flag', p_key || ' @ ' || sid, p_reason,
    jsonb_build_object('before', before, 'after', null));
end;
$$;

revoke all on function admin.flag_clear(text, text, text, text) from public, anon;
grant execute on function admin.flag_clear(text, text, text, text) to authenticated;
