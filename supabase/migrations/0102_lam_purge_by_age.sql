-- THE NIGHTLY PURGE DELETES BY AGE ALONE AGAIN (Aarav's choice (a)).
--
-- 0021 made purge_old_ledger delete only the events a server fold had marked
-- as covered in learner_model.purge_safe_before. Nothing ever wrote that mark,
-- so from 0021 on the purge deleted no answers at all, and the mic screen and
-- /privacy, which promise "deleted after 90 days", were untrue
-- (apps/classroom/tests/privacyClaims.test.tsx).
--
-- think() keeps a snapshot of each learner's model and folds forward from it
-- (0101), so deleting an answer the snapshot already holds loses nothing the
-- model learned from it. The snapshot takes an answer only on a run over an
-- hour after the answer arrived; think() runs straight after a hand-in, so
-- packages/lms-brain settleDue has to think those learners again before the
-- cutoff. Nothing on the hosted project runs think() or settleDue yet
-- (lam-one-brain Task 9 is to), and an answer the snapshot does not hold by
-- the cutoff is deleted all the same: the model then forgets it. A new model
-- version rebuilds from what the ledger still holds.
--
-- The body is 0007's.

create or replace function public.purge_old_ledger(p_days integer default 90)
returns table (events_deleted bigint, sessions_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  ev bigint;
  se bigint;
begin
  -- RECEIVED_AT, not `at`. `at` is the device's clock and a phone set to 2019
  -- would have its events purged the moment they arrived; `received_at` is
  -- Postgres's own and is the only clock that can be trusted to age a row.
  delete from public.ledger_event where received_at < cutoff;
  get diagnostics ev = row_count;

  -- A session is only removed once nothing references it, so a long class that
  -- straddles the cutoff never loses its opening while keeping its end.
  delete from public.learning_session s
   where s.received_at < cutoff
     and not exists (select 1 from public.ledger_event e where e.session_id = s.id);
  get diagnostics se = row_count;

  return query select ev, se;
end;
$$;

-- Still an operator's tool, never a student's.
revoke all on function public.purge_old_ledger(integer) from public;
revoke all on function public.purge_old_ledger(integer) from anon;
revoke all on function public.purge_old_ledger(integer) from authenticated;
grant execute on function public.purge_old_ledger(integer) to service_role;

-- Nothing writes it and nothing reads it any more.
alter table public.learner_model drop column if exists purge_safe_before;
