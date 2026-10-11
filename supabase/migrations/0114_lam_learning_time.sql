-- THE BRIEF'S METRIC, INSIDE THE SYSTEM (lam-one-brain Task 14).
--
-- The brain (packages/lms-brain think.ts) now works out, per learner,
-- unassisted gain per learning minute: each sitting's unassisted gain
-- (packages/learner-model metric.ts) over the time on task the server holds
-- for it, learning_session.active_ms. It writes the figures to
-- learner_model.metrics. No screen shows them.
--
-- A tutor sitting's time on task already comes from close_learning_session,
-- bounded by the sitting (0107). A hand-in's had none: lms.grade_mcq opened
-- its sitting with no active_ms. Now:
--
--   * a TEST's time is the server's own: from the child's start of the test
--     (lms.test_start) to the hand-in, never past the test's end
--     (lms.test_ends_at), and from no earlier than their previous hand-in of
--     it. What the phone sends is not used.
--   * HOMEWORK has no start the server saw, so the phone may send the time
--     the child spent with the hand-in (p_active_ms, optional). It is kept to
--     at most three hours and to the time since the work was published or
--     since the child's previous hand-in of it, whichever is later. None
--     sent, or not above zero, records none: an older build hands in as
--     before, and the brain counts that hand-in's gain apart from the ratio
--     rather than guess its minutes.
--
-- The hand-in's sitting then spans its time on task (started_at = the end
-- minus it), as 0107 keeps a tutor sitting.
--
-- Closing a sitting now also queues the learner for the brain, so the metric
-- takes the sitting's time without waiting for the next answer.
--
-- Practice (lms.check_practice_answer) still records no time on task.

alter table public.learner_model
  -- {"gain", "learningMinutes", "gainPerMinute" (null when no minutes),
  --  "untimedGain", "openSittings"}: packages/learner-model metric.ts
  -- LearningMetric, as think() last wrote it. The tally it comes from is kept
  -- in snapshot.metric. A learner reads their own row (0013); the lms
  -- functions do not read this column.
  add column if not exists metrics jsonb;

drop function if exists lms.submit_mcq_once(uuid, jsonb, uuid);
drop function if exists lms.submit_mcq(uuid, jsonb);
drop function if exists lms.grade_mcq(uuid, uuid, jsonb);

-- 0030's grading, with the hand-in's time on task (above).
create function lms.grade_mcq(p_assignment uuid, p_student uuid, p_answers jsonb, p_active_ms integer default null)
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
      spent := greatest(0, floor(extract(epoch from (least(now(), lms.test_ends_at(a, started)) - started)) * 1000))::bigint;
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

-- The child's hand-in: 0030's, with the optional time on task.
create function lms.submit_mcq(p_assignment uuid, p_answers jsonb, p_active_ms integer default null)
returns table (submission_id uuid, correct integer, total integer)
language plpgsql
security definer
set search_path = public, lms
as $$
declare
  me uuid := auth.uid();
  a lms.assignment;
  r record;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or a.published_at is null or not lms.in_section(a.section_id) then
    raise exception 'this is not your homework';
  end if;
  select * into r from lms.grade_mcq(p_assignment, me, p_answers, p_active_ms);
  -- A test's score reaches the child only when the teacher releases it (0029).
  if a.kind = 'test' then
    return query select r.submission_id, null::integer, null::integer;
  else
    return query select r.submission_id, r.correct, r.total;
  end if;
end;
$$;

-- 0044's, with the optional time on task. A resend answers as the first
-- hand-in did and records nothing, its time included.
create function lms.submit_mcq_once(p_assignment uuid, p_answers jsonb, p_key uuid, p_active_ms integer default null)
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
  select * into r from lms.submit_mcq(p_assignment, p_answers, p_active_ms);
  -- Two copies sent at once: the second meets the unique key and is undone,
  -- and its retry then finds the first.
  update lms.submission set hand_in_key = p_key where id = r.submission_id;
  return query select r.submission_id, r.correct, r.total;
end;
$$;

revoke all on function lms.grade_mcq(uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function lms.grade_mcq(uuid, uuid, jsonb, integer) to service_role;
revoke all on function lms.submit_mcq(uuid, jsonb, integer) from public, anon;
grant execute on function lms.submit_mcq(uuid, jsonb, integer) to authenticated, service_role;
revoke all on function lms.submit_mcq_once(uuid, jsonb, uuid, integer) from public, anon;
grant execute on function lms.submit_mcq_once(uuid, jsonb, uuid, integer) to authenticated, service_role;

-- 0107's close, which now also queues the learner for the brain when it
-- closes their sitting (the brain_queue trigger, 0108, fires only on a new
-- answer).
create or replace function public.close_learning_session(
  p_session uuid,
  p_ended_at timestamptz,
  p_active_ms integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_active_ms is null or p_active_ms < 0 then
    raise exception 'close_learning_session: p_active_ms must be a non-negative count of milliseconds, got %', p_active_ms
      using errcode = '22023';
  end if;

  update public.learning_session s
     set ended_at = b.ended_at,
         active_ms = greatest(0, least(p_active_ms::bigint,
                       floor(extract(epoch from (b.ended_at - s.started_at)) * 1000)::bigint))::integer
    from (select ls.id,
                 least(greatest(coalesce(p_ended_at, now()), ls.started_at), now() + interval '5 minutes') as ended_at
            from public.learning_session ls
           where ls.id = p_session) b
   where s.id = b.id
     and s.user_id = auth.uid()
     and s.ended_at is null;

  if found then
    insert into public.brain_queue (user_id) values (auth.uid())
    on conflict (user_id) do update
      set ticket = nextval('public.brain_queue_ticket'), attempts = 0, last_error = null;
  end if;
end;
$$;

revoke all on function public.close_learning_session(uuid, timestamptz, integer) from public;
revoke all on function public.close_learning_session(uuid, timestamptz, integer) from anon;
grant execute on function public.close_learning_session(uuid, timestamptz, integer) to authenticated;
