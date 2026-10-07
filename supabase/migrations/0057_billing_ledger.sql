-- THE BILLING LEDGER: WHAT SCHOOLS ARE SOLD, AND QRIE'S OWN NUMBERED INVOICES.
--
-- Schema `billing` holds the seller's details, the plans on sale, each school's
-- billing account, subscriptions, invoices, payment links, payments, refunds,
-- credit notes, the webhook log and each school's billing state. No API role
-- reaches it, the service role included (ruling R21): no USAGE on the schema
-- and no privilege on any table or function. Everything a person or an Edge
-- Function does here goes through a SECURITY DEFINER function in the exposed
-- `admin` schema that checks its caller first.
--
-- Qrie's numbered invoice is the record (spec section 10). Cashfree only
-- collects money against it; an invoice exists whether or not a payment link
-- is ever made for it, and an offline payment is recorded against it the same
-- way a Cashfree one is.
--
-- Numbers: CGST Rule 46(b) asks for "a consecutive serial number not exceeding
-- sixteen characters ... unique for a financial year"
-- (https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html),
-- so invoices are QRIE/26-27/0001 (15 characters) and credit notes
-- QRCN/26-27/0001, one counter per series per Indian financial year (1 April
-- to 31 March, India's day). The counter row is locked by its upsert until
-- the raising transaction ends, and a failed raise rolls its number back.
--
-- An issued invoice is never edited and nothing in billing is ever deleted:
-- triggers refuse both, even for hand-written SQL by the database owner. An
-- invoice's status and paid amount only move forward. Hand-written changes to
-- any other billing table leave an 'unmanaged-change' row in admin.audit_event
-- (admin.tripwire, 0047).

create schema if not exists billing;
revoke all on schema billing from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists billing.seller (
  id boolean primary key default true check (id),
  legal_name text not null default '' check (char_length(legal_name) <= 120),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code text not null default '' check (state_code = '' or state_code ~ '^[0-9]{2}$'),
  address text not null default '' check (char_length(address) <= 400),
  sac_code text not null default '' check (sac_code = '' or sac_code ~ '^[0-9]{4,8}$'),
  gst_rate_bp integer check (gst_rate_bp is null or gst_rate_bp between 0 and 2800),
  invoice_title text not null default 'Tax invoice' check (char_length(invoice_title) between 1 and 40),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into billing.seller default values on conflict do nothing;

create table if not exists billing.plan (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9-]{0,29}$' and code <> 'pilot'),
  name text not null check (char_length(name) between 1 and 80),
  months integer not null check (months between 1 and 36),
  seat_price_paise bigint not null check (seat_price_paise >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing.account (
  org_id uuid primary key references lms.school (org_id) on delete restrict,
  legal_name text not null check (char_length(legal_name) between 1 and 120),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  address text not null check (char_length(address) between 1 and 400),
  contact_name text not null check (char_length(contact_name) between 1 and 80),
  contact_email text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[6-9][0-9]{9}$'),
  grace_days integer not null default 14 check (grace_days between 14 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists billing.subscription (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references billing.account on delete restrict,
  plan_id uuid not null references billing.plan on delete restrict,
  seats integer not null check (seats between 1 and 100000),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  seat_price_paise bigint not null check (seat_price_paise >= 0),
  -- How it is collected. Plan 7 adds 'mandate' (Cashfree Subscriptions, UPI Autopay).
  collection text not null default 'invoice' check (collection in ('invoice')),
  created_at timestamptz not null default now(),
  created_by uuid,
  licence_applied_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists subscription_org on billing.subscription (org_id, starts_on);

create table if not exists billing.number_counter (
  series text not null check (series in ('invoice', 'credit_note')),
  fy text not null check (fy ~ '^[0-9]{2}-[0-9]{2}$'),
  last_number integer not null check (last_number > 0),
  primary key (series, fy)
);

create table if not exists billing.invoice (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (char_length(number) <= 16),
  fy text not null,
  seq integer not null,
  org_id uuid not null references billing.account on delete restrict,
  subscription_id uuid unique references billing.subscription on delete restrict,
  kind text not null check (kind in ('subscription', 'other')),
  description text not null check (char_length(description) between 1 and 200),
  quantity integer not null check (quantity >= 1),
  unit_paise bigint not null check (unit_paise >= 0),
  taxable_paise bigint not null check (taxable_paise = quantity * unit_paise),
  gst_rate_bp integer not null check (gst_rate_bp between 0 and 2800),
  cgst_paise bigint not null check (cgst_paise >= 0),
  sgst_paise bigint not null check (sgst_paise >= 0),
  igst_paise bigint not null check (igst_paise >= 0),
  total_paise bigint not null check (total_paise > 0 and total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise),
  currency text not null default 'INR' check (currency = 'INR'),
  issued_on date not null,
  due_on date not null check (due_on >= issued_on),
  seller jsonb not null,
  buyer jsonb not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'partly_paid', 'paid', 'void')),
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  paid_on date,
  voided_at timestamptz,
  raised_by uuid,
  created_at timestamptz not null default now(),
  unique (fy, seq),
  check ((kind = 'subscription') = (subscription_id is not null))
);
create index if not exists invoice_org on billing.invoice (org_id, issued_on desc);

create table if not exists billing.payment_link (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references billing.invoice on delete restrict,
  attempt integer not null check (attempt >= 1),
  link_id text not null unique check (link_id ~ '^[A-Za-z0-9_-]{1,50}$'),
  cf_link_id text,
  url text check (url is null or url ~ '^https://'),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'creating'
    check (status in ('creating', 'active', 'partly_paid', 'paid', 'expired', 'cancelled', 'failed')),
  amount_paid_paise bigint not null default 0 check (amount_paid_paise >= 0),
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  unique (invoice_id, attempt)
);
create unique index if not exists payment_link_one_open on billing.payment_link (invoice_id)
  where status in ('creating', 'active', 'partly_paid');

create table if not exists billing.payment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references billing.account on delete restrict,
  invoice_id uuid references billing.invoice on delete restrict,
  link_id uuid references billing.payment_link on delete restrict,
  source text not null check (source in ('cashfree_link', 'bank_transfer', 'cheque')),
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  received_on date not null,
  reference text not null check (char_length(reference) between 1 and 80),
  cf_order_id text unique,
  counted boolean not null,
  not_counted_why text check (not_counted_why is null or char_length(not_counted_why) <= 200),
  recorded_by uuid,
  recorded_as text not null,
  created_at timestamptz not null default now(),
  check (counted = (not_counted_why is null)),
  check ((source = 'cashfree_link') = (cf_order_id is not null))
);
create unique index if not exists payment_offline_once on billing.payment (invoice_id, source, reference)
  where source <> 'cashfree_link';

create table if not exists billing.refund (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references billing.payment on delete restrict,
  refund_id text not null unique check (refund_id ~ '^[A-Za-z0-9]{3,40}$'),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'requested' check (status in ('requested', 'pending', 'success', 'failed')),
  cf_refund_id text,
  detail text check (detail is null or char_length(detail) <= 200),
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing.credit_note (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (char_length(number) <= 16),
  fy text not null,
  seq integer not null,
  invoice_id uuid not null references billing.invoice on delete restrict,
  refund_id uuid not null unique references billing.refund on delete restrict,
  amount_paise bigint not null check (amount_paise > 0),
  taxable_paise bigint not null check (taxable_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0 and taxable_paise + tax_paise = amount_paise),
  issued_on date not null,
  unique (fy, seq)
);

create table if not exists billing.webhook_event (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default clock_timestamp(),
  idem_key text unique,
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  body_length integer not null check (body_length >= 0),
  signature_ok boolean not null,
  event_type text check (event_type is null or char_length(event_type) <= 60),
  link_id text, order_id text, refund_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('stored', 'processed', 'ignored', 'mismatch', 'unparsed', 'signature_failed')),
  detail text check (detail is null or char_length(detail) <= 200),
  processed_at timestamptz,
  check (signature_ok or (idem_key is null and payload = '{}'::jsonb))
);
create index if not exists webhook_event_time on billing.webhook_event (received_at desc);

create table if not exists billing.school_state (
  org_id uuid primary key references lms.school (org_id) on delete cascade,
  state text not null check (state in ('none', 'trial', 'active', 'grace', 'suspended', 'ended')),
  since date not null,
  checked_on date not null
);

-- ---------------------------------------------------------------------------
-- Nobody reaches a table directly; hand edits leave a trace; nothing is deleted
-- ---------------------------------------------------------------------------

create or replace function billing.no_delete() returns trigger language plpgsql as $$
begin
  raise exception 'billing records are never deleted' using errcode = '42501';
end;
$$;

-- A recorded payment and an issued credit note are never edited (the message
-- is the trigger's argument).
create or replace function billing.no_edit() returns trigger language plpgsql as $$
begin
  raise exception '%', tg_argv[0] using errcode = '42501';
end;
$$;

create or replace function billing.invoice_guard() returns trigger language plpgsql as $$
declare
  rank_old integer := case old.status when 'unpaid' then 0 when 'partly_paid' then 1 when 'paid' then 2 else 3 end;
  rank_new integer := case new.status when 'unpaid' then 0 when 'partly_paid' then 1 when 'paid' then 2 else 3 end;
begin
  if (new.number, new.fy, new.seq, new.org_id, new.subscription_id, new.kind, new.description, new.quantity,
      new.unit_paise, new.taxable_paise, new.gst_rate_bp, new.cgst_paise, new.sgst_paise, new.igst_paise,
      new.total_paise, new.currency, new.issued_on, new.due_on, new.seller, new.buyer)
     is distinct from
     (old.number, old.fy, old.seq, old.org_id, old.subscription_id, old.kind, old.description, old.quantity,
      old.unit_paise, old.taxable_paise, old.gst_rate_bp, old.cgst_paise, old.sgst_paise, old.igst_paise,
      old.total_paise, old.currency, old.issued_on, old.due_on, old.seller, old.buyer) then
    raise exception 'an issued invoice is not edited' using errcode = '42501';
  end if;
  if old.status = 'void' then
    raise exception 'a void invoice does not change' using errcode = '42501';
  end if;
  if new.status = 'void' and old.paid_paise > 0 then
    raise exception 'an invoice with money on it cannot be void' using errcode = '42501';
  end if;
  if new.paid_paise < old.paid_paise or (new.status <> 'void' and rank_new < rank_old) then
    raise exception 'an invoice only moves forward' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['seller', 'plan', 'account', 'subscription', 'number_counter', 'invoice', 'payment_link',
                           'payment', 'refund', 'credit_note', 'webhook_event', 'school_state'] loop
    execute format('revoke all on billing.%I from public, anon, authenticated, service_role', t);
    execute format('alter table billing.%I enable row level security', t);
  end loop;
  -- Every table but the webhook log and school_state, which only functions
  -- write and which are rebuilt from Cashfree and the licences respectively.
  foreach t in array array['seller', 'plan', 'account', 'subscription', 'number_counter', 'invoice', 'payment_link',
                           'payment', 'refund', 'credit_note'] loop
    execute format('drop trigger if exists %I on billing.%I', t || '_tripwire', t);
    execute format('create trigger %I after insert or update or delete on billing.%I for each row execute function admin.tripwire()',
                   t || '_tripwire', t);
  end loop;
  foreach t in array array['invoice', 'payment', 'payment_link', 'refund', 'credit_note', 'subscription', 'account', 'plan'] loop
    execute format('drop trigger if exists %I on billing.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on billing.%I for each row execute function billing.no_delete()',
                   t || '_no_delete', t);
    execute format('drop trigger if exists %I on billing.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on billing.%I for each statement execute function billing.no_delete()',
                   t || '_no_truncate', t);
  end loop;
end
$$;

drop trigger if exists invoice_guard on billing.invoice;
create trigger invoice_guard before update on billing.invoice for each row execute function billing.invoice_guard();
drop trigger if exists payment_no_edit on billing.payment;
create trigger payment_no_edit before update on billing.payment
  for each row execute function billing.no_edit('a recorded payment is not edited');
drop trigger if exists credit_note_no_edit on billing.credit_note;
create trigger credit_note_no_edit before update on billing.credit_note
  for each row execute function billing.no_edit('a credit note is not edited');

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

-- '26-27' for any day from 1 April 2026 to 31 March 2027.
create or replace function billing.fy_of(p_day date) returns text language sql immutable as $$
  select case when extract(month from p_day) >= 4
    then to_char(p_day, 'YY') || '-' || to_char(p_day + interval '1 year', 'YY')
    else to_char(p_day - interval '1 year', 'YY') || '-' || to_char(p_day, 'YY') end
$$;

-- Gapless: the counter row is locked by the upsert until the transaction ends,
-- and a transaction that fails rolls its number back with it.
create or replace function billing.next_number(p_series text, p_fy text) returns integer language sql volatile as $$
  insert into billing.number_counter (series, fy, last_number) values (p_series, p_fy, 1)
  on conflict (series, fy) do update set last_number = billing.number_counter.last_number + 1
  returning last_number
$$;

create or replace function billing.format_number(p_series text, p_fy text, p_n integer) returns text language plpgsql immutable as $$
begin
  if p_n > 99999 then
    raise exception 'the % series is full for this year', case p_series when 'invoice' then 'invoice' else 'credit note' end;
  end if;
  return case p_series when 'invoice' then 'QRIE/' else 'QRCN/' end || p_fy || '/' || lpad(p_n::text, 4, '0');
end;
$$;

-- Half-up rounding in whole paise. Inside one state, CGST and SGST are each half
-- the rate; across states, IGST is the whole rate. The CA confirms (Aarav's steps).
create or replace function billing.gst_split(p_taxable bigint, p_rate_bp integer, p_seller_state text, p_buyer_state text,
  out cgst bigint, out sgst bigint, out igst bigint) language sql immutable as $$
  select case when p_seller_state = p_buyer_state then (p_taxable * p_rate_bp + 10000) / 20000 else 0 end,
         case when p_seller_state = p_buyer_state then (p_taxable * p_rate_bp + 10000) / 20000 else 0 end,
         case when p_seller_state = p_buyer_state then 0 else (p_taxable * p_rate_bp + 5000) / 10000 end
$$;

-- Null when invoices can be raised, else what is missing.
create or replace function billing.seller_ready() returns text language plpgsql stable
set search_path = billing, public
as $$
declare
  s billing.seller;
begin
  select * into s from billing.seller where id;
  if s.id is null or s.legal_name = '' or s.state_code = '' or s.address = '' or s.sac_code = '' or s.gst_rate_bp is null then
    return 'set the seller''s details in Billing settings first';
  end if;
  return null;
end;
$$;

-- Every write takes a typed reason.
create or replace function billing.need_reason(p_reason text) returns void language plpgsql immutable as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why, in a few words';
  end if;
end;
$$;

-- One invoice line, numbered now. The seller's and buyer's details are copied
-- onto it as they are today; the buyer's carry no contact name, email or phone.
create or replace function billing.raise_invoice(p_org uuid, p_sub uuid, p_kind text, p_description text,
  p_quantity integer, p_unit bigint, p_due_on date, p_by uuid)
returns billing.invoice
language plpgsql volatile
set search_path = admin, billing, lms, public
as $$
declare
  why text := billing.seller_ready();
  s billing.seller;
  a billing.account;
  sch lms.school;
  taxable bigint;
  g record;
  total bigint;
  today date := lms.india_today();
  fy text;
  n integer;
  inv billing.invoice;
begin
  if why is not null then
    raise exception '%', why;
  end if;
  select * into s from billing.seller where id;
  select * into a from billing.account where org_id = p_org;
  if a.org_id is null then
    raise exception 'set up this school''s billing account first';
  end if;
  select * into sch from lms.school where org_id = p_org;
  taxable := p_quantity::bigint * p_unit;
  select * into g from billing.gst_split(taxable, s.gst_rate_bp, s.state_code, a.state_code);
  total := taxable + g.cgst + g.sgst + g.igst;
  if total <= 0 then
    raise exception 'an invoice must be for more than nothing';
  end if;
  perform set_config('admin.session', 'on', true);
  fy := billing.fy_of(today);
  n := billing.next_number('invoice', fy);
  insert into billing.invoice (number, fy, seq, org_id, subscription_id, kind, description, quantity, unit_paise,
                               taxable_paise, gst_rate_bp, cgst_paise, sgst_paise, igst_paise, total_paise,
                               issued_on, due_on, seller, buyer, raised_by)
  values (billing.format_number('invoice', fy, n), fy, n, p_org, p_sub, p_kind, p_description, p_quantity, p_unit,
          taxable, s.gst_rate_bp, g.cgst, g.sgst, g.igst, total, today, p_due_on,
          jsonb_build_object('legalName', s.legal_name, 'gstin', s.gstin, 'stateCode', s.state_code,
                             'address', s.address, 'sacCode', s.sac_code, 'title', s.invoice_title),
          jsonb_build_object('legalName', a.legal_name, 'gstin', a.gstin, 'stateCode', a.state_code,
                             'address', a.address, 'schoolCode', sch.code, 'schoolName', sch.display_name),
          p_by)
  returning * into inv;
  return inv;
end;
$$;

-- ---------------------------------------------------------------------------
-- The seller's details: read by owner, ops and finance; set by the owner
-- ---------------------------------------------------------------------------

create or replace function admin.billing_settings()
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
  s billing.seller;
begin
  select * into s from billing.seller where id;
  return jsonb_build_object('legalName', s.legal_name, 'gstin', s.gstin, 'stateCode', s.state_code,
                            'address', s.address, 'sacCode', s.sac_code, 'gstRateBp', s.gst_rate_bp,
                            'title', s.invoice_title, 'ready', billing.seller_ready() is null,
                            'updatedAt', s.updated_at);
end;
$$;

create or replace function admin.billing_settings_set(p_legal_name text, p_gstin text, p_state text, p_address text,
  p_sac text, p_gst_rate_bp integer, p_title text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, billing, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  legal text := btrim(coalesce(p_legal_name, ''));
  gst text := nullif(upper(btrim(coalesce(p_gstin, ''))), '');
  st text := btrim(coalesce(p_state, ''));
  addr text := btrim(coalesce(p_address, ''));
  sac text := btrim(coalesce(p_sac, ''));
  title text := coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Tax invoice');
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  if char_length(legal) not between 1 and 120 then
    raise exception 'give the seller''s legal name, up to 120 characters';
  end if;
  if st !~ '^[0-9]{2}$' then
    raise exception 'a state code is two digits, as at the start of a GSTIN';
  end if;
  if char_length(addr) not between 1 and 400 then
    raise exception 'give the seller''s address, up to 400 characters';
  end if;
  if sac !~ '^[0-9]{4,8}$' then
    raise exception 'a SAC code is 4 to 8 digits';
  end if;
  if gst is not null and gst !~ '^[0-9]{2}[A-Z0-9]{13}$' then
    raise exception 'a GSTIN is 15 letters and digits';
  end if;
  if gst is not null and left(gst, 2) <> st then
    raise exception 'the GSTIN''s first two digits are its state code';
  end if;
  if gst is null and coalesce(p_gst_rate_bp, 0) <> 0 then
    raise exception 'without a GSTIN the GST rate is 0';
  end if;
  if p_gst_rate_bp is null or p_gst_rate_bp not between 0 and 2800 then
    raise exception 'a GST rate is 0 to 2800 basis points';
  end if;
  if char_length(title) > 40 then
    raise exception 'an invoice title is up to 40 characters';
  end if;
  perform set_config('admin.session', 'on', true);
  update billing.seller
     set legal_name = legal, gstin = gst, state_code = st, address = addr, sac_code = sac,
         gst_rate_bp = p_gst_rate_bp, invoice_title = title, updated_at = now(), updated_by = me.user_id
   where id;
  perform admin.audit(me, 'billing-settings-set', 'setting', 'seller', p_reason,
    jsonb_build_object('gstRateBp', p_gst_rate_bp, 'sacCode', sac, 'hasGstin', gst is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- Plans: read by owner, ops and finance; set by the owner
-- ---------------------------------------------------------------------------

create or replace function admin.billing_plans()
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'months', p.months,
                                        'seatPricePaise', p.seat_price_paise, 'active', p.active)
                     order by p.active desc, p.code)
      from billing.plan p), '[]'::jsonb);
end;
$$;

-- A price change applies to subscriptions sold later: each subscription keeps
-- the seat price it was sold at.
create or replace function admin.billing_plan_set(p_code text, p_name text, p_months integer, p_seat_price_paise bigint,
  p_active boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, billing, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  code text := lower(btrim(coalesce(p_code, '')));
  nm text := btrim(coalesce(p_name, ''));
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  if code = 'pilot' then
    raise exception 'pilot is a trial, not a plan that is sold';
  end if;
  if code !~ '^[a-z][a-z0-9-]{0,29}$' then
    raise exception 'a plan code is one word of up to 30 lower-case letters, digits or hyphens';
  end if;
  if char_length(nm) not between 1 and 80 then
    raise exception 'give the plan a name of up to 80 characters';
  end if;
  if p_months is null or p_months not between 1 and 36 then
    raise exception 'a plan runs 1 to 36 months';
  end if;
  if p_seat_price_paise is null or p_seat_price_paise < 0 then
    raise exception 'a price is 0 or more paise';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into billing.plan (code, name, months, seat_price_paise, active)
  values (code, nm, p_months, p_seat_price_paise, coalesce(p_active, true))
  on conflict on constraint plan_code_key do update
    set name = excluded.name, months = excluded.months, seat_price_paise = excluded.seat_price_paise,
        active = excluded.active, updated_at = now();
  perform admin.audit(me, 'plan-set', 'plan', code, p_reason,
    jsonb_build_object('code', code, 'months', p_months, 'seatPricePaise', p_seat_price_paise,
                       'active', coalesce(p_active, true)));
end;
$$;

-- ---------------------------------------------------------------------------
-- A school's billing account: set by owner and ops
-- ---------------------------------------------------------------------------

create or replace function admin.billing_account_set(p_org uuid, p_legal_name text, p_gstin text, p_state text,
  p_address text, p_contact_name text, p_contact_email text, p_contact_phone text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  sch lms.school;
  legal text := btrim(coalesce(p_legal_name, ''));
  gst text := nullif(upper(btrim(coalesce(p_gstin, ''))), '');
  st text := btrim(coalesce(p_state, ''));
  addr text := btrim(coalesce(p_address, ''));
  contact text := btrim(coalesce(p_contact_name, ''));
  email text := nullif(btrim(coalesce(p_contact_email, '')), '');
  phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
begin
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  select * into sch from lms.school where org_id = p_org;
  if sch.org_id is null then
    raise exception 'there is no such school';
  end if;
  if char_length(legal) not between 1 and 120 then
    raise exception 'give the school''s legal name, up to 120 characters';
  end if;
  if st !~ '^[0-9]{2}$' then
    raise exception 'a state code is two digits, as at the start of a GSTIN';
  end if;
  if char_length(addr) not between 1 and 400 then
    raise exception 'give the school''s billing address, up to 400 characters';
  end if;
  if char_length(contact) not between 1 and 80 then
    raise exception 'give the billing contact''s name, up to 80 characters';
  end if;
  if email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that is not an email address';
  end if;
  if phone is not null and phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'a phone is 10 digits starting 6 to 9';
  end if;
  if gst is not null and gst !~ '^[0-9]{2}[A-Z0-9]{13}$' then
    raise exception 'a GSTIN is 15 letters and digits';
  end if;
  if gst is not null and left(gst, 2) <> st then
    raise exception 'the GSTIN''s first two digits are its state code';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into billing.account (org_id, legal_name, gstin, state_code, address, contact_name, contact_email,
                               contact_phone, updated_by)
  values (p_org, legal, gst, st, addr, contact, email, phone, me.user_id)
  on conflict (org_id) do update
    set legal_name = excluded.legal_name, gstin = excluded.gstin, state_code = excluded.state_code,
        address = excluded.address, contact_name = excluded.contact_name, contact_email = excluded.contact_email,
        contact_phone = excluded.contact_phone, updated_at = now(), updated_by = excluded.updated_by;
  perform admin.audit(me, 'billing-account-set', 'school', sch.code, p_reason,
    jsonb_build_object('hasGstin', gst is not null, 'hasEmail', email is not null,
                       'hasPhone', phone is not null, 'stateCode', st));
end;
$$;

-- ---------------------------------------------------------------------------
-- Selling: a subscription and its invoice, or an invoice on its own
-- ---------------------------------------------------------------------------

create or replace function admin.billing_subscription_create(p_org uuid, p_plan text, p_seats integer, p_starts_on date,
  p_due_days integer, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  pl billing.plan;
  sch lms.school;
  due_days integer := coalesce(p_due_days, 15);
  ends date;
  sub_id uuid;
  inv billing.invoice;
begin
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  if not exists (select 1 from billing.account where org_id = p_org) then
    raise exception 'set up this school''s billing account first';
  end if;
  select * into sch from lms.school where org_id = p_org;
  select * into pl from billing.plan where code = lower(btrim(coalesce(p_plan, ''))) and active;
  if pl.id is null then
    raise exception 'there is no plan called % that is on sale', coalesce(p_plan, '(none)');
  end if;
  if p_seats is null or p_seats not between 1 and 100000 then
    raise exception 'seats are 1 to 100000';
  end if;
  if p_starts_on is null then
    raise exception 'give the day the subscription starts';
  end if;
  if due_days not between 0 and 90 then
    raise exception 'payment is due 0 to 90 days after the invoice';
  end if;
  ends := (p_starts_on + make_interval(months => pl.months))::date - 1;
  if exists (select 1 from billing.subscription s
              where s.org_id = p_org and s.cancelled_at is null
                and s.starts_on <= ends and s.ends_on >= p_starts_on) then
    raise exception 'this school already has a subscription for part of that time';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into billing.subscription (org_id, plan_id, seats, starts_on, ends_on, seat_price_paise, created_by)
  values (p_org, pl.id, p_seats, p_starts_on, ends, pl.seat_price_paise, me.user_id)
  returning id into sub_id;
  inv := billing.raise_invoice(p_org, sub_id, 'subscription',
    format('%s plan, %s seats, %s to %s', pl.name, p_seats, to_char(p_starts_on, 'DD Mon YYYY'), to_char(ends, 'DD Mon YYYY')),
    p_seats, pl.seat_price_paise, lms.india_today() + due_days, me.user_id);
  perform admin.audit(me, 'subscription-created', 'school', sch.code, p_reason,
    jsonb_build_object('subscription', sub_id, 'plan', pl.code, 'seats', p_seats,
                       'startsOn', to_char(p_starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(ends, 'YYYY-MM-DD')));
  perform admin.audit(me, 'invoice-raised', 'invoice', inv.number, p_reason,
    jsonb_build_object('number', inv.number, 'totalPaise', inv.total_paise));
  return jsonb_build_object('subscriptionId', sub_id, 'invoiceId', inv.id, 'number', inv.number);
end;
$$;

create or replace function admin.billing_invoice_raise(p_org uuid, p_description text, p_amount_paise bigint,
  p_due_days integer, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  descr text := btrim(coalesce(p_description, ''));
  due_days integer := coalesce(p_due_days, 15);
  inv billing.invoice;
begin
  perform admin.check_environment(p_env);
  perform billing.need_reason(p_reason);
  if char_length(descr) not between 1 and 200 then
    raise exception 'describe the invoice in up to 200 characters';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'an amount is more than 0 paise';
  end if;
  if due_days not between 0 and 90 then
    raise exception 'payment is due 0 to 90 days after the invoice';
  end if;
  inv := billing.raise_invoice(p_org, null, 'other', descr, 1, p_amount_paise, lms.india_today() + due_days, me.user_id);
  perform admin.audit(me, 'invoice-raised', 'invoice', inv.number, p_reason,
    jsonb_build_object('number', inv.number, 'totalPaise', inv.total_paise));
  return jsonb_build_object('invoiceId', inv.id, 'number', inv.number);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading: owner, ops and finance. Lists carry no contact name, email or phone.
-- ---------------------------------------------------------------------------

create or replace function admin.billing_subscriptions(p_org uuid default null)
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
        select s.created_at, s.id,
               jsonb_build_object(
                 'id', s.id, 'orgId', s.org_id, 'schoolCode', sch.code, 'schoolName', sch.display_name,
                 'plan', p.code, 'planName', p.name, 'seats', s.seats,
                 'startsOn', to_char(s.starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(s.ends_on, 'YYYY-MM-DD'),
                 'seatPricePaise', s.seat_price_paise, 'invoiceId', i.id, 'invoiceNumber', i.number,
                 'invoiceStatus', i.status, 'licenceAppliedAt', s.licence_applied_at, 'cancelledAt', s.cancelled_at) as j
          from billing.subscription s
          join billing.plan p on p.id = s.plan_id
          join lms.school sch on sch.org_id = s.org_id
          left join billing.invoice i on i.subscription_id = s.id
         where p_org is null or s.org_id = p_org
         order by s.created_at desc, s.id
         limit 500
      ) r), '[]'::jsonb);
end;
$$;

create or replace function admin.billing_invoices(p_org uuid default null, p_status text default null)
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
begin
  if p_status is not null and p_status not in ('unpaid', 'partly_paid', 'paid', 'void') then
    raise exception 'a status is unpaid, partly_paid, paid or void';
  end if;
  return coalesce((
    select jsonb_agg(r.j order by r.created_at desc, r.fy desc, r.seq desc)
      from (
        select i.created_at, i.fy, i.seq,
               jsonb_build_object(
                 'id', i.id, 'number', i.number, 'orgId', i.org_id, 'schoolCode', sch.code,
                 'schoolName', sch.display_name, 'kind', i.kind,
                 'issuedOn', to_char(i.issued_on, 'YYYY-MM-DD'), 'dueOn', to_char(i.due_on, 'YYYY-MM-DD'),
                 'totalPaise', i.total_paise, 'paidPaise', i.paid_paise, 'status', i.status,
                 'openLink', (select jsonb_build_object('linkId', l.link_id, 'url', l.url, 'status', l.status)
                                from billing.payment_link l
                               where l.invoice_id = i.id and l.status in ('creating', 'active', 'partly_paid')
                               limit 1)) as j
          from billing.invoice i
          join lms.school sch on sch.org_id = i.org_id
         where (p_org is null or i.org_id = p_org)
           and (p_status is null or i.status = p_status)
         order by i.created_at desc, i.fy desc, i.seq desc
         limit 500
      ) r), '[]'::jsonb);
end;
$$;

create or replace function admin.billing_invoice(p_invoice uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
  i billing.invoice;
  sch lms.school;
begin
  select * into i from billing.invoice where id = p_invoice;
  if i.id is null then
    raise exception 'there is no such invoice';
  end if;
  select * into sch from lms.school where org_id = i.org_id;
  return jsonb_build_object(
    'id', i.id, 'number', i.number, 'fy', i.fy, 'seq', i.seq, 'orgId', i.org_id,
    'schoolCode', sch.code, 'schoolName', sch.display_name, 'subscriptionId', i.subscription_id,
    'kind', i.kind, 'description', i.description, 'quantity', i.quantity, 'unitPaise', i.unit_paise,
    'taxablePaise', i.taxable_paise, 'gstRateBp', i.gst_rate_bp, 'cgstPaise', i.cgst_paise,
    'sgstPaise', i.sgst_paise, 'igstPaise', i.igst_paise, 'totalPaise', i.total_paise, 'currency', i.currency,
    'issuedOn', to_char(i.issued_on, 'YYYY-MM-DD'), 'dueOn', to_char(i.due_on, 'YYYY-MM-DD'),
    'seller', i.seller, 'buyer', i.buyer, 'status', i.status, 'paidPaise', i.paid_paise,
    'paidOn', to_char(i.paid_on, 'YYYY-MM-DD'), 'voidedAt', i.voided_at, 'createdAt', i.created_at,
    'openLink', (select jsonb_build_object('linkId', l.link_id, 'url', l.url, 'status', l.status)
                   from billing.payment_link l
                  where l.invoice_id = i.id and l.status in ('creating', 'active', 'partly_paid')
                  limit 1),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('linkId', l.link_id, 'url', l.url, 'status', l.status,
                                          'amountPaise', l.amount_paise, 'amountPaidPaise', l.amount_paid_paise,
                                          'expiresAt', l.expires_at, 'createdAt', l.created_at)
                       order by l.attempt)
        from billing.payment_link l where l.invoice_id = i.id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'source', p.source, 'amountPaise', p.amount_paise,
                                          'receivedOn', to_char(p.received_on, 'YYYY-MM-DD'),
                                          'reference', p.reference, 'counted', p.counted,
                                          'notCountedWhy', p.not_counted_why, 'recordedAs', p.recorded_as,
                                          'refundedPaise', coalesce((
                                            select sum(rf.amount_paise) from billing.refund rf
                                             where rf.payment_id = p.id
                                               and rf.status in ('requested', 'pending', 'success')), 0))
                       order by p.created_at, p.id)
        from billing.payment p where p.invoice_id = i.id), '[]'::jsonb),
    'creditNotes', coalesce((
      select jsonb_agg(jsonb_build_object('number', c.number, 'amountPaise', c.amount_paise,
                                          'taxablePaise', c.taxable_paise, 'taxPaise', c.tax_paise,
                                          'issuedOn', to_char(c.issued_on, 'YYYY-MM-DD'))
                       order by c.fy, c.seq)
        from billing.credit_note c where c.invoice_id = i.id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Nothing in billing is callable by an API role; the ten browser
-- functions are callable by a signed-in person and check for staff themselves.
-- ---------------------------------------------------------------------------

revoke all on function billing.no_delete() from public, anon, authenticated, service_role;
revoke all on function billing.no_edit() from public, anon, authenticated, service_role;
revoke all on function billing.invoice_guard() from public, anon, authenticated, service_role;
revoke all on function billing.fy_of(date) from public, anon, authenticated, service_role;
revoke all on function billing.next_number(text, text) from public, anon, authenticated, service_role;
revoke all on function billing.format_number(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function billing.gst_split(bigint, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function billing.seller_ready() from public, anon, authenticated, service_role;
revoke all on function billing.need_reason(text) from public, anon, authenticated, service_role;
revoke all on function billing.raise_invoice(uuid, uuid, text, text, integer, bigint, date, uuid)
  from public, anon, authenticated, service_role;

revoke all on function admin.billing_settings() from public, anon;
revoke all on function admin.billing_settings_set(text, text, text, text, text, integer, text, text, text) from public, anon;
revoke all on function admin.billing_plans() from public, anon;
revoke all on function admin.billing_plan_set(text, text, integer, bigint, boolean, text, text) from public, anon;
revoke all on function admin.billing_account_set(uuid, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function admin.billing_subscription_create(uuid, text, integer, date, integer, text, text) from public, anon;
revoke all on function admin.billing_invoice_raise(uuid, text, bigint, integer, text, text) from public, anon;
revoke all on function admin.billing_subscriptions(uuid) from public, anon;
revoke all on function admin.billing_invoices(uuid, text) from public, anon;
revoke all on function admin.billing_invoice(uuid) from public, anon;

grant execute on function admin.billing_settings() to authenticated;
grant execute on function admin.billing_settings_set(text, text, text, text, text, integer, text, text, text) to authenticated;
grant execute on function admin.billing_plans() to authenticated;
grant execute on function admin.billing_plan_set(text, text, integer, bigint, boolean, text, text) to authenticated;
grant execute on function admin.billing_account_set(uuid, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function admin.billing_subscription_create(uuid, text, integer, date, integer, text, text) to authenticated;
grant execute on function admin.billing_invoice_raise(uuid, text, bigint, integer, text, text) to authenticated;
grant execute on function admin.billing_subscriptions(uuid) to authenticated;
grant execute on function admin.billing_invoices(uuid, text) to authenticated;
grant execute on function admin.billing_invoice(uuid) to authenticated;
