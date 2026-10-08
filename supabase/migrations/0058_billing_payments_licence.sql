-- MONEY IN BY HAND, SETTLING, THE LICENCE FOLLOWS THE MONEY, CORRECTING A
-- PAYMENT BY HAND, VOID, AND THE PAYMENT SIGNAL.
--
-- 1. An offline payment (a bank transfer or a cheque) is recorded by finance
--    or the owner with a fresh authenticator code, because it can set a
--    licence (ruling R8). It is counted at once; its reference (a UTR or a
--    cheque number) is kept on the payment and only its SHA-256 goes into the
--    audit log. It is never recorded while the invoice has an open payment
--    link: billing-api's /record cancels the link at Cashfree first (R27).
-- 2. Settling: an invoice's paid amount is the sum of its counted payments,
--    less any the owner reversed; its status follows (unpaid, partly_paid,
--    paid), and 0057's guard holds both to that sum. The day it becomes paid
--    is India's day.
-- 3. The licence follows the money: when a subscription invoice becomes paid,
--    lms.set_licence (0041) sets the school's plan, seats and last day, in the
--    name of whoever recorded the payment. A payment for an older period never
--    shortens a licence that already runs later ('licence-kept'). Nothing else
--    in billing sets a licence; a refund or a reversal never changes one
--    (rulings R18, R28).
-- 4. Correcting: the owner, with a fresh code, reverses a payment by hand
--    recorded by mistake (R28); it stays listed and stops counting.
-- 5. Void: the owner's, with a fresh code, only while no money is kept on the
--    invoice (nothing paid, or all of it refunded with Cashfree's SUCCESS or
--    reversed) and no refund on it is unfinished, and only once every open
--    payment link is cancelled (billing-api cancels it at Cashfree first).
--    The number stays used; the subscription is cancelled; credit notes stand.
-- 6. The payment signal (spec section 9) for the school page's health card:
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

-- Recomputes an invoice from its counted payments, less any reversed; sets
-- the licence when a subscription invoice has just become paid. An invoice
-- that stops being paid (a reversal) loses its paid day.
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
  paid := billing.counted_paise(p_invoice);
  next_status := case when paid >= inv.total_paise then 'paid' when paid > 0 then 'partly_paid' else 'unpaid' end;
  perform set_config('admin.session', 'on', true);
  update billing.invoice
     set paid_paise = paid, status = next_status,
         paid_on = case when next_status <> 'paid' then null when inv.status = 'paid' then paid_on else lms.india_today() end
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

-- Never while the invoice has an open payment link, so a school cannot pay
-- the same money twice (once by hand, once through the link): billing-api's
-- /record asks with p_commit false, which makes every check below and
-- answers the open links, cancels them at Cashfree, then asks again with
-- p_commit true (ruling R27). The console calls it directly, with p_commit
-- left true, when the invoice has no open link.
create or replace function admin.billing_payment_record(p_invoice uuid, p_source text, p_amount_paise bigint,
  p_received_on date, p_reference text, p_reason text, p_env text, p_commit boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['finance']);
  ref text := btrim(coalesce(p_reference, ''));
  inv billing.invoice;
  open_links text[];
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
  if billing.unrecorded_paise(inv.id) > 0 then
    raise exception 'Cashfree reports money on this invoice''s payment link that is not recorded yet; check with Cashfree first';
  end if;
  if exists (select 1 from billing.payment p
              where p.invoice_id = inv.id and p.source = p_source and p.reference = ref and p.reversed_at is null) then
    raise exception 'this reference is already recorded for this invoice';
  end if;
  select array_agg(l.link_id order by l.attempt) into open_links
    from billing.payment_link l
   where l.invoice_id = inv.id and l.status in ('creating', 'active', 'partly_paid');
  if not coalesce(p_commit, true) then
    return jsonb_build_object('openLinks', to_jsonb(coalesce(open_links, '{}'::text[])), 'recorded', false);
  end if;
  if coalesce(array_length(open_links, 1), 0) > 0 then
    raise exception 'this invoice''s payment link is still open: record the payment from the invoice again, which cancels the link at Cashfree first';
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
-- six months (180 days), with something left to refund. It is reversible
-- (by the owner, admin.billing_payment_reverse) when it was recorded by hand,
-- is not reversed yet and its invoice is not void.
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
                               and p.amount_paise > rf.paise,
                 'reversedAt', p.reversed_at, 'reversedAs', p.reversed_as,
                 'reversible', p.source <> 'cashfree_link' and p.reversed_at is null
                               and coalesce(i.status, 'void') <> 'void') as j
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
-- Correcting a payment by hand: the owner, with a fresh code (ruling R28)
-- ---------------------------------------------------------------------------

