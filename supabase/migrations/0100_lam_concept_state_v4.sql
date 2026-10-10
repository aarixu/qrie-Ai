-- THE WHOLE LEARNER MODEL ON THE SERVER (learner-model version 4).
--
-- 0013/0014 hold the belief and evidence counters of a ConceptState and drop
-- the rest, so a model read back from the server could not say when an
-- outcome was mastered, where its spaced review stood, or which wrong idea the
-- child keeps showing. packages/lms-brain/src/think.ts now writes every field
-- of packages/learner-model's ConceptState (types.ts); these are the columns
-- that were missing. Nothing else changes.
--
-- Defaults are what emptyConceptState holds, so a row written before this
-- migration reads as "nothing known yet" for the new fields until the next
-- think() rebuilds it from the ledger.

alter table public.concept_state
  -- When the one mastery rule (two distinct items right cold, a day apart, at
  -- or above 0.8 unassisted) last became true; null while it does not hold.
  add column if not exists mastered_at timestamptz,
  -- The cold right answers that rule needs, per item: {"<item>": {"first", "last"}}.
  add column if not exists cold_wins jsonb not null default '{}'::jsonb,
  -- Spaced review: the box on the 1/2/5/12/30/60-day ladder (0-5), null until
  -- the outcome is first met.
  add column if not exists box smallint check (box is null or box between 0 and 5),
  add column if not exists last_exposed_at timestamptz,
  add column if not exists last_retrieved_at timestamptz,
  -- The wrong ideas this outcome's answers showed, keyed by id
  -- (packages/learner-model/src/misconception.ts). think() bounds it to fit.
  add column if not exists misconceptions jsonb not null default '{}'::jsonb;

-- One learner's record of wrong ideas on one outcome stays small (review SF12):
-- the fold keeps at most 20 ideas of at most 8 items each, and think() drops
-- the least telling ones before a write that would pass this line.
alter table public.concept_state drop constraint if exists concept_state_misconceptions_size;
alter table public.concept_state add constraint concept_state_misconceptions_size
  check (octet_length(misconceptions::text) <= 8192);

-- The model version the server writes (packages/learner-model MODEL_VERSION),
-- asserted equal by apps/classroom/tests/migrations.test.ts.
alter table public.learner_model alter column version set default 4;

-- 0013 named the cursor (learning_session.started_at, seq). From version 4
-- think() orders and times every sitting on the server's clock, so the time
-- half is the session's received_at.
comment on column public.learner_model.folded_through_at is
  'received_at of the last learning_session the server fold read (think.ts); with folded_through_seq, the cursor.';
