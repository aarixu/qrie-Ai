-- MONEY IN BY HAND, SETTLING, THE LICENCE FOLLOWS THE MONEY, VOID, AND THE
-- PAYMENT SIGNAL.
--
-- 1. An offline payment (a bank transfer or a cheque) is recorded by finance
--    or the owner with a fresh authenticator code, because it can set a
--    licence (ruling R8). It is counted at once; its reference (a UTR or a
--    cheque number) is kept on the payment and only its SHA-256 goes into the
--    audit log.
-- 2. Settling: an invoice's paid amount is the sum of its counted payments;
--    its status moves unpaid -> partly_paid -> paid and never back (0057's
--    guard). The day it becomes paid is India's day.
-- 3. The licence follows the money: when a subscription invoice becomes paid,
--    lms.set_licence (0041) sets the school's plan, seats and last day, in the
--    name of whoever recorded the payment. A payment for an older period never
--    shortens a licence that already runs later ('licence-kept'). Nothing else
--    in billing sets a licence; a refund never changes one (ruling R18).
-- 4. Void: the owner's, with a fresh code, only while nothing is paid, and
--    only once every open payment link is cancelled (billing-api cancels it
--    at Cashfree first). The number stays used; the subscription is cancelled.
-- 5. The payment signal (spec section 9) for the school page's health card:
--    grey with no billing account, green when nothing is overdue, amber 1 to
--    14 days overdue, red after 14. A failed mandate is plan 7's (no mandate
--    exists yet). admin.school_payment_signal is seam S1: the same signature
--    and grants as plan 2's stub, callable only by other definer functions.

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

-- An audit row in someone's name: a staff member's, or Cashfree's (actor null,
-- role 'service', name 'Cashfree') when the money came through a webhook.
create or replace function billing.audit_as(p_actor uuid, p_role text, p_name text, p_action text, p_kind text,
  p_id text, p_reason text, p_details jsonb)
returns void
language sql volatile
set search_path = admin, public
as $$
  insert into admin.audit_event (actor, actor_role, actor_name, action, target_kind, target_id, reason, details, environment)
  values (p_actor, p_role, p_name, p_action, coalesce(p_kind, ''), left(coalesce(p_id, ''), 200),
          left(coalesce(p_reason, ''), 500), coalesce(p_details, '{}'::jsonb), admin.environment());
$$;

-- Sets the school's licence from a paid subscription, unless a later period is
-- already paid. True when the licence was set.
create or replace function billing.apply_licence(p_sub uuid, p_actor uuid, p_role text, p_name text)
returns boolean
language plpgsql volatile
set search_path = admin, billing, lms, public
as $$
declare
  s billing.subscription;
  pl billing.plan;
  school_code text;
  cur date;
begin
  select * into s from billing.subscription where id = p_sub;
  select * into pl from billing.plan where id = s.plan_id;
  select sch.code into school_code from lms.school sch where sch.org_id = s.org_id;
  select l.valid_until into cur from lms.licence l where l.org_id = s.org_id;
  if cur is not null and cur > s.ends_on then
    perform billing.audit_as(p_actor, p_role, p_name, 'licence-kept', 'school', school_code,
      'a later period is already paid',
      jsonb_build_object('subscription', s.id, 'endsOn', to_char(s.ends_on, 'YYYY-MM-DD'),
                         'licenceUntil', to_char(cur, 'YYYY-MM-DD')));
    return false;
  end if;
  perform lms.set_licence(school_code, pl.code, s.seats, s.ends_on);
  perform set_config('admin.session', 'on', true);
  update billing.subscription set licence_applied_at = now() where id = s.id;
  perform billing.audit_as(p_actor, p_role, p_name, 'licence-from-payment', 'school', school_code, 'invoice paid',
    jsonb_build_object('subscription', s.id, 'plan', pl.code, 'seats', s.seats,
                       'validUntil', to_char(s.ends_on, 'YYYY-MM-DD')));
  return true;
end;
$$;

