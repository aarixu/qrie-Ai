-- THE CEILING BECOMES A ROW, BECAUSE A CEILING YOU CANNOT MOVE TAKES THE
-- PRODUCT DOWN WITH IT.
--
-- 0015 put the project-wide ceiling in a plpgsql constant, which was right for
-- getting it shipped and wrong for living with. Raising it is a migration and a
-- deploy, and the number itself has a short life: Rs 500 a day suits a
-- self-serve MVP and is out by roughly four times for the school pilot. Five
-- hundred bound students at about ten minutes each is near 83 student-hours a
-- day, which at MVP-1 rates is about Rs 2,158. The pilot would halt at
-- breakfast on its first morning, and the fix would be a migration written in a
-- hurry by somebody who had just watched it happen.
--
-- So the number moves into a row and the constant becomes that row's DEFAULT,
-- which `apps/classroom/tests/migrations.test.ts` still asserts against
-- `UNITS_PER_DAY_PROJECT`. The code keeps naming the number; the database
-- decides it.
--
-- HALTED IS THE SECOND STOP, AND IT IS NOT A DUPLICATE OF THE FIRST.
-- `RELAY_DISABLED` is an environment variable: it stops the relay before it
-- verifies anybody, it costs nothing to check, and it needs a restart to set.
-- `relay_control.halted` is inside the database, so an alarm can set it with
-- nobody awake, and it takes effect on the very next request. Two stops at two
-- layers, on purpose -- the one that needs a human and the one that does not.
--
-- ONE ROW, ENFORCED. `id boolean primary key default true check (id)` is the
-- usual trick and it is worth the strangeness: a control table with two rows is
-- a control table nobody can reason about at three in the morning.

create table if not exists public.relay_control (
  id boolean primary key default true check (id),
  halted boolean not null default false,
  halted_reason text,
  global_units_per_day integer not null default 50000,
  max_concurrent_preps integer not null default 8,
  updated_at timestamptz not null default now()
);

-- The row exists from the moment the table does. A missing row must never be
-- the thing that decides whether the relay runs.
insert into public.relay_control (id) values (true) on conflict (id) do nothing;

-- Like relay_usage and relay_budget_day: RLS on, not one policy, so the only
-- way in is the definer function below or the service-role key. A student
-- cannot read how much of the day is left, which is one fewer thing for
-- somebody deciding whether it is worth trying.
alter table public.relay_control enable row level security;

revoke all on table public.relay_control from anon, authenticated;

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
  now_at timestamptz := now();
  today date := (now_at at time zone 'utc')::date;
  midnight_in integer;
  ceiling_units integer;
  is_halted boolean;
  row_units integer;
  row_window_start timestamptz;
  row_window_count integer;
  project_units integer;
begin
  if p_user is null or p_units is null or p_units < 0 then
    raise exception 'claim_relay needs a user and a non-negative cost';
  end if;

  -- One row, read once. It is a single page in shared buffers on every call
  -- after the first, which is the price of being able to move the ceiling
  -- without a deploy.
  select c.halted, c.global_units_per_day
    into is_halted, ceiling_units
    from public.relay_control c
   where c.id
   limit 1;

  -- A table somebody dropped a row from must not open the relay. Absent reads
  -- as halted, in the same spirit as the meter failing closed.
  if ceiling_units is null then
    return query select false, 'halted'::text, 60;
    return;
  end if;

  if is_halted then
    -- Minutes, not a day: somebody or an alarm did this on purpose and will
    -- undo it. Pointing at midnight would be a lie in both directions.
    return query select false, 'halted'::text, 300;
    return;
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
  -- between. When the guard fails no row is returned, project_units stays null,
  -- and nothing was taken -- so a refusal here costs the student none of their
  -- own budget, which matters because it was not their doing.
  if p_units > ceiling_units then
    return query select false, 'capped'::text, midnight_in;
    return;
  end if;

  insert into public.relay_budget_day as b (day, units)
  values (today, p_units)
  on conflict (day) do update
     set units = b.units + p_units,
         updated_at = now_at
   where b.units + p_units <= ceiling_units
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

-- Restated because `create or replace` takes the whole body: the relay reaches
-- this with the service-role key and nobody else reaches it at all.
revoke all on function public.claim_relay(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_relay(uuid, text, integer) to service_role;
