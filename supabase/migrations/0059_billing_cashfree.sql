-- CASHFREE'S SIDE, IN THE DATABASE: PAYMENT LINKS, WEBHOOK EVENTS, REFUNDS AND
-- CREDIT NOTES, AND THE HOURLY RECONCILIATION'S BOOKKEEPING.
--
-- Two Edge Functions hold Cashfree's keys (tools/billing, supabase/functions):
-- billing-api, the only caller of Cashfree, and cashfree-webhook. Neither
-- decides anything here: billing-api asks the database as the staff member
-- (admin.billing_link_prepare, admin.billing_refund_prepare, the void in
-- 0058) and records what Cashfree answered through the service-role-only
-- functions below; cashfree-webhook checks Cashfree's signature on the raw
-- body and hands a whitelisted extract to admin.billing_webhook_ingest.
--
-- 1. LINKS. One open link per invoice. Its id is the invoice number with '/'
--    turned into '-', plus '-<attempt>' from the second attempt on (ruling
--    R2). It is for the amount still due, never partial, and expires 30 days
--    after the later of the due day and today, at 23:59:59 India time.
-- 2. EVENTS. Stored once by their key (Cashfree's x-idempotency-key, else the
--    body's SHA-256), keeping only the fields billing uses: never the
--    customer's details. A link only moves forward (creating, then active or
--    failed, then partly paid, then expired or cancelled, then paid), so an
--    event that arrives late changes nothing. A payment through a link counts
--    only when its order's amount equals the link's amount, its currency is
--    INR, its notes name the same invoice, and it is not more than is still
--    due (ruling R13); any other is stored uncounted with its reason and
--    listed for a refund. Each order is a payment once, whatever the key.
-- 3. REFUNDS. The owner's, with a fresh code, of a payment that came through
--    a link, within Cashfree's six months, of at most what is left. A refund
--    only moves forward (requested, pending, then success or failed). On
--    success a credit note QRCN/<fy>/<n> carries the refund's share of the
--    invoice's tax, half-up. A refund never changes the invoice's paid amount
--    or the licence (ruling R18).
-- 4. RECONCILIATION. billing-api's /reconcile asks billing_reconcile_due,
--    which answers due at most once in 55 minutes (ruling R15) with the open
--    links and unfinished refunds to check, and billing_reconcile_done
--    records when it finished and three counts.

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

-- A whole number of paise from text, or null for anything else.
create or replace function billing.int_or_null(p_text text) returns bigint language sql immutable as $$
  select case when p_text ~ '^-?[0-9]{1,15}$' then p_text::bigint end
$$;

-- A timestamp from text, or null when it does not read as one.
create or replace function billing.ts_or_null(p_text text) returns timestamptz language plpgsql stable as $$
begin
  return p_text::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function billing.link_rank(p_status text) returns integer language sql immutable as $$
  select case p_status when 'creating' then 0 when 'active' then 1 when 'failed' then 1 when 'partly_paid' then 2
                       when 'expired' then 3 when 'cancelled' then 3 when 'paid' then 4 else -1 end
$$;

-- Cashfree's link_status as billing writes it; null for anything else.
create or replace function billing.link_status_of(p_cf text) returns text language sql immutable as $$
  select case upper(coalesce(p_cf, '')) when 'ACTIVE' then 'active' when 'PARTIALLY_PAID' then 'partly_paid'
                                         when 'PAID' then 'paid' when 'EXPIRED' then 'expired'
                                         when 'CANCELLED' then 'cancelled' end
$$;

-- Moves a link forward only. True when its status or paid amount changed.
create or replace function billing.advance_link(p_link uuid, p_status text, p_amount_paid bigint)
returns boolean
language plpgsql volatile
set search_path = admin, billing, public
as $$
declare
  l billing.payment_link;
  next_status text;
  next_paid bigint;
begin
  select * into l from billing.payment_link where id = p_link for update;
  next_status := case when p_status is not null and billing.link_rank(p_status) > billing.link_rank(l.status)
                      then p_status else l.status end;
  next_paid := greatest(l.amount_paid_paise, coalesce(p_amount_paid, 0));
  perform set_config('admin.session', 'on', true);
  update billing.payment_link
     set status = next_status, amount_paid_paise = next_paid, updated_at = now(), last_checked_at = now()
   where id = p_link;
  return next_status <> l.status or next_paid <> l.amount_paid_paise;
