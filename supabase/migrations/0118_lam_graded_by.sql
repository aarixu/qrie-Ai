-- WHO GRADED AN ANSWER IS THE LEDGER'S OWN COLUMN (lam-one-brain, P2 security
-- review F1).
--
-- Until now the brain (learner-model serverGraded) trusted an answer as the
-- server's by fields a phone could write: the source ('homework', 'test',
-- 'practice', and 'api', which nothing of the server writes), or
-- `payload.graded = 'server'`. Until 0110 a student's token could insert
-- ledger rows directly under the 0006/0034 policies, and 0107/0111 stored a
-- tutor payload as sent, so rows already in the ledger can carry any of
-- them. A model version change rebuilds every learner from the whole ledger,
-- which would have counted those rows toward "mastered" and the teacher's
-- figures on their own.
--
-- 1. public.ledger_event.graded_by, 'phone' or 'server', not null, default
--    'phone': every row already here starts as the phone's. No API role can
--    insert or update ledger_event after 0110, so only the owner, the service
--    role and the security definer functions below can set it.
-- 2. 'server' only where this migration can prove it:
--    * a homework or test answer that lms.submission_answer holds for the
--      same child (payload submissionId and itemId), the first such row per
--      answer, with `correct` and `chosenIndex` taken from that answer;
--    * a tutor answer (class, quiz, diagnostic, doubt) naming a library probe
--      with a numeric chosenIndex, graded again by 0115's rule against
--      lms.item: `correct`, `verdict` (when sent), the option's
--      misconceptionId (or none), the item's outcomes, `graded: 'server'`;
--    * a practice answer in a practice sitting of the same child, naming an
--      lms.item with a key and a whole-number chosenIndex among its options,
--      graded again against that key.
--    Everything else stays 'phone': 'api' rows, a homework row no submission
--    holds, a copy of one that does, and an answer whose regraded payload
--    would pass 0021's 4096 bytes. A tutor answer left as the phone's says
--    `graded: 'phone'` in its payload (or none, if that would not fit).
-- 3. record_evidence (0115's), lms.grade_mcq (0117's) and
--    lms.check_practice_answer (0104's) write graded_by themselves:
--    record_evidence 'server' exactly when it graded the answer against the
--    key, the LMS's two 'server'. record_evidence also drops `graded` from a
--    payload that is not an answer. Nothing else in them changes, and
--    `create or replace` keeps their grants.
-- 4. A receipt time in the future (ledger_event.received_at and
--    learning_session.received_at, plain defaults a direct insert could set)
--    is pulled back to now(), and `graded` is dropped from every payload
--    that is not an answer.
-- 5. learner_model.version defaults to 7 (packages/learner-model
--    MODEL_VERSION): think.ts reads graded_by, so the server rebuilds every
--    learner (the settle pass queues any snapshot of another version).
--
-- What this does not undo: a sitting's received_at a direct insert set in the
-- past cannot be told from a real one. It no longer earns anything verified,
-- because its answers are the phone's.

alter table public.ledger_event
  add column if not exists graded_by text not null default 'phone'
    constraint ledger_event_graded_by check (graded_by in ('phone', 'server'));

-- The model version the server writes (packages/learner-model MODEL_VERSION),
-- asserted equal by apps/classroom/tests/migrations.test.ts.
alter table public.learner_model alter column version set default 7;

-- 2. Homework and tests: the first ledger row per answer lms.submission_answer
-- holds for the same child.
with proved as (
  select distinct on (e.user_id, sa.submission_id, sa.item_id)
         e.id, e.payload || jsonb_build_object('correct', sa.correct, 'chosenIndex', sa.chosen_index) as payload
    from public.ledger_event e
    join lms.submission_answer sa
      on sa.submission_id = case when e.payload ->> 'submissionId'
                                      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                 then (e.payload ->> 'submissionId')::uuid end
     and sa.item_id = case when e.payload ->> 'itemId'
                                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then (e.payload ->> 'itemId')::uuid end
    join lms.submission s on s.id = sa.submission_id and s.student_user_id = e.user_id
   where e.kind = 'answered' and e.source in ('homework', 'test')
   order by e.user_id, sa.submission_id, sa.item_id, e.received_at, e.id
)
update public.ledger_event e
   set graded_by = 'server', payload = p.payload
  from proved p
 where e.id = p.id and octet_length(p.payload::text) <= 4096;

-- 2. Tutor answers to a library probe, graded again by 0115's rule.
with asked as (
  select e.id, e.payload, i.correct_index, i.misconceptions, i.outcome_ids,
         case when jsonb_typeof(e.payload -> 'chosenIndex') = 'number' then (e.payload -> 'chosenIndex')::numeric end
           as chosen
    from public.ledger_event e
    join lms.item i
      on i.library_ref = case when jsonb_typeof(e.payload -> 'probeId') = 'string' then e.payload ->> 'probeId' end
   where e.kind = 'answered' and e.source in ('class', 'quiz', 'diagnostic', 'doubt')
     and i.kind = 'mcq' and i.correct_index is not null
),
marked as (
  select a.id, a.outcome_ids, a.payload, a.chosen = a.correct_index as right_answer,
         case when a.chosen <> a.correct_index and jsonb_typeof(a.misconceptions) = 'array'
                   and a.chosen = trunc(a.chosen) and a.chosen between 0 and jsonb_array_length(a.misconceptions) - 1
              then nullif(btrim(a.misconceptions ->> (a.chosen::int)), '') end as label
    from asked a
   where a.chosen is not null
),
regraded as (
  select m.id, m.outcome_ids,
         (m.payload - 'misconceptionId' - 'verdict')
           || jsonb_build_object('correct', m.right_answer, 'graded', 'server')
           || case when m.payload ? 'verdict'
                   then jsonb_build_object('verdict', case when m.right_answer then 'right' else 'wrong' end)
                   else '{}'::jsonb end
           || case when m.label is not null then jsonb_build_object('misconceptionId', m.label) else '{}'::jsonb end
           as payload
    from marked m
)
update public.ledger_event e
   set graded_by = 'server',
       payload = r.payload,
       outcome_ids = case when cardinality(r.outcome_ids) > 0 then r.outcome_ids else e.outcome_ids end
  from regraded r
 where e.id = r.id and octet_length(r.payload::text) <= 4096;

-- 2. Practice answers in the child's own practice sitting, graded again
-- against their item's key.
with practised as (
  select e.id, e.payload, i.correct_index, jsonb_array_length(i.options) as options,
         case when jsonb_typeof(e.payload -> 'chosenIndex') = 'number' and (e.payload ->> 'chosenIndex') ~ '^\d{1,4}$'
              then (e.payload ->> 'chosenIndex')::int end as chosen
    from public.ledger_event e
    join public.learning_session ls on ls.id = e.session_id and ls.user_id = e.user_id and ls.source = 'practice'
    join lms.item i
      on i.id = case when e.payload ->> 'itemId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     then (e.payload ->> 'itemId')::uuid end
   where e.kind = 'answered' and e.source = 'practice'
     and i.kind = 'mcq' and i.correct_index is not null
),
regraded as (
  select p.id, p.payload || jsonb_build_object('correct', p.chosen = p.correct_index) as payload
    from practised p
   where p.chosen is not null and p.chosen < p.options
)
update public.ledger_event e
   set graded_by = 'server', payload = r.payload
  from regraded r
 where e.id = r.id and octet_length(r.payload::text) <= 4096;

-- A tutor answer left as the phone's says so, over whatever it claimed.
update public.ledger_event
   set payload = case when octet_length((payload || '{"graded": "phone"}'::jsonb)::text) <= 4096
                      then payload || '{"graded": "phone"}'::jsonb
                      else payload - 'graded' end
 where kind = 'answered' and source in ('class', 'quiz', 'diagnostic', 'doubt') and graded_by = 'phone'
   and payload ->> 'graded' is distinct from 'phone';

-- 4. Only an answer carries a grade, and nothing was received in the future.
update public.ledger_event set payload = payload - 'graded' where kind <> 'answered' and payload ? 'graded';
update public.ledger_event set received_at = now() where received_at > now();
update public.learning_session set received_at = now() where received_at > now();

-- 3. The writers.

-- 0115's, writing graded_by (above).
create or replace function public.record_evidence(p_sessions jsonb, p_events jsonb)
returns table (id text, status text, reason text, received_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  org uuid;
  lo constant timestamptz := now() - interval '7 days';
  hi constant timestamptz := now() + interval '5 minutes';
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  tutor constant text[] := array['class', 'quiz', 'diagnostic', 'doubt'];
  e jsonb;
  s jsonb;
  v_id text;
  v_reason text;
  v_status text;
  v_received timestamptz;
  v_at timestamptz;
  v_started timestamptz;
  v_source text;
  v_payload jsonb;
  v_outcomes text[];
  v_owner uuid;
  v_rung jsonb;
  v_key smallint;
  v_labels jsonb;
  v_item_outcomes text[];
  v_right boolean;
  v_label text;
  v_graded text;
  n integer;
begin
  if me is null then
    raise exception 'record_evidence: not signed in' using errcode = '42501';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'record_evidence: p_events must be a list of events' using errcode = '22023';
  end if;
  if p_sessions is not null and jsonb_typeof(p_sessions) not in ('array', 'null') then
    raise exception 'record_evidence: p_sessions must be a list of sittings' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'record_evidence: at most 500 events in one call, got %', jsonb_array_length(p_events)
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_sessions) = 'array' and jsonb_array_length(p_sessions) > 500 then
    raise exception 'record_evidence: at most 500 sittings in one call, got %', jsonb_array_length(p_sessions)
      using errcode = '22023';
  end if;

  org := public.current_org_id();
  if org is null then
    raise exception 'record_evidence: no organization yet' using errcode = '42501';
  end if;

  for e in select x.value from jsonb_array_elements(p_events) as x(value) loop
    v_id := case when jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'id') = 'string' then e ->> 'id' end;
    v_status := 'refused';
    v_reason := null;
    v_received := null;
    v_item_outcomes := null;
    v_graded := 'phone';

    begin
      v_at := null;
      if jsonb_typeof(e -> 'at') = 'string' then
        begin
          v_at := (e ->> 'at')::timestamptz;
        exception when others then
          v_at := null;
        end;
      end if;
      v_payload := case when e -> 'payload' is null or jsonb_typeof(e -> 'payload') = 'null' then '{}'::jsonb
                        else e -> 'payload' end;

      if jsonb_typeof(e) <> 'object' or v_id is null or v_id !~* uuid_re then
        v_reason := 'bad-id';
      elsif jsonb_typeof(e -> 'sessionId') is distinct from 'string' or (e ->> 'sessionId') !~* uuid_re then
        v_reason := 'bad-session';
      elsif (case when jsonb_typeof(e -> 'seq') is distinct from 'number' then true
                  else (e -> 'seq')::numeric <> trunc((e -> 'seq')::numeric)
                    or (e -> 'seq')::numeric not between 0 and 2147483647 end) then
        v_reason := 'bad-seq';
      elsif (e ->> 'kind') is null or (e ->> 'kind') not in (
          'session-started', 'session-ended', 'asked', 'answered', 'helped',
          'taught', 'confused', 'intervened', 'reflected') then
        v_reason := 'bad-kind';
      elsif (e ->> 'source') is null or not ((e ->> 'source') = any (tutor)) then
        v_reason := 'source';
      elsif (e ->> 'surface') is null or (e ->> 'surface') not in ('tap', 'voice', 'text') then
        v_reason := 'bad-surface';
      elsif v_at is null then
        v_reason := 'bad-at';
      elsif e -> 'outcomeIds' is not null and jsonb_typeof(e -> 'outcomeIds') <> 'null'
        and (jsonb_typeof(e -> 'outcomeIds') <> 'array'
             or jsonb_array_length(e -> 'outcomeIds') > 32
             or exists (select 1 from jsonb_array_elements(e -> 'outcomeIds') o(v)
                         where jsonb_typeof(o.v) <> 'string' or char_length(o.v #>> '{}') > 200)) then
        v_reason := 'bad-outcomes';
      elsif jsonb_typeof(e -> 'topicRef') = 'string' and char_length(e ->> 'topicRef') > 200 then
        v_reason := 'bad-topic';
      elsif jsonb_typeof(v_payload) <> 'object' then
        v_reason := 'bad-payload';
      elsif octet_length(v_payload::text) > 4096 then
        v_reason := 'too-big';
      elsif char_length(coalesce(v_payload ->> 'answerNormalised', '')) > 200 then
        v_reason := 'answer-too-long';
      else
        -- The help rung, wherever the event carries one: a whole number on the
        -- ladder (packages/ledger AssistanceRung, 0 to 8).
        foreach v_rung in array array[v_payload -> 'assistanceRung', v_payload -> 'rung'] loop
          if v_rung is not null and (case when jsonb_typeof(v_rung) <> 'number' then true
                                          else v_rung::numeric <> trunc(v_rung::numeric)
                                            or v_rung::numeric not between 0 and 8 end) then
            v_reason := 'bad-rung';
          end if;
        end loop;
      end if;

      -- C2 (0115): an answer to a question the server holds is graded by the
      -- server. A bank probe (lms.item.library_ref) with an option chosen:
      -- `correct` is the key's verdict, `verdict` (when sent) follows it, a
      -- wrong answer's misconceptionId is the bank's label for that option (or
      -- none), the outcomes are the item's, and `graded` is 'server'. Every
      -- other answer keeps what the phone sent and says `graded: 'phone'`.
      -- 0118: the same word goes in ledger_event.graded_by, which is what the
      -- brain reads; an event that is not an answer carries no grade at all.
      if v_reason is null and (e ->> 'kind') <> 'answered' then
        v_payload := v_payload - 'graded';
      end if;
      if v_reason is null and (e ->> 'kind') = 'answered' then
        v_key := null;
        if jsonb_typeof(v_payload -> 'probeId') = 'string' and jsonb_typeof(v_payload -> 'chosenIndex') = 'number' then
          select i.correct_index, i.misconceptions, i.outcome_ids into v_key, v_labels, v_item_outcomes
            from lms.item i
           where i.library_ref = v_payload ->> 'probeId' and i.kind = 'mcq' and i.correct_index is not null;
        end if;
        if v_key is not null then
          v_right := (v_payload -> 'chosenIndex')::numeric = v_key;
          v_label := case
            when not v_right and jsonb_typeof(v_labels) = 'array'
             and (v_payload -> 'chosenIndex')::numeric = trunc((v_payload -> 'chosenIndex')::numeric)
             and (v_payload -> 'chosenIndex')::numeric between 0 and jsonb_array_length(v_labels) - 1
            then nullif(btrim(v_labels ->> ((v_payload -> 'chosenIndex')::int)), '')
          end;
          v_payload := (v_payload - 'misconceptionId' - 'verdict')
            || jsonb_build_object('correct', v_right, 'graded', 'server')
            || case when v_payload ? 'verdict'
                    then jsonb_build_object('verdict', case when v_right then 'right' else 'wrong' end)
                    else '{}'::jsonb end
            || case when v_label is not null then jsonb_build_object('misconceptionId', v_label) else '{}'::jsonb end;
          v_graded := 'server';
        else
          v_item_outcomes := null;
          v_payload := v_payload || jsonb_build_object('graded', 'phone');
        end if;
        -- The grade is part of the payload the ledger bounds (0021).
        if octet_length(v_payload::text) > 4096 then
          v_reason := 'too-big';
        end if;
      end if;

      if v_reason is null then
        select le.user_id, le.received_at into v_owner, v_received
          from public.ledger_event le where le.id = v_id::uuid;
        if found then
          if v_owner = me then
            v_status := 'duplicate';
          else
            v_reason := 'id-taken';
            v_received := null;
          end if;
        end if;
      end if;

      if v_reason is null and v_status <> 'duplicate' then
        v_at := least(greatest(v_at, lo), hi);
        v_outcomes := case when jsonb_typeof(e -> 'outcomeIds') = 'array'
                           then array(select jsonb_array_elements_text(e -> 'outcomeIds'))
                           else '{}'::text[] end;
        if cardinality(v_item_outcomes) > 0 then
          v_outcomes := v_item_outcomes;
        end if;

        -- The sitting: the caller's, or made now from what was sent about it.
        select ls.user_id into v_owner from public.learning_session ls where ls.id = (e ->> 'sessionId')::uuid;
        if not found then
          select x.value into s
            from jsonb_array_elements(coalesce(nullif(p_sessions, 'null'::jsonb), '[]'::jsonb)) as x(value)
           where jsonb_typeof(x.value) = 'object' and x.value ->> 'id' = e ->> 'sessionId'
           limit 1;
          if not found then
            s := '{}'::jsonb;
          end if;
          v_source := coalesce(case when jsonb_typeof(s -> 'source') = 'string' then s ->> 'source' end, e ->> 'source');
          v_started := null;
          if jsonb_typeof(s -> 'startedAt') = 'string' then
            begin
              v_started := (s ->> 'startedAt')::timestamptz;
            exception when others then
              v_started := null;
            end;
          end if;
          v_started := least(greatest(coalesce(v_started, v_at), lo), hi);

          if not (v_source = any (tutor)) then
            v_reason := 'source';
          elsif jsonb_typeof(s -> 'topicRef') = 'string' and char_length(s ->> 'topicRef') > 200 then
            v_reason := 'bad-topic';
          else
            insert into public.learning_session (id, org_id, user_id, source, topic_ref, started_at)
            values (
              (e ->> 'sessionId')::uuid, org, me, v_source,
              coalesce(case when jsonb_typeof(s -> 'topicRef') = 'string' then s ->> 'topicRef' end,
                       case when jsonb_typeof(e -> 'topicRef') = 'string' then e ->> 'topicRef' end),
              v_started)
            on conflict do nothing;
            select ls.user_id into v_owner from public.learning_session ls where ls.id = (e ->> 'sessionId')::uuid;
          end if;
        end if;

        if v_reason is null and v_owner is distinct from me then
          v_reason := 'not-your-session';
        end if;

        if v_reason is null then
          insert into public.ledger_event
            (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, topic_ref, payload,
             graded_by)
          values (
            v_id::uuid, org, me, (e ->> 'sessionId')::uuid, (e ->> 'seq')::integer, v_at, now(),
            e ->> 'kind', e ->> 'source', e ->> 'surface', v_outcomes,
            case when jsonb_typeof(e -> 'topicRef') = 'string' then e ->> 'topicRef' end,
            v_payload, v_graded)
          on conflict do nothing
          returning ledger_event.received_at into v_received;
          get diagnostics n = row_count;
          if n = 1 then
            v_status := 'recorded';
          else
            -- Not this id (checked above), so this place in the sitting.
            v_reason := 'seq-taken';
            v_received := null;
          end if;
        end if;
      end if;
    exception when others then
      -- A refusal this function did not foresee is still one event's, never
      -- the call's. Whatever this event wrote is rolled back with it.
      v_status := 'refused';
      v_reason := 'error-' || sqlstate;
      v_received := null;
    end;

    if v_reason is not null then
      v_status := 'refused';
      v_received := null;
    end if;
    id := coalesce(v_id, '');
    status := v_status;
    reason := v_reason;
    received_at := v_received;
    return next;
  end loop;
end;
$$;


revoke all on function public.record_evidence(jsonb, jsonb) from public;
revoke all on function public.record_evidence(jsonb, jsonb) from anon;
grant execute on function public.record_evidence(jsonb, jsonb) to authenticated;

-- 0117's grading, its answers marked as the server's.
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
      (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload, graded_by)
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
      ),
      'server'
    );
  end loop;

  insert into lms.mark (submission_id, machine_correct, machine_total)
  values (sid, n_correct, n_total);

  return query select sid, n_correct, n_total;
end;
$$;

-- 0104's, its answers marked as the server's.
create or replace function lms.check_practice_answer(p_session uuid, p_item uuid, p_chosen integer)
returns table (correct boolean, correct_index smallint, misconception text)
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  org uuid;
  it lms.item;
  right_answer boolean;
  n_seq integer;
  shown_before boolean;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select ls.user_id into owner from public.learning_session ls where ls.id = p_session;
  if owner is not null and owner <> me then
    raise exception 'this is not your practice';
  end if;
  if not exists (select 1 from lms.practice_pool(me) p where p.item_id = p_item) then
    raise exception 'that is not a practice question for you';
  end if;
  select * into it from lms.item where id = p_item;
  if p_chosen is null or p_chosen < 0 or p_chosen >= jsonb_array_length(it.options) then
    raise exception 'item % has no option %', p_item, p_chosen;
  end if;
  select sec.org_id into org from lms.enrolment e join lms.section sec on sec.id = e.section_id
   where e.student_user_id = me and e.left_on is null limit 1;
  if owner is null then
    insert into public.learning_session (id, org_id, user_id, source, started_at, ended_at)
    values (p_session, org, me, 'practice', now(), now());
  else
    update public.learning_session set ended_at = now() where id = p_session;
  end if;
  -- Practice shows the right option with every answer, and a past-due
  -- homework's review shows its right answers, so this child has been shown
  -- this question's answer if they have answered it before in either.
  shown_before := exists (
    select 1 from public.ledger_event le
     where le.user_id = me and le.source in ('homework', 'test', 'practice') and le.kind = 'answered'
       and le.payload ->> 'itemId' = it.id::text
  );
  right_answer := p_chosen = it.correct_index;
  select coalesce(max(le.seq), 0) + 1 into n_seq from public.ledger_event le where le.session_id = p_session;
  insert into public.ledger_event
    (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload, graded_by)
  values (
    gen_random_uuid(), org, me, p_session, n_seq, now(), 'answered', 'practice', 'tap', it.outcome_ids,
    jsonb_build_object(
      'correct', right_answer, 'chosenIndex', p_chosen, 'itemId', it.id,
      'assistanceRung', case when shown_before then 1 else 0 end
    ),
    'server'
  );
  return query select right_answer, it.correct_index,
    case when right_answer then null else nullif(btrim(it.misconceptions ->> p_chosen), '') end;
end;
$$;
