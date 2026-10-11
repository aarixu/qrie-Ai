-- THE QUESTIONS EACH OUTCOME WAS ASKED BY (lam-one-brain Task 16).
--
-- A node of the outcome map may now hold several questions (its first, and a
-- retest, a review or a transfer question; packages/knowledge-graph
-- probes.ts). A review should ask one the learner has not answered, so
-- learner-model version 6 keeps, per outcome, the item keys of the latest
-- questions its answers were to (`askedItems`, packages/learner-model
-- types.ts): at most 8, each at most 256 characters, the latest last.
--
-- 1. concept_state.asked_items: a jsonb array, empty by default (what
--    emptyConceptState holds), under 4 KB. think() writes it with every
--    other ConceptState field; my_learner_model (0109) hands it back through
--    to_jsonb(cs), so the phone's model read from the server has it too.
--    Students read their rows and write none, as before (0013).
-- 2. The learner_model version default moves to 6, the version the server
--    fold writes. think() rebuilds every learner whose snapshot is of
--    another version, which fills asked_items from the ledger it still holds.

alter table public.concept_state
  add column if not exists asked_items jsonb not null default '[]'::jsonb;

alter table public.concept_state
  add constraint concept_state_asked_items_shape
  check (jsonb_typeof(asked_items) = 'array' and octet_length(asked_items::text) <= 4096);

-- The model version the server writes (packages/learner-model MODEL_VERSION),
-- asserted equal by apps/classroom/tests/migrations.test.ts.
alter table public.learner_model alter column version set default 6;
