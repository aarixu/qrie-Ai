-- THE SERVER KEEPS WHAT IT LEARNED (lam-one-brain Task 2b).
--
-- Until now think() rebuilt every child from their whole ledger on every run,
-- so the model could only ever know what the ledger still held. The nightly
-- purge is meant to delete every answer older than 90 days (0007; Aarav's
-- choice (a), restored by 0062), and a rebuild after it would forget what
-- those answers had taught. So learner_model now keeps the model itself:
-- packages/lms-brain/src/think.ts folds forward from this snapshot, reading
-- only the events the server received after it, and rebuilds from the ledger
-- only when the snapshot is missing or of another model version. The purge
-- keeps its promise only for answers the snapshot holds (settleDue, think.ts).

alter table public.learner_model
  -- {"model": <the whole LearnerModel, packages/learner-model types.ts>,
  --  "bank": [<normalised wrong-idea labels taken from lms.item>]}. The
  -- model's foldedThrough is where the snapshot reaches, in think()'s order
  -- of receipt. It covers only what was received over an hour before the run
  -- that wrote it, so a write that began earlier and committed later is still
  -- ahead of it.
  add column if not exists snapshot jsonb,
  -- The last event concept_state was built from, in that same order: its
  -- server received_at and its id.
  add column if not exists folded_through_received_at timestamptz,
  add column if not exists folded_through_id uuid;

-- A student still reads their own row (0013's policy) and still writes none
-- of it: 0013 revoked insert, update and delete from authenticated and
-- everything from anon, and new columns inherit the table's grants.

comment on column public.learner_model.folded_through_at is
  'The order key of the last event concept_state was built from: its received_at, to the millisecond (think.ts); with folded_through_seq, the cursor.';
