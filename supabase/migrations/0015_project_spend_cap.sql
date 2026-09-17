-- A CEILING ON OUR SPENDING, NOT A SECOND ONE ON THEIRS.
--
-- Everything 0003 and 0012 hold is keyed on one user: 120 requests a minute
-- and 12,000 units a day, which at one paisa a unit is Rs 120. That is a real
-- limit on a student and no limit at all on us, because a student costs
-- nothing to create. `apps/classroom/src/lib/relay.ts` calls
-- `signInAnonymously()` at boot, there is no captcha in front of it, and
-- `provision_solo_org()` happily gives every one of them an organisation. So
-- the ceiling a script actually meets is Rs 120 multiplied by however many
-- accounts it cares to mint, and nobody had written that number down because
-- there isn't one.
--
-- This is the line under all of them: 50,000 units, Rs 500 of vendor spend, per
-- UTC day, across every caller. It is deliberately far above the per-student
-- ceiling. A cap one student can reach alone is not a cap on us; it is a
-- second and worse cap on them.
--
-- WHY IT LIVES IN THIS FUNCTION. It has to be claimed in the same call and the
-- same transaction as the per-user claim, or two Edge Function instances can
-- both read the last unit and both spend it. The claim is the WHERE of an
-- upsert, so the row is locked by the write that tests it: if no row comes
-- back, the day is spent and nothing was taken.
--
-- WHY IT REFUSES WITH ITS OWN REASON. 'budget' means a student used up their
-- own day and the message says so. A student arriving after WE have spent ours
-- did nothing, has nothing to check, and can do nothing differently. Telling
-- them "you have used up today's classes" would be false. 'capped' carries a
-- 503 and a message that owns it.

create table if not exists public.relay_budget_day (
  day date primary key,
  units integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Like relay_usage: RLS on, and not one policy. RLS denies what no policy
-- allows, so the only way in is the definer function below. A student holding
-- the anon key cannot read how much of the day is left, which is one fewer
-- thing for somebody deciding whether it is worth trying.
alter table public.relay_budget_day enable row level security;

revoke all on table public.relay_budget_day from anon, authenticated;

create or replace function public.claim_relay(
  p_user uuid,
  p_relay text,
  p_units integer
)
returns table (allowed boolean, reason text, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  requests_per_minute constant integer := 120;
  units_per_day constant integer := 12000;
  -- Mirrored in packages/relay/src/gate.ts as UNITS_PER_DAY_PROJECT, and
  -- asserted equal by apps/classroom/tests/migrations.test.ts, for the reason
  -- 0012 learned the hard way: the prices may move alone, the ceiling may not.
  units_per_day_project constant integer := 50000;
  now_at timestamptz := now();
  today date := (now_at at time zone 'utc')::date;
  midnight_in integer;
  row_units integer;
  row_window_start timestamptz;
  row_window_count integer;
  project_units integer;
begin
  if p_user is null or p_units is null or p_units < 0 then
    raise exception 'claim_relay needs a user and a non-negative cost';
  end if;

  -- Seconds to the rollover of `today` above. Both budgets reset there, so both
  -- refusals point at it. Written "at time zone 'utc'" rather than a bare cast
  -- because a plain ::timestamptz reads the date in the SESSION's zone, which
  -- on a database not set to UTC came out negative and clamped to one second --
  -- a Retry-After that sent a client straight back into the same refusal.
  midnight_in := greatest(
    1,
    ceil(extract(epoch from (((today + 1)::timestamp at time zone 'utc') - now_at)))::integer
  );

  -- One statement, so two calls from two Edge Function instances cannot both
  -- read 119 and both write 120. The row is locked by the update itself.
  insert into public.relay_usage as u (user_id, day, day_units, window_start, window_count)
  values (p_user, today, 0, date_trunc('minute', now_at), 0)
  on conflict (user_id) do update
    set
      -- A new day resets the budget; a new minute resets the window. Both are
      -- decided here rather than by a sweep, so nothing has to run on a timer.
      day = today,
      day_units = case when u.day = today then u.day_units else 0 end,
      window_start = case
        when now_at - u.window_start >= interval '1 minute' then date_trunc('minute', now_at)
        else u.window_start
      end,
      window_count = case
        when now_at - u.window_start >= interval '1 minute' then 0
        else u.window_count
      end
  returning u.day_units, u.window_start, u.window_count
  into row_units, row_window_start, row_window_count;

  if row_window_count >= requests_per_minute then
    return query select
      false,
      'rate'::text,
      greatest(1, ceil(extract(epoch from (row_window_start + interval '1 minute' - now_at)))::integer);
    return;
  end if;

  if row_units + p_units > units_per_day then
    return query select false, 'budget'::text, midnight_in;
    return;
  end if;

  -- THE PROJECT'S DAY, CLAIMED BEFORE THE STUDENT'S IS SPENT.
  --
  -- The guard is the WHERE of the upsert, so the test and the write are one
  -- locked statement rather than a read and a later update with a race in
  -- between. When the guard fails no row is returned, project_units stays
  -- null, and nothing was taken -- so a refusal here costs the student none of
  -- their own budget, which matters because it was not their doing.
  --
  -- The INSERT arm only runs on the first call of a day, where units would be
  -- p_units alone; a single call is at most a few hundred units against fifty
  -- thousand, so it cannot open the day already over. The guard below says so
  -- out loud rather than resting on that.
  if p_units > units_per_day_project then
    return query select false, 'capped'::text, midnight_in;
    return;
  end if;

  insert into public.relay_budget_day as b (day, units)
  values (today, p_units)
  on conflict (day) do update
     set units = b.units + p_units,
         updated_at = now_at
   where b.units + p_units <= units_per_day_project
  returning b.units into project_units;

  if project_units is null then
    return query select false, 'capped'::text, midnight_in;
    return;
  end if;

  update public.relay_usage
     set day_units = day_units + p_units,
         window_count = window_count + 1
   where user_id = p_user;

  return query select true, null::text, 0;
end;
$$;

-- Unchanged from 0012 and restated because `create or replace` takes the whole
-- body: the relay reaches this with the service-role key and nobody else
-- reaches it at all.
revoke all on function public.claim_relay(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_relay(uuid, text, integer) to service_role;
