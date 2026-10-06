-- HANDED IN ONCE, HOWEVER OFTEN THE PHONE SENDS IT.
--
-- On patchy data a hand-in can reach the school while its answer never
-- reaches the phone, which then sends it again (apps/student's outbox). Each
-- hand-in now carries a key the phone made for it. The same key from the
-- same child for the same work is the same hand-in: the second call answers
-- as the first did — the same submission, the same score (on a test, none
-- until results are released, 0029) — and makes no second attempt. A key a
-- child used for other work is refused. A hand-in without a key works as it
-- did before.
--
-- Written against packages/lms-client/tests/hand-in-once.test.ts, first.

alter table lms.submission add column if not exists hand_in_key uuid;
create unique index if not exists submission_hand_in_key
  on lms.submission (student_user_id, hand_in_key) where hand_in_key is not null;

-- The caller's earlier hand-in with this key, if any; refused when it was for
-- other work. Internal.
create or replace function lms.handed_in_with(p_key uuid, p_assignment uuid)
returns lms.submission
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  found lms.submission;
begin
  if p_key is null then
    raise exception 'a hand-in needs its key';
  end if;
  select * into found from lms.submission s where s.student_user_id = auth.uid() and s.hand_in_key = p_key;
  if found.id is not null and found.assignment_id <> p_assignment then
    raise exception 'that hand-in was for other work';
  end if;
  return found;
end;
$$;

create or replace function lms.submit_mcq_once(p_assignment uuid, p_answers jsonb, p_key uuid)
returns table (submission_id uuid, correct integer, total integer)
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  earlier lms.submission := lms.handed_in_with(p_key, p_assignment);
  r record;
begin
  if earlier.id is not null then
    return query
      select earlier.id,
             case when a.kind = 'test' then null else (select count(*) filter (where sa.correct)::int
                                                         from lms.submission_answer sa where sa.submission_id = earlier.id) end,
             case when a.kind = 'test' then null else (select count(*)::int
                                                         from lms.submission_answer sa where sa.submission_id = earlier.id) end
        from lms.assignment a where a.id = p_assignment;
    return;
  end if;
  select * into r from lms.submit_mcq(p_assignment, p_answers);
  -- Two copies sent at once: the second meets the unique key and is undone,
  -- and its retry then finds the first.
  update lms.submission set hand_in_key = p_key where id = r.submission_id;
  return query select r.submission_id, r.correct, r.total;
end;
$$;

create or replace function lms.submit_photos_once(p_assignment uuid, p_paths text[], p_key uuid)
returns uuid
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  earlier lms.submission := lms.handed_in_with(p_key, p_assignment);
  sid uuid;
begin
  if earlier.id is not null then
    return earlier.id;
  end if;
  sid := lms.submit_photos(p_assignment, p_paths);
  update lms.submission set hand_in_key = p_key where id = sid;
  return sid;
end;
$$;

revoke all on function lms.handed_in_with(uuid, uuid) from public, anon, authenticated;
revoke all on function lms.submit_mcq_once(uuid, jsonb, uuid) from public, anon;
revoke all on function lms.submit_photos_once(uuid, text[], uuid) from public, anon;
grant execute on function lms.handed_in_with(uuid, uuid) to service_role;
grant execute on function lms.submit_mcq_once(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function lms.submit_photos_once(uuid, text[], uuid) to authenticated, service_role;
