-- THE TUTOR READS THE SERVER'S MODEL (lam-one-brain Task 11, review SF4).
--
-- public.my_learner_model() hands the signed-in learner what the brain
-- (packages/lms-brain think.ts) last wrote about them: every concept_state
-- row of theirs, and where it had read their ledger to when it wrote them.
-- The classroom takes those rows as its base model and folds on top only the
-- events of its own that the brain had not read (apps/classroom
-- learnerModel.ts refreshFromServer).
--
-- ONE STATEMENT, so the rows and the cursor come from the same run of the
-- brain. Read as two requests, a run landing between them would hand back
-- rows built from more (or less) than the cursor says, and the phone would
-- fold some of its own events twice (or not at all).
--
-- The answer is one jsonb:
--   version        learner_model.version, the MODEL_VERSION the rows were
--                  folded by; null when the brain has never written this
--                  learner.
--   foldedThrough  the cursor in think()'s order of receipt, or null with
--                  version:
--                    at         learner_model.folded_through_at, the last
--                               event's received_at to the millisecond;
--                    sessionId  that event's sitting, read from the ledger by
--                               learner_model.folded_through_id; null once
--                               the purge (0102) has deleted the event;
--                    seq        learner_model.folded_through_seq.
--   states         every concept_state column but org_id and user_id, one
--                  object per outcome, in outcome order.
--
-- SECURITY INVOKER: it reads through row security, and 0006/0013's policies
-- give a learner their own concept_state, learner_model and ledger_event rows
-- and nobody else's. Nothing here is written. Not for anon, who reads none of
-- those tables (0013 revoked them); functions are executable by public by
-- default, so that is revoked and authenticated is granted.

create or replace function public.my_learner_model()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'version', lm.version,
    'foldedThrough', case when lm.folded_through_at is null then null else jsonb_build_object(
      'at', lm.folded_through_at,
      'sessionId', e.session_id,
      'seq', lm.folded_through_seq) end,
    'states', coalesce(
      (select jsonb_agg(to_jsonb(cs) - 'org_id' - 'user_id' order by cs.outcome_id)
         from public.concept_state cs
        where cs.user_id = me.uid),
      '[]'::jsonb))
  from (select auth.uid() as uid) me
  left join public.learner_model lm on lm.user_id = me.uid
  left join public.ledger_event e on e.id = lm.folded_through_id
$$;

revoke all on function public.my_learner_model() from public, anon;
grant execute on function public.my_learner_model() to authenticated;