end;
$$;

-- One paid order of a link. Answers 'counted', 'duplicate', or why it was
-- stored without counting.
create or replace function billing.apply_link_payment(p_link uuid, p_order_id text, p_amount bigint, p_currency text,
  p_reference text, p_received_on date, p_notes jsonb)
returns text
language plpgsql volatile
set search_path = admin, billing, lms, public
as $$
declare
  l billing.payment_link;
  inv billing.invoice;
  why text;
  ref text;
begin
  select * into l from billing.payment_link where id = p_link;
  select * into inv from billing.invoice where id = l.invoice_id for update;
  if coalesce(btrim(p_order_id), '') = '' then
    return 'the order has no id';
  end if;
  if p_amount is null or p_amount <= 0 then
    return 'the amount is not a positive number of paise';
  end if;
  if exists (select 1 from billing.payment where cf_order_id = p_order_id) then
    return 'duplicate';
  end if;
  why := case
    when inv.status = 'void' then 'the invoice was void'
    when coalesce(p_currency, '') <> 'INR' then 'the currency is not INR'
    when p_amount <> l.amount_paise then 'the amount is not the link''s amount'
    when p_notes ? 'invoice' and p_notes ->> 'invoice' is distinct from inv.number then 'the notes name another invoice'
    when p_amount > inv.total_paise - inv.paid_paise then 'more than is still due'
  end;
  ref := left(coalesce(nullif(btrim(p_reference), ''), p_order_id), 80);
  perform set_config('admin.session', 'on', true);
  begin
    insert into billing.payment (org_id, invoice_id, link_id, source, amount_paise, currency, received_on, reference,
                                 cf_order_id, counted, not_counted_why, recorded_as)
    values (inv.org_id, inv.id, l.id, 'cashfree_link', p_amount,
            case when p_currency ~ '^[A-Z]{3}$' then p_currency else 'XXX' end,
            coalesce(p_received_on, lms.india_today()), ref, p_order_id, why is null, why, 'Cashfree');
  exception when unique_violation then
    return 'duplicate';
  end;
  if why is null then
    perform billing.settle(inv.id, null, 'service', 'Cashfree');
  end if;
  perform billing.audit_as(null, 'service', 'Cashfree',
    case when why is null then 'payment-received' else 'payment-not-counted' end, 'invoice', inv.number, '',
    jsonb_strip_nulls(jsonb_build_object('invoice', inv.number, 'amountPaise', p_amount, 'why', why)));
  return coalesce(why, 'counted');
end;
$$;

