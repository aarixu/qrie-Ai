-- GRACE, SUSPENSION AND END OF A SCHOOL'S LICENCE; WHAT THE APPS ARE TOLD; AND
-- THE BILLING PAGES' READS.
--
-- 1. THE LADDER (spec section 10; rulings R5, R6, R23). On India's day d, for
--    a school whose licence's last day is L and whose grace is g days (its
--    billing account's grace_days, 14 to 30; 14 without an account):
--      none       no licence
--      trial      d <= L on a pilot licence
--      active     d <= L on any other plan
--      grace      L < d <= L + g
--      suspended  L + g < d <= L + g + 60
--      ended      d > L + g + 60
--    Suspended and ended turn the tutor off for that school (tutor.enabled is
--    false in app_config whatever the school's own switch says). Nothing here
--    touches homework, marks or any of the school's own records.
-- 2. WHAT THE APPS READ (seam S5). public.app_config gains billing.state, one
--    of ok, grace or suspended, and billing.grace_until, the last day of grace
--    as YYYY-MM-DD while in grace and "" otherwise. Anyone who guesses a
--    school code can read it, so it says nothing finer (plan 1's note).
-- 3. THE DAILY JOB billing-states (00:10 India time) records each school's
--    state in billing.school_state when it changes, audits the change, and
--    deletes signature failures older than 90 days (ruling R20).
-- 4. THE PAGES' READS: the overview (counts and sums only, no school named),
--    the list of schools with their billing state (no contact), and one
--    school's billing page (its billing contact in full: one record).

-- ---------------------------------------------------------------------------
-- The ladder (internal)
-- ---------------------------------------------------------------------------

create or replace function billing.state_for(p_org uuid, p_day date)
returns table (state text, grace_until date)
language sql stable
set search_path = billing, lms, public
as $$
  select case
           when l.org_id is null then 'none'
           when p_day <= l.valid_until then case when l.plan = 'pilot' then 'trial' else 'active' end
           when p_day <= l.valid_until + g.days then 'grace'
           when p_day <= l.valid_until + g.days + 60 then 'suspended'
           else 'ended'
         end,
         case when l.org_id is not null and p_day > l.valid_until and p_day <= l.valid_until + g.days
              then l.valid_until + g.days end
    from (select p_org as org_id) x
    left join lms.licence l on l.org_id = x.org_id
    cross join lateral (
      select coalesce((select a.grace_days from billing.account a where a.org_id = p_org), 14) as days
    ) g
$$;

-- ---------------------------------------------------------------------------
-- What the apps read (S5): plan 1's flags, plus the coarse billing state
-- ---------------------------------------------------------------------------

create or replace function public.app_config(p_school text default null)
returns jsonb
language sql stable security definer
set search_path = admin, billing, lms, public
as $$
  with flags as (
    select coalesce(jsonb_object_agg(d.key, coalesce(sv.value, gv.value, d.safe_default)), '{}'::jsonb) as v
      from admin.flag_def d
      left join admin.app_flag gv on gv.key = d.key and gv.scope = 'global'
      left join admin.app_flag sv on sv.key = d.key and sv.scope = 'school'
                                 and sv.scope_id = upper(coalesce(p_school, '-'))
  ), st as (
    select case when f.state = 'grace' then 'grace'
                when f.state in ('suspended', 'ended') then 'suspended'
                else 'ok' end as coarse,
           case when f.state = 'grace' then to_char(f.grace_until, 'YYYY-MM-DD') else '' end as until
      from lms.school s, billing.state_for(s.org_id, lms.india_today()) f
     where s.code = upper(coalesce(p_school, '-'))
  )
  select flags.v
         || jsonb_build_object('billing.state', coalesce((select coarse from st), 'ok'),
                               'billing.grace_until', coalesce((select until from st), ''))
         || case when (select coarse from st) = 'suspended'
                 then jsonb_build_object('tutor.enabled', false) else '{}'::jsonb end
    from flags
$$;
revoke all on function public.app_config(text) from public;
grant execute on function public.app_config(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grace days: the owner, with a fresh code
-- ---------------------------------------------------------------------------

create or replace function admin.billing_grace_set(p_org uuid, p_days integer, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  school_code text;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  if not exists (select 1 from billing.account where org_id = p_org) then
    raise exception 'set up this school''s billing account first';
  end if;
  if p_days is null or p_days not between 14 and 30 then
    raise exception 'grace is 14 to 30 days';
  end if;
  select s.code into school_code from lms.school s where s.org_id = p_org;
  perform set_config('admin.session', 'on', true);
  update billing.account set grace_days = p_days, updated_at = now(), updated_by = me.user_id where org_id = p_org;
  perform admin.audit(me, 'grace-set', 'school', school_code, p_reason, jsonb_build_object('days', p_days));
end;
$$;

-- ---------------------------------------------------------------------------
-- The daily job (the service role and pg_cron)
-- ---------------------------------------------------------------------------

-- The number of schools whose state changed. A school seen for the first time
-- with no licence is recorded as 'none' without counting as a change.
create or replace function admin.billing_compute_states()
returns integer
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  today date := lms.india_today();
  r record;
  prev text;
  changed integer := 0;
begin
  perform set_config('admin.session', 'on', true);
  for r in select s.org_id, s.code, f.state as now_state
             from lms.school s cross join lateral billing.state_for(s.org_id, today) f
            order by s.code loop
    select ss.state into prev from billing.school_state ss where ss.org_id = r.org_id;
    if prev is null and r.now_state = 'none' then
      insert into billing.school_state (org_id, state, since, checked_on) values (r.org_id, 'none', today, today);
    elsif prev is distinct from r.now_state then
      insert into billing.school_state (org_id, state, since, checked_on) values (r.org_id, r.now_state, today, today)
      on conflict (org_id) do update set state = excluded.state, since = excluded.since, checked_on = excluded.checked_on;
      perform admin.audit_service('billing-state-changed', 'school', r.code, '',
        jsonb_build_object('from', coalesce(prev, 'none'), 'to', r.now_state));
      changed := changed + 1;
    else
      update billing.school_state set checked_on = today where org_id = r.org_id;
    end if;
  end loop;
  delete from billing.webhook_event where not signature_ok and received_at < now() - interval '90 days';
  return changed;
end;
$$;

-- 18:40 UTC is 00:10 in India.
select cron.schedule('billing-states', '40 18 * * *', $job$ select admin.billing_compute_states(); $job$);

-- ---------------------------------------------------------------------------
-- The billing pages' reads: owner, ops and finance
-- ---------------------------------------------------------------------------

-- Counts and sums only; no school is named. Collected is the counted
-- payments received this calendar month in India. Suspended counts suspended
-- and ended schools (both have the tutor off). Renewals count licences other
-- than pilots whose last day is within 30, 60 or 90 days from today.
-- linksUnrecorded counts links Cashfree says were paid beyond the payments
-- stored for them (ruling R26). The two "minutes ago" are null when it has
-- never happened.
create or replace function admin.billing_overview()
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
  today date := lms.india_today();
  reconciled timestamptz;
  last_webhook timestamptz;
begin
  select billing.ts_or_null(s.value #>> '{}') into reconciled from admin.setting s where s.key = 'billing_reconciled_at';
  select max(w.received_at) into last_webhook from billing.webhook_event w where w.signature_ok;
  return jsonb_build_object(
    'collectedThisMonthPaise', (select coalesce(sum(p.amount_paise), 0) from billing.payment p
                                 where p.counted and p.received_on >= date_trunc('month', today)::date),
    'outstandingPaise', (select coalesce(sum(i.total_paise - i.paid_paise), 0) from billing.invoice i
                          where i.status in ('unpaid', 'partly_paid')),
    'overdue', (select jsonb_build_object('count', count(*), 'paise', coalesce(sum(i.total_paise - i.paid_paise), 0))
                  from billing.invoice i where i.status in ('unpaid', 'partly_paid') and i.due_on < today),
    'renewals', (select jsonb_build_object(
                          'in30', count(*) filter (where l.valid_until <= today + 30),
                          'in60', count(*) filter (where l.valid_until <= today + 60),
                          'in90', count(*))
                   from lms.licence l where l.plan <> 'pilot' and l.valid_until between today and today + 90),
    'states', (select jsonb_build_object('grace', count(*) filter (where f.state = 'grace'),
                                         'suspended', count(*) filter (where f.state in ('suspended', 'ended')))
                 from lms.school s cross join lateral billing.state_for(s.org_id, today) f),
    'attention', jsonb_build_object(
      'notCounted', (select count(*) from billing.payment p
                      where not p.counted
                        and p.amount_paise > (select coalesce(sum(x.amount_paise), 0) from billing.refund x
                                               where x.payment_id = p.id and x.status in ('requested', 'pending', 'success'))),
      'linksUnrecorded', (select count(*) from billing.payment_link l where billing.link_unrecorded(l.id) > 0),
      'webhookProblems24h', (select count(*) from billing.webhook_event w
                              where w.status in ('mismatch', 'unparsed') and w.received_at > now() - interval '24 hours'),
      'signatureFailures24h', (select count(*) from billing.webhook_event w
                                where not w.signature_ok and w.received_at > now() - interval '24 hours'),
      'lastWebhookMinutesAgo', case when last_webhook is null then null
                                    else floor(extract(epoch from now() - last_webhook) / 60)::int end,
      'reconciledMinutesAgo', case when reconciled is null then null
                                   else floor(extract(epoch from now() - reconciled) / 60)::int end,
      'openLinks', (select count(*) from billing.payment_link l where l.status in ('creating', 'active', 'partly_paid'))));
end;
$$;

-- Every school, with its billing state; no contact name, email or phone.
create or replace function admin.billing_accounts()
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
  today date := lms.india_today();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'orgId', s.org_id, 'code', s.code, 'name', s.display_name,
             'hasAccount', exists (select 1 from billing.account a where a.org_id = s.org_id),
             'state', f.state,
             'licenceUntil', (select to_char(l.valid_until, 'YYYY-MM-DD') from lms.licence l where l.org_id = s.org_id),
             'outstandingPaise', (select coalesce(sum(i.total_paise - i.paid_paise), 0) from billing.invoice i
                                   where i.org_id = s.org_id and i.status in ('unpaid', 'partly_paid')),
             'overdueDays', coalesce((select today - min(i.due_on) from billing.invoice i
                                       where i.org_id = s.org_id and i.status in ('unpaid', 'partly_paid')
                                         and i.due_on < today), 0))
           order by s.code)
      from lms.school s cross join lateral billing.state_for(s.org_id, today) f), '[]'::jsonb);
end;
$$;

-- One school's billing page. Its billing contact is shown in full here, one
-- record at a time, and in no list.
create or replace function admin.billing_school(p_org uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
  sch lms.school;
  acc billing.account;
  lic lms.licence;
  st record;
begin
  select * into sch from lms.school where org_id = p_org;
  if sch.org_id is null then
    raise exception 'there is no such school';
  end if;
  select * into acc from billing.account where org_id = p_org;
  select * into lic from lms.licence where org_id = p_org;
  select * into st from billing.state_for(p_org, lms.india_today());
  return jsonb_build_object(
    'school', jsonb_build_object('orgId', sch.org_id, 'code', sch.code, 'name', sch.display_name),
    'account', case when acc.org_id is null then null else jsonb_build_object(
        'legalName', acc.legal_name, 'gstin', acc.gstin, 'stateCode', acc.state_code, 'address', acc.address,
        'contactName', acc.contact_name, 'contactEmail', acc.contact_email, 'contactPhone', acc.contact_phone,
        'graceDays', acc.grace_days, 'updatedAt', acc.updated_at) end,
    'state', jsonb_build_object('state', st.state, 'graceUntil', to_char(st.grace_until, 'YYYY-MM-DD')),
    'licence', case when lic.org_id is null then null else jsonb_build_object(
        'plan', lic.plan, 'seats', lic.seats, 'seatsUsed', lms.seats_used(p_org),
        'validUntil', to_char(lic.valid_until, 'YYYY-MM-DD')) end,
    'subscriptions', admin.billing_subscriptions(p_org),
    'invoices', admin.billing_invoices(p_org, null),
    'payments', admin.billing_payments(p_org),
    'signal', billing.payment_signal_on(p_org, lms.india_today()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function billing.state_for(uuid, date) from public, anon, authenticated, service_role;

revoke all on function admin.billing_grace_set(uuid, integer, text, text) from public, anon;
revoke all on function admin.billing_overview() from public, anon;
revoke all on function admin.billing_accounts() from public, anon;
revoke all on function admin.billing_school(uuid) from public, anon;
grant execute on function admin.billing_grace_set(uuid, integer, text, text) to authenticated;
grant execute on function admin.billing_overview() to authenticated;
grant execute on function admin.billing_accounts() to authenticated;
grant execute on function admin.billing_school(uuid) to authenticated;

revoke all on function admin.billing_compute_states() from public, anon, authenticated;
grant execute on function admin.billing_compute_states() to service_role;
