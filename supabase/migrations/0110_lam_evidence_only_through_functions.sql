-- A PHONE WRITES EVIDENCE ONLY THROUGH THE SERVER'S FUNCTIONS (lam-one-brain
-- Task 7b; review SF2).
--
-- 0107 gave the tutor one door, public.record_evidence, which takes the org
-- and the learner from the token, the time from the server, and only the
-- tutor's sources. The old door stayed open so a classroom build that still
-- inserted kept working while the new one rolled out: a student's token could
-- insert into public.ledger_event and public.learning_session directly under
-- the 0006/0034 policies, with its own source ('api' included), its own clock
-- and any org it belongs to. This closes it.
--
-- After this, anon and authenticated can neither insert, update, delete nor
-- truncate either table, and anon cannot read them either; a signed-in learner
-- still reads their own rows under the 0006 select policies. The writers left
-- are the service role, the database owner, and the security definer
-- functions that write as the owner: record_evidence and
-- close_learning_session (0107), the LMS's hand-in, test and practice
-- functions (0024, 0030, 0104) and the nightly purge (0102).
--
-- The two "append your own" insert policies (0006, 0034) are dropped: with
-- no insert grant they could never pass anyone, and leaving them would read
-- as if a phone may still append.
--
-- Rollout: deploy the classroom build that sends through record_evidence
-- (Task 7a) first, and push this only once that build is live; an older
-- build's direct inserts are refused from here on, and its outbox keeps
-- retrying them (docs/ops/runbook.md, "The brain").

revoke all on public.ledger_event from anon;
revoke all on public.learning_session from anon;
revoke insert, update, delete, truncate on public.ledger_event from authenticated;
revoke insert, update, delete, truncate on public.learning_session from authenticated;

drop policy if exists "append your own events" on public.ledger_event;
drop policy if exists "append your own sessions" on public.learning_session;
