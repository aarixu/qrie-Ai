-- THE TWO COLUMNS THE EVIDENCE GATE READS, MISSING FROM 0013.
--
-- `evidenceSet` (packages/learner-model/src/project.ts) decides which outcomes
-- the model is entitled to an opinion about by reading `answerObservations`
-- and `doubtCount` — answers, and raised hands: the two kinds of evidence that
-- could have LOWERED belief. 0013 shipped `concept_state` without either
-- column, so a server-side fold persisting a ConceptState through this table
-- and reloading it would silently lose the gate: every outcome would come back
-- looking untouched, and the 0.46 defect — a difficulty prior read as a
-- measurement — walks back in through the round-trip.
--
-- Found by the 2026-09-16 audit and fixed BEFORE any server fold exists to be
-- bitten by it. Defaults are 0 because that is what emptyConceptState holds,
-- and a backfilled 0 is honest: no row in this table predates the fold that
-- would have counted these.

alter table public.concept_state
  add column if not exists answer_observations integer not null default 0;
alter table public.concept_state
  add column if not exists doubt_count integer not null default 0;