-- Recomputes an invoice from its counted payments; sets the licence when a
-- subscription invoice has just become paid.
create or replace function billing.settle(p_invoice uuid, p_actor uuid, p_role text, p_name text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  inv billing.invoice;
  paid bigint;
  next_status text;
  licence_set boolean := false;
begin
  select * into inv from billing.invoice where id = p_invoice for update;
  if inv.status = 'void' then
    return jsonb_build_object('status', 'void', 'licenceSet', false);
  end if;
  select coalesce(sum(p.amount_paise) filter (where p.counted), 0) into paid
    from billing.payment p where p.invoice_id = p_invoice;
  next_status := case when paid >= inv.total_paise then 'paid' when paid > 0 then 'partly_paid' else 'unpaid' end;
  perform set_config('admin.session', 'on', true);
  update billing.invoice
     set paid_paise = paid, status = next_status,
         paid_on = case when next_status = 'paid' and inv.status <> 'paid' then lms.india_today() else paid_on end
   where id = p_invoice;
  if next_status = 'paid' and inv.status <> 'paid' and inv.subscription_id is not null then
    licence_set := billing.apply_licence(inv.subscription_id, p_actor, p_role, p_name);
  end if;
  return jsonb_build_object('status', next_status, 'licenceSet', licence_set);
end;
$$;

-- Section 9's payment signal on a given day.
create or replace function billing.payment_signal_on(p_org uuid, p_day date)
returns jsonb
language plpgsql stable
set search_path = billing, public
as $$
declare
  days integer;
begin
  if not exists (select 1 from billing.account where org_id = p_org) then
    return jsonb_build_object('level', 'grey', 'reason', 'No billing account yet.');
  end if;
  select p_day - min(i.due_on) into days
    from billing.invoice i
   where i.org_id = p_org and i.status in ('unpaid', 'partly_paid') and i.due_on < p_day;
  if days is null then
    return jsonb_build_object('level', 'green', 'reason', 'Nothing is overdue.');
  end if;
  return jsonb_build_object('level', case when days <= 14 then 'amber' else 'red' end,
                            'reason', format('An invoice is %s day%s overdue.', days, case when days = 1 then '' else 's' end));
end;
$$;

-- ---------------------------------------------------------------------------
-- S1: the school page's payment signal, for India's today
-- ---------------------------------------------------------------------------

create or replace function admin.school_payment_signal(p_org uuid)
returns jsonb
language sql stable security definer
set search_path = admin, billing, lms, public
as $$
  select billing.payment_signal_on(p_org, lms.india_today())
$$;

-- ---------------------------------------------------------------------------
-- Recording a payment by hand: finance or the owner, with a fresh code
-- ---------------------------------------------------------------------------

create or replace function admin.billing_payment_record(p_invoice uuid, p_source text, p_amount_paise bigint,
  p_received_on date, p_reference text, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['finance']);
  ref text := btrim(coalesce(p_reference, ''));
  inv billing.invoice;
  pay_id uuid;
  r jsonb;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  if p_source is null or p_source not in ('bank_transfer', 'cheque') then
    raise exception 'a payment by hand is a bank transfer or a cheque';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'an amount is more than 0 paise';
  end if;
  if p_received_on is null then
    raise exception 'give the day the money was received';
  end if;
  if p_received_on > lms.india_today() then
    raise exception 'a payment cannot be received in the future';
  end if;
  if char_length(ref) not between 1 and 80 then
    raise exception 'give the transfer''s UTR or the cheque number, up to 80 characters';
  end if;
  select * into inv from billing.invoice where id = p_invoice for update;
  if inv.id is null then
    raise exception 'there is no such invoice';
  end if;
  if inv.status = 'void' then
    raise exception 'this invoice is void';
  end if;
  if inv.status = 'paid' then
    raise exception 'this invoice is already paid';
  end if;
  if p_amount_paise > inv.total_paise - inv.paid_paise then
    raise exception 'that is more than the % paise still due', inv.total_paise - inv.paid_paise;
  end if;
  perform set_config('admin.session', 'on', true);
  begin
    insert into billing.payment (org_id, invoice_id, source, amount_paise, currency, received_on, reference, counted,
                                 recorded_by, recorded_as)
    values (inv.org_id, inv.id, p_source, p_amount_paise, 'INR', p_received_on, ref, true, me.user_id, me.display_name)
    returning id into pay_id;
  exception when unique_violation then
    raise exception 'this reference is already recorded for this invoice';
  end;
  r := billing.settle(inv.id, me.user_id, me.role, me.display_name);
  perform admin.audit(me, 'payment-recorded', 'invoice', inv.number, p_reason,
    jsonb_build_object('amountPaise', p_amount_paise, 'source', p_source,
                       'referenceSha256', encode(sha256(convert_to(ref, 'utf8')), 'hex'),
                       'invoiceStatus', r ->> 'status'));
  return jsonb_build_object('paymentId', pay_id, 'invoiceStatus', r ->> 'status',
                            'licenceSet', (r ->> 'licenceSet')::boolean);
end;
$$;

-- ---------------------------------------------------------------------------
-- The payments list: owner, ops and finance
-- ---------------------------------------------------------------------------

-- refundedPaise counts refunds asked for, pending or done. A payment is
-- refundable here only when it came through a Cashfree link, within Cashfree's
-- six months (180 days), with something left to refund.
create or replace function admin.billing_payments(p_org uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
begin
  return coalesce((
    select jsonb_agg(r.j order by r.created_at desc, r.id)
      from (
        select p.created_at, p.id,
               jsonb_build_object(
                 'id', p.id, 'orgId', p.org_id, 'schoolCode', sch.code, 'invoiceId', p.invoice_id,
                 'invoiceNumber', i.number, 'source', p.source, 'amountPaise', p.amount_paise,
                 'receivedOn', to_char(p.received_on, 'YYYY-MM-DD'), 'reference', p.reference,
                 'counted', p.counted, 'notCountedWhy', p.not_counted_why, 'recordedAs', p.recorded_as,
                 'refundedPaise', rf.paise,
                 'refundable', p.source = 'cashfree_link' and p.received_on >= lms.india_today() - 180
                               and p.amount_paise > rf.paise) as j
          from billing.payment p
          join lms.school sch on sch.org_id = p.org_id
          left join billing.invoice i on i.id = p.invoice_id
          cross join lateral (
            select coalesce(sum(x.amount_paise), 0)::bigint as paise
              from billing.refund x
             where x.payment_id = p.id and x.status in ('requested', 'pending', 'success')
          ) rf
         where p_org is null or p.org_id = p_org
         order by p.created_at desc, p.id
         limit 500
      ) r), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Void: the owner, with a fresh code. p_commit false only reports the open
-- links billing-api must cancel at Cashfree first.
-- ---------------------------------------------------------------------------

create or replace function admin.billing_invoice_void(p_invoice uuid, p_reason text, p_env text, p_commit boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  inv billing.invoice;
  open_links text[];
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  select * into inv from billing.invoice where id = p_invoice for update;
  if inv.id is null then
    raise exception 'there is no such invoice';
  end if;
  if inv.status = 'void' then
    raise exception 'this invoice is already void';
  end if;
  if inv.paid_paise > 0 then
    raise exception 'an invoice with money on it cannot be void';
  end if;
  select array_agg(l.link_id order by l.attempt) into open_links
    from billing.payment_link l
   where l.invoice_id = inv.id and l.status in ('creating', 'active', 'partly_paid');
  if not coalesce(p_commit, false) then
    return jsonb_build_object('openLinks', to_jsonb(coalesce(open_links, '{}'::text[])), 'voided', false);
  end if;
  if coalesce(array_length(open_links, 1), 0) > 0 then
    raise exception 'cancel the payment link first';
  end if;
  perform set_config('admin.session', 'on', true);
  update billing.invoice set status = 'void', voided_at = now() where id = inv.id;
  if inv.subscription_id is not null then
    update billing.subscription set cancelled_at = now() where id = inv.subscription_id;
  end if;
  perform admin.audit(me, 'invoice-voided', 'invoice', inv.number, p_reason,
    jsonb_build_object('number', inv.number, 'totalPaise', inv.total_paise));
  return jsonb_build_object('openLinks', '[]'::jsonb, 'voided', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function billing.audit_as(uuid, text, text, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function billing.apply_licence(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function billing.settle(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function billing.payment_signal_on(uuid, date) from public, anon, authenticated, service_role;

-- S1: internal, reached only by other definer functions (plan 2's school_health).
revoke all on function admin.school_payment_signal(uuid) from public, anon, authenticated;

revoke all on function admin.billing_payment_record(uuid, text, bigint, date, text, text, text) from public, anon;
revoke all on function admin.billing_payments(uuid) from public, anon;
revoke all on function admin.billing_invoice_void(uuid, text, text, boolean) from public, anon;

grant execute on function admin.billing_payment_record(uuid, text, bigint, date, text, text, text) to authenticated;
grant execute on function admin.billing_payments(uuid) to authenticated;
grant execute on function admin.billing_invoice_void(uuid, text, text, boolean) to authenticated;