-- A bank transfer or cheque recorded by mistake (the wrong invoice, the wrong
-- amount, a cheque that bounced) is reversed, never edited or deleted: the
-- payment stays listed, marked reversed in the owner's name, and no longer
-- counts; the invoice's paid amount and status are worked out again. No
-- money moves here. A licence the payment set stays as it is (licenceStays
-- says so; the owner changes it on the school's page, as after a refund,
-- R18). Once reversed, the same reference can be recorded again.
create or replace function admin.billing_payment_reverse(p_payment uuid, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  pay billing.payment;
  inv billing.invoice;
  r jsonb;
  licence_stays boolean;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  select * into pay from billing.payment where id = p_payment;
  if pay.id is null then
    raise exception 'there is no such payment';
  end if;
  if pay.source = 'cashfree_link' then
    raise exception 'only a payment recorded by hand is reversed; a payment through Cashfree is refunded';
  end if;
  -- The invoice first, as recording a payment does, then the payment.
  select * into inv from billing.invoice where id = pay.invoice_id for update;
  select * into pay from billing.payment where id = p_payment for update;
  if pay.reversed_at is not null then
    raise exception 'this payment is already reversed';
  end if;
  if inv.status = 'void' then
    raise exception 'this invoice is void';
  end if;
  perform set_config('admin.session', 'on', true);
  update billing.payment set reversed_at = now(), reversed_by = me.user_id, reversed_as = me.display_name where id = pay.id;
  r := billing.settle(inv.id, me.user_id, me.role, me.display_name);
  licence_stays := inv.status = 'paid' and r ->> 'status' <> 'paid'
                   and exists (select 1 from billing.subscription s
                                where s.id = inv.subscription_id and s.licence_applied_at is not null);
  perform admin.audit(me, 'payment-reversed', 'invoice', inv.number, p_reason,
    jsonb_build_object('paymentId', pay.id, 'amountPaise', pay.amount_paise, 'source', pay.source,
                       'referenceSha256', encode(sha256(convert_to(pay.reference, 'utf8')), 'hex'),
                       'invoiceStatus', r ->> 'status', 'licenceStays', licence_stays));
  return jsonb_build_object('invoiceStatus', r ->> 'status',
                            'paidPaise', (select i.paid_paise from billing.invoice i where i.id = inv.id),
                            'licenceStays', licence_stays);
end;
$$;

-- ---------------------------------------------------------------------------
-- Void: the owner, with a fresh code, only while no money is kept on the
-- invoice: nothing paid, or every payment through Cashfree refunded in full
-- (Cashfree reported SUCCESS) and every payment by hand reversed. p_commit
-- false only reports the open links billing-api must cancel at Cashfree first.
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
  refunded bigint;
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
  if exists (select 1 from billing.refund r join billing.payment p on p.id = r.payment_id
              where p.invoice_id = inv.id and r.status in ('requested', 'pending')) then
    raise exception 'a refund on this invoice is not finished yet: void it once Cashfree reports it';
  end if;
  refunded := billing.refunded_paise(inv.id);
  if inv.paid_paise > refunded then
    raise exception 'an invoice with money on it cannot be void: refund what came through Cashfree, or reverse what was recorded by hand, first';
  end if;
  if billing.unrecorded_paise(inv.id) > 0 then
    raise exception 'Cashfree reports money on this invoice''s payment link that is not recorded yet; check with Cashfree first';
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
    jsonb_build_object('number', inv.number, 'totalPaise', inv.total_paise, 'refundedPaise', refunded));
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

revoke all on function admin.billing_payment_record(uuid, text, bigint, date, text, text, text, boolean) from public, anon;
revoke all on function admin.billing_payments(uuid) from public, anon;
revoke all on function admin.billing_payment_reverse(uuid, text, text) from public, anon;
revoke all on function admin.billing_invoice_void(uuid, text, text, boolean) from public, anon;

grant execute on function admin.billing_payment_record(uuid, text, bigint, date, text, text, text, boolean) to authenticated;
grant execute on function admin.billing_payments(uuid) to authenticated;
grant execute on function admin.billing_payment_reverse(uuid, text, text) to authenticated;
grant execute on function admin.billing_invoice_void(uuid, text, text, boolean) to authenticated;
