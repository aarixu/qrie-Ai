-- ONE LEARNER CANNOT HOLD THE BRAIN QUEUE (lam-one-brain, P2 security review
-- F2).
--
-- 0108's enqueue gave every learner a fresh start on a new answer: attempts
-- back to 0, last_error cleared. The drain counted a failure only in its
-- catch, so a think the platform killed (wall clock, memory) was never
-- counted at all, and a learner whose think kept dying was tried first on
-- every run while they kept answering.
--
-- The drain (packages/lms-brain drain.ts) now counts a try before making it,
-- with last_error 'interrupted: ...' (drain.ts INTERRUPTED) until the think
-- finishes, and keeps a statement timeout's error as 'timeout: ...'. Here a
-- new answer still takes a new ticket, but resets attempts and last_error
-- only when the last failure was an ordinary error: a learner left
-- 'interrupted' or 'timeout' keeps the count, so after five such tries the
-- drain skips them (drain.ts MAX_ATTEMPTS) until someone resets the row.
-- enqueued_at is not moved here; the drain moves a learner thought about
-- while an answer landed to the back of the queue.
--
-- Everything else is 0108's function; `create or replace` keeps its grants
-- and the trigger that calls it.

create or replace function public.brain_enqueue()
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
    set ticket = nextval('public.brain_queue_ticket'),
        attempts = case when brain_queue.last_error like 'interrupted:%' or brain_queue.last_error like 'timeout:%'
                        then brain_queue.attempts else 0 end,
        last_error = case when brain_queue.last_error like 'interrupted:%' or brain_queue.last_error like 'timeout:%'
                          then brain_queue.last_error end;
  return null;
end;
$$;
