-- A TEST'S TIME ON TASK HAS A CEILING (lam-one-brain, review of phase 2).
--
-- 0114 timed a test from the child's start (lms.test_start) to the hand-in,
-- never past the test's end (lms.test_ends_at). A test with no time limit
-- ends at its due time, which has no cap, so a test started weeks before it
-- was handed in gave a span past 2^31 ms: `spent::integer` raised "integer
-- out of range" and the hand-in failed (and lms.finalize_tests, which hands
-- in through this same function, left that child's test ungraded). Below
-- that, a test started on Monday and handed in on Friday counted four days
-- as time on task.
--
-- Now a test's time is also at most its time limit, or three hours (homework's
-- ceiling, 0114) when it has none. The limit is at most 300 minutes (0029),
-- so the time always fits an integer. Everything else is 0114's grade_mcq
-- unchanged; `create or replace` keeps its grants (service_role only).

-- 0114's grading, with a test's time on task capped (above).
create or replace function lms.grade_mcq(p_assignment uuid, p_student uuid, p_answers jsonb, p_active_ms integer default null)
returns table (submission_id uuid, correct integer, total integer)
language plpgsql
security definer
set search_path = public, lms
as $$
declare
  a lms.assignment;
  it lms.item;
  answers jsonb;
  k text;
  v jsonb;
  chosen smallint;
  is_right boolean;
  n_attempt smallint;
  sid uuid;
  session uuid := gen_random_uuid();
  src text;
  n_correct integer := 0;
  n_total integer := 0;
  n_seq integer := 0;
  since timestamptz;
  started timestamptz;
  spent bigint;
begin
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or a.published_at is null or not exists (
    select 1 from lms.enrolment e
     where e.section_id = a.section_id and e.student_user_id = p_student and e.left_on is null
  ) then
    raise exception 'this is not your homework';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must map each item id to the option chosen';
  end if;
  answers := p_answers;
  if a.kind = 'test' then
    answers := coalesce((
      select jsonb_object_agg(ta.item_id::text, ta.chosen_index)
        from lms.test_answer ta
       where ta.assignment_id = a.id and ta.student_user_id = p_student
    ), '{}'::jsonb) || p_answers;
  end if;
  for k in select jsonb_object_keys(answers) loop
    if not exists (
      select 1 from lms.assignment_item ai where ai.assignment_id = a.id and ai.item_id::text = k
    ) then
      raise exception 'item % is not on this assignment', k;
    end if;
  end loop;

  select coalesce(max(s.attempt), 0) + 1, max(s.submitted_at) into n_attempt, since
    from lms.submission s
   where s.assignment_id = a.id and s.student_user_id = p_student and s.kind = 'mcq';
  if n_attempt > a.attempts_allowed then
    raise exception 'no attempts left for this homework';
  end if;
  -- Time on task starts no earlier than the work was published, nor than
  -- this child's previous hand-in of it.
  since := greatest(a.published_at, since);

  insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, late)
  values (a.org_id, a.id, p_student, 'mcq', n_attempt, now() > a.due_at)
  returning id into sid;

  src := case when a.kind = 'test' then 'test' else 'homework' end;
  if a.kind = 'test' then
    select greatest(ts.started_at, since) into started from lms.test_start ts
     where ts.assignment_id = a.id and ts.student_user_id = p_student;
    if started is not null then
      spent := least(
        greatest(0, floor(extract(epoch from (least(now(), lms.test_ends_at(a, started)) - started)) * 1000))::bigint,
        coalesce(a.time_limit_minutes, 180) * 60000::bigint);
    end if;
  elsif p_active_ms is not null and p_active_ms > 0 then
    spent := least(p_active_ms::bigint, 3 * 3600 * 1000::bigint,
                   greatest(0, floor(extract(epoch from (now() - since)) * 1000))::bigint);
    started := now() - make_interval(secs => spent / 1000.0);
  end if;
  insert into public.learning_session (id, org_id, user_id, source, started_at, ended_at, active_ms)
  values (session, a.org_id, p_student, src, coalesce(started, now()), now(), spent::integer);

  for it in
    select i.* from lms.assignment_item ai join lms.item i on i.id = ai.item_id
     where ai.assignment_id = a.id and i.kind = 'mcq'
     order by ai.position
  loop
    v := answers -> it.id::text;
    chosen := null;
    if v is not null and jsonb_typeof(v) <> 'null' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^\d+$'
         or (v #>> '{}')::integer >= jsonb_array_length(it.options) then
        raise exception 'item % has no option %', it.id, v #>> '{}';
      end if;
      chosen := (v #>> '{}')::smallint;
    end if;
    is_right := chosen is not null and chosen = it.correct_index;
    n_total := n_total + 1;
    if is_right then
      n_correct := n_correct + 1;
    end if;

    insert into lms.submission_answer (submission_id, item_id, chosen_index, correct)
    values (sid, it.id, chosen, is_right);

    n_seq := n_seq + 1;
    insert into public.ledger_event
      (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
    values (
      gen_random_uuid(), a.org_id, p_student, session, n_seq, now(), 'answered', src, 'tap', it.outcome_ids,
      jsonb_build_object(
        'correct', is_right,
        'chosenIndex', chosen,
        'itemId', it.id,
        'assignmentId', a.id,
        'submissionId', sid,
        'attempt', n_attempt,
        -- Rung 0: the product gave no help (0024).
        'assistanceRung', 0
      )
    );
  end loop;

  insert into lms.mark (submission_id, machine_correct, machine_total)
  values (sid, n_correct, n_total);

  return query select sid, n_correct, n_total;
end;
$$;
