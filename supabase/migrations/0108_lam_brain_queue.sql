-- THE BRAIN RUNS BY ITSELF: A QUEUE OF LEARNERS TO THINK ABOUT AGAIN
-- (lam-one-brain Task 9; review MF10, MF11, SF3).
--
-- Every insert into public.ledger_event, whoever makes it (the LMS's hand-in
-- and practice functions, record_evidence, the service role), puts each of
-- its learners on public.brain_queue, once per statement. packages/lms-brain
-- drainBrainQueue takes them off: per learner, in one transaction, it thinks
-- (think.ts thinkLearner) and then deletes the row only if its ticket is still
-- the one it read. Every enqueue takes a new ticket from a sequence, so an
-- answer that lands while the brain is thinking keeps its learner queued for
-- the next run instead of being dropped with the row. The ticket, not
-- enqueued_at, is what the delete compares: two writers' now() can arrive in
-- either order, a sequence taken under the row's lock cannot.
--
-- enqueued_at is when the learner was first queued since the brain last
-- thought about them; a later answer does not move it, so the drain, which
-- takes the longest-waiting first, cannot starve a learner who keeps
-- answering, and its age is how far the brain is behind for them.
--
-- attempts and last_error are the drain's: a learner whose think fails is
-- counted and skipped after five failures (packages/lms-brain drain.ts). A new
-- answer gives them a fresh start, because new evidence may be what the fold
-- needed, and a fix to the brain is deployed by someone who can reset them.
--
-- NOBODY BUT THE OWNER AND THE SERVICE ROLE TOUCHES IT. Supabase's default
-- privileges grant every new public table and sequence to anon and
-- authenticated (supabase/tests/harness.ts mirrors them); both are revoked
-- here and row security is on with no policy. The trigger function is
-- security definer, so a student's own insert still queues them, and it
-- cannot be executed by the API roles.

create sequence public.brain_queue_ticket;

create table public.brain_queue (
  user_id uuid primary key references auth.users on delete cascade,
  enqueued_at timestamptz not null default now(),
  ticket bigint not null default nextval('public.brain_queue_ticket'),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text
);

create index brain_queue_waiting on public.brain_queue (enqueued_at, user_id);

alter table public.brain_queue enable row level security;
revoke all on table public.brain_queue from public, anon, authenticated;
revoke all on sequence public.brain_queue_ticket from public, anon, authenticated;
grant select, insert, update, delete on table public.brain_queue to service_role;
grant usage, select on sequence public.brain_queue_ticket to service_role;

create function public.brain_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- In user order, so two statements queueing the same learners take their
  -- rows' locks in the same order.
  insert into public.brain_queue (user_id)
  select distinct n.user_id from new_events n order by n.user_id
  on conflict (user_id) do update
    set ticket = nextval('public.brain_queue_ticket'), attempts = 0, last_error = null;
  return null;
end;
$$;

revoke all on function public.brain_enqueue() from public, anon, authenticated;

create trigger ledger_event_brain_enqueue
  after insert on public.ledger_event
  referencing new table as new_events
  for each statement execute function public.brain_enqueue();