-- A payment-link event (the extract's shape). Its status and detail for the
-- webhook log.
create or replace function billing.apply_link_event(p_value jsonb)
returns table (status text, detail text)
language plpgsql volatile
set search_path = admin, billing, lms, public
as $$
declare
  lk jsonb := p_value -> 'link';
  o jsonb := p_value -> 'order';
  l billing.payment_link;
  r text;
  odd text;
begin
  select * into l from billing.payment_link pl where pl.link_id = lk ->> 'linkId' for update;
  if l.id is null then
    return query select 'ignored'::text, 'No invoice has this link.'::text;
    return;
  end if;
  if jsonb_typeof(o) = 'object' and o ->> 'transactionStatus' = 'SUCCESS' then
    r := billing.apply_link_payment(l.id, o ->> 'orderId', billing.int_or_null(o ->> 'amountPaise'), lk ->> 'currency',
           o ->> 'transactionId',
           (billing.ts_or_null(p_value ->> 'eventTime') at time zone 'Asia/Kolkata')::date, lk -> 'notes');
  end if;
  if billing.int_or_null(lk ->> 'amountPaise') is distinct from l.amount_paise and lk ? 'amountPaise' then
    odd := 'the link''s amount is not the one Qrie asked for';
  end if;
  perform billing.advance_link(l.id, billing.link_status_of(lk ->> 'status'), billing.int_or_null(lk ->> 'amountPaidPaise'));
  if r is not null and r not in ('counted', 'duplicate') then
    return query select 'mismatch'::text, r;
  elsif odd is not null then
    return query select 'mismatch'::text, odd;
  else
    return query select 'processed'::text, null::text;
  end if;
end;
$$;

-- The refund's next status. Issues the credit note on success.
create or replace function billing.issue_credit_note(p_refund uuid)
returns text
language plpgsql volatile
set search_path = admin, billing, lms, public
as $$
declare
  existing text;
  rf billing.refund;
  pay billing.payment;
  inv billing.invoice;
  fy text;
  n integer;
  tax bigint;
  num text;
begin
  select c.number into existing from billing.credit_note c where c.refund_id = p_refund;
  if existing is not null then
    return existing;
  end if;
  select * into rf from billing.refund where id = p_refund;
  select * into pay from billing.payment where id = rf.payment_id;
  select * into inv from billing.invoice where id = pay.invoice_id;
  -- The refund's share of the invoice's tax, half-up in whole paise.
  tax := round(rf.amount_paise::numeric * (inv.cgst_paise + inv.sgst_paise + inv.igst_paise) / inv.total_paise)::bigint;
  fy := billing.fy_of(lms.india_today());
  perform set_config('admin.session', 'on', true);
  n := billing.next_number('credit_note', fy);
  num := billing.format_number('credit_note', fy, n);
  insert into billing.credit_note (number, fy, seq, invoice_id, refund_id, amount_paise, taxable_paise, tax_paise, issued_on)
  values (num, fy, n, inv.id, rf.id, rf.amount_paise, rf.amount_paise - tax, tax, lms.india_today());
  return num;
end;
$$;

create or replace function billing.apply_refund_status(p_refund_id text, p_status text, p_cf_refund_id text, p_detail text)
returns text
language plpgsql volatile
set search_path = admin, billing, lms, public
as $$
declare
  rf billing.refund;
  pay billing.payment;
  mapped text;
begin
  select * into rf from billing.refund where refund_id = p_refund_id for update;
  if rf.id is null then
    return null;
  end if;
  mapped := case upper(coalesce(p_status, ''))
              when 'SUCCESS' then 'success'
              when 'PENDING' then 'pending' when 'PENDING_APPROVAL' then 'pending' when 'ONHOLD' then 'pending'
              when 'CANCELLED' then 'failed' when 'REJECTED' then 'failed' when 'FAILED' then 'failed' end;
  if mapped is null
     or (case mapped when 'pending' then 1 else 2 end) <= (case rf.status when 'requested' then 0 when 'pending' then 1 else 2 end) then
    return rf.status;
  end if;
  perform set_config('admin.session', 'on', true);
  update billing.refund
     set status = mapped, cf_refund_id = coalesce(left(p_cf_refund_id, 40), cf_refund_id),
         detail = coalesce(left(p_detail, 200), detail), updated_at = now()
   where id = rf.id;
  if mapped = 'success' then
    select * into pay from billing.payment where id = rf.payment_id;
    if pay.counted and pay.invoice_id is not null then
      perform billing.issue_credit_note(rf.id);
    end if;
  end if;
  perform billing.audit_as(null, 'service', 'Cashfree', 'refund-' || mapped, 'payment', rf.payment_id::text, '',
    jsonb_build_object('refundId', rf.refund_id, 'amountPaise', rf.amount_paise));
  return mapped;
end;
$$;

-- ---------------------------------------------------------------------------
-- Links: prepared by ops (and the owner); recorded by the service role
-- ---------------------------------------------------------------------------

create or replace function admin.billing_link_prepare(p_invoice uuid, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  inv billing.invoice;
  acc billing.account;
  sch lms.school;
  l billing.payment_link;
  next_attempt integer;
begin
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
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
  select * into acc from billing.account where org_id = inv.org_id;
  if acc.contact_phone is null then
    raise exception 'add the billing contact''s phone first';
  end if;
  select * into sch from lms.school where org_id = inv.org_id;
  select * into l from billing.payment_link pl
   where pl.invoice_id = inv.id and pl.status in ('creating', 'active', 'partly_paid');
  if l.id is not null and l.status <> 'creating' then
    return jsonb_build_object('existing', true, 'linkRowId', l.id, 'linkId', l.link_id, 'url', l.url,
                              'amountPaise', l.amount_paise);
  end if;
  if l.id is null then
    select coalesce(max(pl.attempt), 0) + 1 into next_attempt from billing.payment_link pl where pl.invoice_id = inv.id;
    perform set_config('admin.session', 'on', true);
    insert into billing.payment_link (invoice_id, attempt, link_id, amount_paise, expires_at, created_by)
    values (inv.id, next_attempt,
            replace(inv.number, '/', '-') || case when next_attempt > 1 then '-' || next_attempt else '' end,
            inv.total_paise - inv.paid_paise,
            ((greatest(inv.due_on, lms.india_today()) + 30)::timestamp + time '23:59:59') at time zone 'Asia/Kolkata',
            me.user_id)
    returning * into l;
    perform admin.audit(me, 'link-prepared', 'invoice', inv.number, p_reason,
      jsonb_build_object('linkId', l.link_id, 'amountPaise', l.amount_paise));
  end if;
  -- A row still 'creating' is answered again as it was, so billing-api retries
  -- Cashfree with the same idempotency key (the row's id).
  return jsonb_build_object(
    'existing', false, 'linkRowId', l.id, 'linkId', l.link_id, 'amountPaise', l.amount_paise, 'currency', 'INR',
    'purpose', left(format('Qrie invoice %s for %s', inv.number, sch.display_name), 500),
    'customer', jsonb_build_object('name', acc.contact_name, 'phone', acc.contact_phone, 'email', acc.contact_email),
    'notes', jsonb_build_object('school', sch.code, 'invoice', inv.number),
    'expiresAt', to_char(l.expires_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS"+05:30"'),
    'sendEmail', acc.contact_email is not null);
end;
$$;

-- Cashfree made the link (or one thought lost was found). From 'creating' or
-- 'failed' only; a failed row stays failed when its invoice has another open
-- link.
create or replace function admin.billing_link_created(p_link_id text, p_cf_link_id text, p_url text, p_expires_at timestamptz)
returns void
language plpgsql volatile security definer
set search_path = admin, billing, public
as $$
declare
  l billing.payment_link;
  num text;
begin
  select * into l from billing.payment_link where link_id = p_link_id for update;
  if l.id is null or l.status not in ('creating', 'failed') then
    return;
  end if;
  if l.status = 'failed' and exists (
    select 1 from billing.payment_link o
     where o.invoice_id = l.invoice_id and o.id <> l.id and o.status in ('creating', 'active', 'partly_paid')) then
    return;
  end if;
  select i.number into num from billing.invoice i where i.id = l.invoice_id;
  perform set_config('admin.session', 'on', true);
  update billing.payment_link
     set cf_link_id = left(p_cf_link_id, 40), url = p_url, status = 'active',
         expires_at = coalesce(p_expires_at, expires_at), updated_at = now(), last_checked_at = now()
   where id = l.id;
  perform admin.audit_service('link-created', 'invoice', num, '', jsonb_build_object('linkId', l.link_id));
end;
$$;

create or replace function admin.billing_link_failed(p_link_id text, p_why text)
returns void
language plpgsql volatile security definer
set search_path = admin, billing, public
as $$
declare
  l billing.payment_link;
  num text;
begin
  select * into l from billing.payment_link where link_id = p_link_id for update;
  if l.id is null or l.status <> 'creating' then
    return;
  end if;
  select i.number into num from billing.invoice i where i.id = l.invoice_id;
  perform set_config('admin.session', 'on', true);
  update billing.payment_link set status = 'failed', updated_at = now(), last_checked_at = now() where id = l.id;
  perform admin.audit_service('link-failed', 'invoice', num, left(coalesce(p_why, ''), 200),
    jsonb_build_object('linkId', l.link_id));
end;
$$;

-- What billing-api read from Cashfree for one link: its status, paid amount
-- and paid orders. Each paid order goes through the same rules as a webhook.
create or replace function admin.billing_link_observed(p_link_id text, p_value jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  l billing.payment_link;
  o jsonb;
  r text;
  counted integer := 0;
  mismatched integer := 0;
  changed boolean := false;
begin
  select * into l from billing.payment_link where link_id = p_link_id;
  if l.id is null then
    raise exception 'there is no such link';
  end if;
  perform set_config('admin.session', 'on', true);
  for o in select e from jsonb_array_elements(case when jsonb_typeof(p_value -> 'orders') = 'array'
                                                   then p_value -> 'orders' else '[]'::jsonb end) e loop
    if upper(coalesce(o ->> 'status', '')) = 'PAID' then
      r := billing.apply_link_payment(l.id, o ->> 'orderId', billing.int_or_null(o ->> 'amountPaise'),
             coalesce(o ->> 'currency', p_value ->> 'currency'), null, null, null);
      if r = 'counted' then
        counted := counted + 1;
        changed := true;
      elsif r <> 'duplicate' then
        mismatched := mismatched + 1;
        changed := true;
      end if;
    end if;
  end loop;
  if billing.advance_link(l.id, billing.link_status_of(p_value ->> 'status'), billing.int_or_null(p_value ->> 'amountPaidPaise')) then
    changed := true;
  end if;
  return jsonb_build_object('changed', changed, 'counted', counted, 'mismatched', mismatched);
end;
$$;

-- ---------------------------------------------------------------------------
-- The webhook: stored once, whitelisted, dispatched
-- ---------------------------------------------------------------------------

create or replace function admin.billing_webhook_ingest(p_key text, p_body_sha256 text, p_body_length integer, p_value jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  v jsonb := coalesce(p_value, '{}'::jsonb);
  lk jsonb := case when jsonb_typeof(v -> 'link') = 'object' then v -> 'link' end;
  o jsonb := case when jsonb_typeof(v -> 'order') = 'object' then v -> 'order' end;
  rf jsonb := case when jsonb_typeof(v -> 'refund') = 'object' then v -> 'refund' end;
  kept jsonb;
  ev_id bigint;
  st text;
  det text;
  r text;
begin
  if coalesce(btrim(p_key), '') = '' then
    raise exception 'a webhook event needs a key';
  end if;
  -- Only these fields are kept; anything else in p_value is dropped here.
  kept := jsonb_strip_nulls(jsonb_build_object(
    'type', left(v ->> 'type', 60),
    'eventTime', left(v ->> 'eventTime', 40),
    'unparsed', case when v -> 'unparsed' = 'true'::jsonb then true end,
    'link', case when lk is not null then jsonb_build_object(
        'linkId', left(lk ->> 'linkId', 50), 'cfLinkId', left(lk ->> 'cfLinkId', 40), 'status', left(lk ->> 'status', 30),
        'amountPaise', billing.int_or_null(lk ->> 'amountPaise'),
        'amountPaidPaise', billing.int_or_null(lk ->> 'amountPaidPaise'),
        'currency', left(lk ->> 'currency', 3),
        'notes', case when jsonb_typeof(lk -> 'notes') = 'object' then jsonb_build_object(
            'school', left(lk #>> '{notes,school}', 40), 'invoice', left(lk #>> '{notes,invoice}', 40)) end) end,
    'order', case when o is not null then jsonb_build_object(
        'orderId', left(o ->> 'orderId', 60), 'amountPaise', billing.int_or_null(o ->> 'amountPaise'),
        'transactionId', left(o ->> 'transactionId', 40), 'transactionStatus', left(o ->> 'transactionStatus', 30)) end,
    'refund', case when rf is not null then jsonb_build_object(
        'refundId', left(rf ->> 'refundId', 40), 'cfRefundId', left(rf ->> 'cfRefundId', 40),
        'orderId', left(rf ->> 'orderId', 60), 'status', left(rf ->> 'status', 30),
        'amountPaise', billing.int_or_null(rf ->> 'amountPaise')) end));
  insert into billing.webhook_event (idem_key, body_sha256, body_length, signature_ok, event_type, link_id, order_id,
                                     refund_id, payload, status)
  values (left(p_key, 200), p_body_sha256, coalesce(p_body_length, 0), true, kept ->> 'type', kept #>> '{link,linkId}',
          coalesce(kept #>> '{order,orderId}', kept #>> '{refund,orderId}'), kept #>> '{refund,refundId}', kept, 'stored')
  on conflict (idem_key) do nothing
  returning id into ev_id;
  if ev_id is null then
    return jsonb_build_object('duplicate', true);
  end if;
  if kept -> 'unparsed' = 'true'::jsonb then
    st := 'unparsed';
    det := 'The body was not JSON; the hourly check reads the link instead.';
  elsif kept ->> 'type' = 'PAYMENT_LINK_EVENT' then
    select e.status, e.detail into st, det from billing.apply_link_event(kept) e;
  elsif kept ->> 'type' = 'REFUND_STATUS_WEBHOOK' then
    r := billing.apply_refund_status(kept #>> '{refund,refundId}', kept #>> '{refund,status}',
                                     kept #>> '{refund,cfRefundId}', null);
    if r is null then
      st := 'ignored';
      det := 'No refund has this id.';
    else
      st := 'processed';
    end if;
  else
    st := 'ignored';
    det := 'Not an event billing uses.';
  end if;
  update billing.webhook_event set status = st, detail = det, processed_at = now() where id = ev_id;
  return jsonb_build_object('duplicate', false, 'status', st);
end;
$$;

-- A delivery whose signature did not check out: its hash and length only.
create or replace function admin.billing_signature_failed(p_body_sha256 text, p_body_length integer, p_why text)
returns void
language sql volatile security definer
set search_path = admin, billing, public
as $$
  insert into billing.webhook_event (body_sha256, body_length, signature_ok, status, detail)
  values (p_body_sha256, coalesce(p_body_length, 0), false, 'signature_failed', left(p_why, 200));
$$;

-- ---------------------------------------------------------------------------
-- Refunds: asked for by the owner with a fresh code; recorded by the service role
-- ---------------------------------------------------------------------------

create or replace function admin.billing_refund_prepare(p_payment uuid, p_amount_paise bigint, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  pay billing.payment;
  inv_number text;
  remaining bigint;
  rf billing.refund;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  select * into pay from billing.payment where id = p_payment for update;
  if pay.id is null then
    raise exception 'there is no such payment';
  end if;
  if pay.source <> 'cashfree_link' then
    raise exception 'only a payment made through a Cashfree link can be refunded here';
  end if;
  if pay.received_on < lms.india_today() - 180 then
    raise exception 'Cashfree refunds only within six months of the payment';
  end if;
  select pay.amount_paise - coalesce(sum(x.amount_paise), 0) into remaining
    from billing.refund x
   where x.payment_id = pay.id and x.status in ('requested', 'pending', 'success');
  if p_amount_paise is null or p_amount_paise < 1 or p_amount_paise > remaining then
    raise exception 'at most % paise can still be refunded', remaining;
  end if;
  select i.number into inv_number from billing.invoice i where i.id = pay.invoice_id;
  perform set_config('admin.session', 'on', true);
  insert into billing.refund (payment_id, refund_id, amount_paise, requested_by)
  values (pay.id, 'qrierf' || replace(gen_random_uuid()::text, '-', ''), p_amount_paise, me.user_id)
  returning * into rf;
  perform admin.audit(me, 'refund-requested', 'payment', pay.id::text, p_reason,
    jsonb_build_object('paymentId', pay.id, 'amountPaise', p_amount_paise));
  return jsonb_build_object('refundRowId', rf.id, 'refundId', rf.refund_id, 'orderId', pay.cf_order_id,
                            'amountPaise', rf.amount_paise,
                            'note', 'Refund for ' || coalesce(inv_number, 'a Qrie payment'));
end;
$$;

create or replace function admin.billing_refund_result(p_refund_id text, p_value jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  st text := billing.apply_refund_status(p_refund_id, p_value ->> 'status', p_value ->> 'cfRefundId', p_value ->> 'detail');
begin
  return jsonb_build_object('status', st, 'creditNote',
    (select c.number from billing.credit_note c join billing.refund x on x.id = c.refund_id where x.refund_id = p_refund_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation bookkeeping (the service role)
-- ---------------------------------------------------------------------------

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
               where l.status in ('creating', 'active', 'partly_paid') and l.created_at > now() - interval '180 days'
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

create or replace function admin.billing_reconcile_done(p_value jsonb)
returns void
language plpgsql volatile security definer
set search_path = admin, billing, public
as $$
begin
  insert into admin.setting (key, value) values ('billing_reconciled_at', to_jsonb(now()::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin.audit_service('billing-reconciled', 'billing', 'reconcile', '',
    jsonb_build_object('checked', coalesce(billing.int_or_null(p_value ->> 'checked'), 0),
                       'changed', coalesce(billing.int_or_null(p_value ->> 'changed'), 0),
                       'failed', coalesce(billing.int_or_null(p_value ->> 'failed'), 0)));
end;
$$;

-- ---------------------------------------------------------------------------
-- The webhook log: owner, ops and finance. Never the payload.
-- ---------------------------------------------------------------------------

create or replace function admin.billing_webhook_log(p_problems boolean default false)
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', w.id, 'receivedAt', w.received_at, 'status', w.status,
                                        'detail', w.detail, 'eventType', w.event_type, 'linkId', w.link_id,
                                        'orderId', w.order_id) order by w.received_at desc, w.id desc)
      from (select * from billing.webhook_event e
             where not coalesce(p_problems, false) or e.status in ('signature_failed', 'mismatch', 'unparsed')
             order by e.received_at desc, e.id desc
             limit 200) w), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function billing.int_or_null(text) from public, anon, authenticated, service_role;
revoke all on function billing.ts_or_null(text) from public, anon, authenticated, service_role;
revoke all on function billing.link_rank(text) from public, anon, authenticated, service_role;
revoke all on function billing.link_status_of(text) from public, anon, authenticated, service_role;
revoke all on function billing.advance_link(uuid, text, bigint) from public, anon, authenticated, service_role;
revoke all on function billing.apply_link_payment(uuid, text, bigint, text, text, date, jsonb) from public, anon, authenticated, service_role;
revoke all on function billing.apply_link_event(jsonb) from public, anon, authenticated, service_role;
revoke all on function billing.issue_credit_note(uuid) from public, anon, authenticated, service_role;
revoke all on function billing.apply_refund_status(text, text, text, text) from public, anon, authenticated, service_role;

revoke all on function admin.billing_link_prepare(uuid, text, text) from public, anon;
revoke all on function admin.billing_refund_prepare(uuid, bigint, text, text) from public, anon;
revoke all on function admin.billing_webhook_log(boolean) from public, anon;
grant execute on function admin.billing_link_prepare(uuid, text, text) to authenticated;
grant execute on function admin.billing_refund_prepare(uuid, bigint, text, text) to authenticated;
grant execute on function admin.billing_webhook_log(boolean) to authenticated;

revoke all on function admin.billing_link_created(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function admin.billing_link_failed(text, text) from public, anon, authenticated;
revoke all on function admin.billing_link_observed(text, jsonb) from public, anon, authenticated;
revoke all on function admin.billing_webhook_ingest(text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function admin.billing_signature_failed(text, integer, text) from public, anon, authenticated;
revoke all on function admin.billing_refund_result(text, jsonb) from public, anon, authenticated;
revoke all on function admin.billing_reconcile_due(boolean) from public, anon, authenticated;
revoke all on function admin.billing_reconcile_done(jsonb) from public, anon, authenticated;
grant execute on function admin.billing_link_created(text, text, text, timestamptz) to service_role;
grant execute on function admin.billing_link_failed(text, text) to service_role;
grant execute on function admin.billing_link_observed(text, jsonb) to service_role;
grant execute on function admin.billing_webhook_ingest(text, text, integer, jsonb) to service_role;
grant execute on function admin.billing_signature_failed(text, integer, text) to service_role;
grant execute on function admin.billing_refund_result(text, jsonb) to service_role;
grant execute on function admin.billing_reconcile_due(boolean) to service_role;
grant execute on function admin.billing_reconcile_done(jsonb) to service_role;
