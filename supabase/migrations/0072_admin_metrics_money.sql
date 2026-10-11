-- MONEY OVER TIME (plan 6, the Money and Reliability chart pages).
--
-- money.collected_paise: payments that count and are not reversed, by the
--   India day the money was received (billing.payment.received_on).
-- money.outstanding_paise / money.overdue_paise: at the end of an India day,
--   every invoice issued by then and not void by then, less the counted,
--   unreversed payments received by then; overdue is the part of it whose
--   due date had passed.
-- webhook.events: Cashfree's notifications by the India day they arrived, in
--   all and by the status they were left in.
--
-- Recomputing an old day counts the payments, reversals and voids as they
-- stand now (ruling R8): a payment reversed today no longer counts on the day
-- it was received, and signature failures older than 90 days are deleted
-- (0060), so they are gone from a recomputed day.
--
-- admin.money_view: margin per school (R15: the invoiced fee, taxable value,
-- spread evenly over its subscription's days, against the school's AI spend
-- as rolled up in admin.metric_daily) and renewals ahead (R16: thirteen
-- weeks of non-pilot licences ending, at the latest subscription's seats
-- times its seat price). AI spend only: hosting, storage, messages and people
-- are not in the cost.

create or replace function admin.metric_family_money(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  day_end timestamptz := admin.ist_start(p_day + 1);
  collected bigint;
  outstanding bigint;
  overdue bigint;
  n integer;
begin
  select coalesce(sum(p.amount_paise), 0) into collected
    from billing.payment p
   where p.counted and p.reversed_at is null and p.received_on = p_day;
  select coalesce(sum(greatest(i.total_paise - coalesce(pd.paid, 0), 0)), 0),
         coalesce(sum(greatest(i.total_paise - coalesce(pd.paid, 0), 0)) filter (where i.due_on < p_day), 0)
    into outstanding, overdue
    from billing.invoice i
    left join lateral (
      select sum(p.amount_paise) as paid from billing.payment p
       where p.invoice_id = i.id and p.counted and p.reversed_at is null and p.received_on <= p_day
    ) pd on true
   where i.issued_on <= p_day and (i.voided_at is null or i.voided_at >= day_end);
  insert into admin.metric_daily (day, metric, dim, value) values
    (p_day, 'money.collected_paise', '', collected),
    (p_day, 'money.outstanding_paise', '', outstanding),
    (p_day, 'money.overdue_paise', '', overdue);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function admin.metric_family_webhooks(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  day_start timestamptz := admin.ist_start(p_day);
  day_end timestamptz := admin.ist_start(p_day + 1);
  n integer;
begin
  with w as materialized (
    select we.status from billing.webhook_event we where we.received_at >= day_start and we.received_at < day_end
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, 'webhook.events', x.dim, x.value from (
    select '' as dim, count(*)::bigint as value from w
    union all select w.status, count(*)::bigint from w group by w.status) x;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Margin per school and renewals ahead, for the 7 or 30 India days ending
-- yesterday. Owner, ops and finance (the billing reads' roles, 0060).
create or replace function admin.money_view(p_days integer)
returns jsonb
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops', 'finance']);
  t date;
  f date;
  monday date := date_trunc('week', lms.india_today()::timestamp)::date;
  margin jsonb;
  direct bigint;
  renewals jsonb;
begin
  if p_days is null or p_days not in (7, 30) then
    raise exception 'days is 7 or 30';
  end if;
  t := lms.india_today() - 1;
  f := t - p_days + 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', x.code, 'name', x.name, 'feePaise', x.fee, 'costPaise', x.cost, 'costIsFloor', x.floor,
           'marginPaise', x.fee - x.cost, 'noFee', x.fee = 0, 'daysRolledUp', x.rolled) order by x.code), '[]'::jsonb)
    into margin
    from (
      select sc.code, sc.display_name as name,
             coalesce((
               select sum(i.taxable_paise
                          * greatest(0, least(sub.ends_on, t) - greatest(sub.starts_on, f) + 1)
                          / (sub.ends_on - sub.starts_on + 1))
                 from billing.subscription sub
                 join billing.invoice i on i.subscription_id = sub.id
                where sub.org_id = sc.org_id and i.status <> 'void' and sub.cancelled_at is null
             ), 0)::bigint as fee,
             coalesce((
               select sum(m.value) from admin.metric_daily m
                where m.metric = 'spend.school_paise' and m.org_id = sc.org_id and m.day between f and t
             ), 0)::bigint as cost,
             exists (
               select 1 from admin.metric_daily m
                where m.metric = 'spend.school_unpriced_calls' and m.org_id = sc.org_id
                  and m.day between f and t and m.value > 0
             ) as floor,
             (select count(distinct m.day) from admin.metric_daily m
               where m.metric = 'spend.school_paise' and m.org_id = sc.org_id and m.day between f and t)::int as rolled
        from lms.school sc
    ) x;

  select coalesce(sum(m.value), 0)::bigint into direct
    from admin.metric_daily m
   where m.metric = 'spend.paise' and m.org_id is null and m.dim = 'who:direct' and m.day between f and t;

  select jsonb_agg(jsonb_build_object('weekStart', w.week_start, 'schools', w.schools, 'paiseAtCurrentPrice', w.paise)
                   order by w.week_start)
    into renewals
    from (
      select monday + 7 * g as week_start,
             count(l.org_id)::int as schools,
             coalesce(sum((
               select s.seats::bigint * s.seat_price_paise
                 from billing.subscription s
                where s.org_id = l.org_id
                order by s.ends_on desc, s.created_at desc
                limit 1)), 0)::bigint as paise
        from generate_series(0, 12) g
        left join lms.licence l
          on l.plan <> 'pilot' and l.valid_until between monday + 7 * g and monday + 7 * g + 6
       group by g
    ) w;

  return jsonb_build_object('from', f, 'to', t, 'days', p_days, 'margin', margin,
    'directCostPaise', direct, 'renewals', renewals);
end;
$$;

insert into admin.metric_family (name, position, fn) values
  ('money', 50, 'admin.metric_family_money'),
  ('webhooks', 60, 'admin.metric_family_webhooks')
on conflict (name) do update set position = excluded.position, fn = excluded.fn;

do $cat$
begin
perform set_config('admin.session', 'on', true);
insert into admin.metric_def (key, position, pages, label, unit, day_kind, kind, scope, child_figure, total)
values
  ('money.collected_paise', 200, array['money'], 'Collected', 'paise', 'india', 'daily', 'platform', false, 'sum'),
  ('money.outstanding_paise', 210, array['money'], 'Outstanding at the day''s end', 'paise', 'india', 'daily', 'platform', false, 'last'),
  ('money.overdue_paise', 220, array['money'], 'Overdue at the day''s end', 'paise', 'india', 'daily', 'platform', false, 'last'),
  ('webhook.events', 520, array['reliability'], 'Payment notifications by result', 'count', 'india', 'daily', 'platform', false, 'sum')
on conflict (key) do update set position = excluded.position, pages = excluded.pages, label = excluded.label,
  unit = excluded.unit, day_kind = excluded.day_kind, kind = excluded.kind, scope = excluded.scope,
  child_figure = excluded.child_figure, total = excluded.total;
perform set_config('admin.session', '', true);
end;
$cat$;

revoke all on function admin.metric_family_money(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.metric_family_webhooks(date, boolean) from public, anon, authenticated, service_role;
revoke all on function admin.money_view(integer) from public, anon;
grant execute on function admin.money_view(integer) to authenticated;
