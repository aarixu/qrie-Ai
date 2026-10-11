-- THE SERVER GRADES THE TUTOR ANSWERS IT HAS A KEY FOR (lam-one-brain Task 15,
-- C2).
--
-- Since 0107 a tutor answer's `correct` was the phone's word: six "rights" a
-- phone claimed on questions it never asked lifted what a teacher read as the
-- child's own (truth test D04). The server holds the key of every library
-- question (lms.item.library_ref, loaded by tools/lms-library), and the quiz,
-- the placement check and the warm-up ask those questions by their bank id.
--
-- 1. public.record_evidence is 0111's function with one step added for every
--    `answered` event: a `probeId` the library holds and a `chosenIndex` give
--    `correct` from the item's key, `verdict` (when one was sent) to match, a
--    wrong answer's `misconceptionId` from the item's label for the option
--    chosen (dropped when it has none), the item's outcomes in place of the
--    ones the phone named, and `payload.graded = 'server'`. Every other answer
--    keeps what was sent and gets `graded = 'phone'`, over anything the phone
--    wrote there. A payload the grade pushes past 4096 bytes (0021's bound)
--    is refused 'too-big'. Nothing else changes.
-- 2. concept_state.verified_mastery and verified_observations (learner-model
--    version 5, packages/learner-model types.ts): the belief and count from
--    cold answers the server graded or the LMS marked. A phone-graded answer
--    still moves unassisted_mastery, which the lesson's decisions and
--    practice_for_me read; masteredAt and these columns count only the
--    server's. Defaults are emptyConceptState's, read as "nothing verified"
--    until think() rebuilds the learner (the version bump makes it).
-- 3. The school's figures "on their own" read the verified columns:
--    lms.my_progress, class_insights, student_chapters, practice_chapters,
--    student_subjects and school_classes (0105's bodies), school_overview
--    (0113's) and school_students (0112's), with only those reads changed.
--    Their columns keep their names. "With help" still averages the outcomes
--    answered with help (answer_observations > unassisted_observations): a
--    phone-graded cold answer is counted as an answer alone there, as it was.
--
-- Still open: this stops a phone, honest or buggy, from claiming a wrong
-- option as right; it does not stop forgery. Which option was chosen is still
-- the phone's word, and the key ships in the app, so a scripted token can
-- still answer bank questions right, asked or not (truth test
-- `D04 open: which option was chosen ...`). Closing this needs server-issued
-- asks (a nonce per question served) or keys kept off the client.

alter table public.concept_state
  add column if not exists verified_mastery real not null default 0.5,
  add column if not exists verified_observations integer not null default 0;

-- The model version the server writes (packages/learner-model MODEL_VERSION),
-- asserted equal by apps/classroom/tests/migrations.test.ts.
alter table public.learner_model alter column version set default 5;

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
            (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, topic_ref, payload)
          values (
            v_id::uuid, org, me, (e ->> 'sessionId')::uuid, (e ->> 'seq')::integer, v_at, now(),
            e ->> 'kind', e ->> 'source', e ->> 'surface', v_outcomes,
            case when jsonb_typeof(e -> 'topicRef') = 'string' then e ->> 'topicRef' end,
            v_payload)
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

-- Same signatures and columns, so each is replaced in place and keeps the
-- grants 0105, 0112 and 0113 gave it.

-- 0105's, reading "on their own" from the verified columns.
create or replace function lms.my_progress()
returns table (
  grade smallint, subject text, chapter text, outcomes_seen integer, answers integer, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
language sql stable security invoker
set search_path = public, lms
as $$
  select o.grade, o.subject, o.chapter, count(*)::int, sum(cs.answer_observations)::int, avg(cs.mastery)::float8,
         (avg(cs.verified_mastery) filter (where cs.verified_observations > 0))::float8,
         sum(cs.verified_observations)::int,
         (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
    from public.concept_state cs
    join lms.outcome o on o.id = cs.outcome_id
   where cs.user_id = auth.uid() and cs.answer_observations > 0
   group by o.grade, o.subject, o.chapter
   order by o.subject, o.grade, o.chapter;
$$;

-- 0105's, reading "on their own" from the verified columns.
create or replace function lms.class_insights(p_section uuid, p_subject uuid)
returns table (
  student_user_id uuid, display_name text, roll_number text, chapter text,
  outcomes_seen integer, answers integer, mastery float8, unassisted_mastery float8,
  unassisted_observations integer, assisted_performance float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  sec lms.section;
  sub lms.subject;
begin
  select * into sec from lms.section where id = p_section;
  select * into sub from lms.subject where id = p_subject;
  if sec.id is null or sub.id is null or sub.org_id <> sec.org_id
     or not (lms.teaches_class(p_section, p_subject) or lms.is_admin(sec.org_id)) then
    raise exception 'this is not your class';
  end if;
  return query
    select e.student_user_id, a.display_name, e.roll_number, o.chapter,
           count(*)::int, sum(cs.answer_observations)::int,
           avg(cs.mastery)::float8,
           (avg(cs.verified_mastery) filter (where cs.verified_observations > 0))::float8,
           sum(cs.verified_observations)::int,
           (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
      from lms.enrolment e
      join lms.account a on a.user_id = e.student_user_id
      join public.concept_state cs on cs.user_id = e.student_user_id and cs.answer_observations > 0
      join lms.outcome o on o.id = cs.outcome_id
                        and o.grade = sec.grade
                        and o.subject = coalesce(sub.syllabus_subject, sub.name)
     where e.section_id = p_section and e.left_on is null
     group by e.student_user_id, a.display_name, e.roll_number, o.chapter
     order by o.chapter,
              case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last,
              a.display_name;
end;
$$;

-- 0105's, reading "on their own" from the verified columns.
create or replace function lms.student_chapters(p_student uuid)
returns table (
  subject text, chapter text, outcomes_seen integer, answers integer, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  sec lms.section;
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  select s.* into sec from lms.enrolment e join lms.section s on s.id = e.section_id
   where e.student_user_id = p_student and e.left_on is null limit 1;
  return query
    select o.subject, o.chapter, count(*)::int, sum(cs.answer_observations)::int, avg(cs.mastery)::float8,
           (avg(cs.verified_mastery) filter (where cs.verified_observations > 0))::float8,
           sum(cs.verified_observations)::int,
           (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
      from public.concept_state cs
      join lms.outcome o on o.id = cs.outcome_id
     where cs.user_id = p_student and cs.answer_observations > 0 and o.grade = sec.grade
       and exists (
         select 1 from lms.teaching_assignment ta join lms.subject sub on sub.id = ta.subject_id
          where ta.section_id = sec.id and coalesce(sub.syllabus_subject, sub.name) = o.subject
            and lms.may_see_subject(p_student, sub.id)
       )
     group by o.subject, o.chapter
     order by o.subject, min(o.position);
end;
$$;

-- 0105's, reading "on their own" from the verified columns.
create or replace function lms.practice_chapters()
returns table (
  subject_name text, chapter text, questions integer, answers integer, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  me uuid := auth.uid();
  sec lms.section;
begin
  select s.* into sec from lms.enrolment e join lms.section s on s.id = e.section_id
   where e.student_user_id = me and e.left_on is null limit 1;
  if sec.id is null then
    return;
  end if;
  return query
    with pool as (select * from lms.practice_pool(me)),
    subjects as (
      select distinct coalesce(sub.syllabus_subject, sub.name) as subject
        from lms.teaching_assignment ta join lms.subject sub on sub.id = ta.subject_id
       where ta.section_id = sec.id
    ),
    chapters as (
      select o.subject, o.chapter, min(o.position) as first
        from lms.outcome o join subjects s on s.subject = o.subject
       where o.grade = sec.grade
       group by o.subject, o.chapter
    )
    select c.subject, c.chapter,
           (select count(*)::int from pool p where p.subject = c.subject and p.chapter = c.chapter),
           coalesce(b.answers, 0),
           b.mastery, b.unassisted_mastery, coalesce(b.unassisted_observations, 0), b.assisted_performance
      from chapters c
      left join lateral (
        select sum(cs.answer_observations)::int as answers,
               avg(cs.mastery)::float8 as mastery,
               (avg(cs.verified_mastery) filter (where cs.verified_observations > 0))::float8 as unassisted_mastery,
               sum(cs.verified_observations)::int as unassisted_observations,
               (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
                 as assisted_performance
          from public.concept_state cs join lms.outcome o on o.id = cs.outcome_id
         where cs.user_id = me and cs.answer_observations > 0
           and o.grade = sec.grade and o.subject = c.subject and o.chapter = c.chapter
      ) b on true
     order by c.subject, c.first;
end;
$$;

-- 0105's, reading "on their own" from the verified columns.
create or replace function lms.student_subjects(p_student uuid)
returns table (
  subject_id uuid, subject_name text, teacher_name text, work_due integer, handed_in integer,
  handin_rate float8, average_score float8, mastery float8, chapters_seen integer,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid;
  sec lms.section;
begin
  if not lms.may_see_student(p_student) then
    raise exception 'this student is not yours to see';
  end if;
  select a.org_id into org from lms.account a where a.user_id = p_student;
  select s.* into sec from lms.enrolment e join lms.section s on s.id = e.section_id
   where e.student_user_id = p_student and e.left_on is null limit 1;
  return query
    with f as (
      select * from lms.work_facts(org, p_students => array[p_student], p_due_by => now()) wf where not wf.absent
    ),
    cs as (
      select o.subject, o.chapter, cs.mastery, cs.verified_mastery, cs.verified_observations, cs.unassisted_observations,
             cs.assisted_performance, cs.answer_observations
        from public.concept_state cs join lms.outcome o on o.id = cs.outcome_id
       where cs.user_id = p_student and cs.answer_observations > 0 and o.grade = sec.grade
    )
    select sub.id, sub.name,
           (select acc.display_name from lms.teaching_assignment ta2 join lms.account acc on acc.user_id = ta2.teacher_user_id
             where ta2.section_id = sec.id and ta2.subject_id = sub.id limit 1),
           (select count(*)::int from f where f.subject_id = sub.id),
           (select count(*)::int from f where f.subject_id = sub.id and f.handed_in),
           (select (count(*) filter (where f.handed_in))::float8 / nullif(count(*), 0) from f where f.subject_id = sub.id),
           (select avg(f.score) from f where f.subject_id = sub.id and (f.released or p_student <> auth.uid())),
           (select avg(c.mastery)::float8 from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name)),
           (select count(distinct c.chapter)::int from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name)),
           (select (avg(c.verified_mastery) filter (where c.verified_observations > 0))::float8
              from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name)),
           (select coalesce(sum(c.verified_observations), 0)::int
              from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name)),
           (select (avg(c.assisted_performance) filter (where c.answer_observations > c.unassisted_observations))::float8
              from cs c where c.subject = coalesce(sub.syllabus_subject, sub.name))
      from lms.teaching_assignment ta
      join lms.subject sub on sub.id = ta.subject_id
     where ta.section_id = sec.id and lms.may_see_subject(p_student, sub.id)
     group by sub.id, sub.name, sub.syllabus_subject
     order by sub.name;
end;
$$;

-- 0113's, reading "on their own" from the verified columns.
create or replace function lms.school_overview()
returns table (
  school_name text, students integer, teachers integer, classes integer, subjects integer,
  work_set_30d integer, handin_rate_30d float8, average_score_30d float8,
  active_students_7d integer, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    with f as (
      select * from lms.work_facts(org, p_due_after => now() - interval '30 days', p_due_by => now()) wf
       where not wf.absent
    ),
    b as (
      select avg(cs.mastery)::float8 as mastery,
             (avg(cs.verified_mastery) filter (where cs.verified_observations > 0))::float8 as unassisted_mastery,
             coalesce(sum(cs.verified_observations), 0)::int as unassisted_observations,
             (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
               as assisted_performance
        from public.concept_state cs
       where cs.org_id = org and cs.answer_observations > 0
    )
    select s.display_name,
           (select count(*)::int from lms.account a where a.org_id = org and a.kind = 'student' and a.left_at is null),
           (select count(*)::int from lms.account a where a.org_id = org and a.kind = 'teacher' and a.left_at is null),
           (select count(*)::int from lms.section sec where sec.org_id = org and sec.academic_year_id = lms.current_year(org)),
           (select count(*)::int from lms.subject sub where sub.org_id = org),
           (select count(*)::int from lms.assignment a
             where a.org_id = org and a.published_at > now() - interval '30 days'),
           (select (count(*) filter (where f.handed_in))::float8 / nullif(count(*), 0) from f),
           (select avg(f.score) from f),
           (select count(distinct le.user_id)::int from public.ledger_event le
             where le.org_id = org and le.received_at > now() - interval '7 days'),
           b.mastery, b.unassisted_mastery, b.unassisted_observations, b.assisted_performance
      from lms.school s cross join b
     where s.org_id = org;
end;
$$;

-- 0105's, reading "on their own" from the verified columns.
create or replace function lms.school_classes()
returns table (
  section_id uuid, subject_id uuid, class_name text, grade smallint, subject_name text, teacher_name text,
  teacher_login_id text, students integer, work_set integer, handin_rate float8, average_score float8, mastery float8,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    with f as (
      select wf.section_id, wf.subject_id,
             (count(*) filter (where wf.handed_in))::float8 / nullif(count(*), 0) as handin_rate,
             avg(wf.score) as average_score
        from lms.work_facts(org, p_due_by => now()) wf
       where not wf.absent
       group by wf.section_id, wf.subject_id
    ),
    -- The brain's belief over the outcomes each section's children have
    -- answered, per grade and subject of the curriculum.
    ms as (
      select e.section_id, o.grade, o.subject, avg(cs.mastery)::float8 as mastery,
             (avg(cs.verified_mastery) filter (where cs.verified_observations > 0))::float8 as unassisted_mastery,
             sum(cs.verified_observations)::int as unassisted_observations,
             (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
               as assisted_performance
        from lms.enrolment e
        join public.concept_state cs on cs.user_id = e.student_user_id and cs.answer_observations > 0
        join lms.outcome o on o.id = cs.outcome_id
       where e.org_id = org and e.left_on is null
       group by e.section_id, o.grade, o.subject
    )
    select sec.id, sub.id, sec.grade || sec.name, sec.grade, sub.name, acc.display_name, acc.login_id,
           (select count(*)::int from lms.enrolment e where e.section_id = sec.id and e.left_on is null),
           (select count(*)::int from lms.assignment a
             where a.section_id = sec.id and a.subject_id = sub.id and a.published_at is not null),
           f.handin_rate,
           f.average_score,
           ms.mastery,
           ms.unassisted_mastery,
           coalesce(ms.unassisted_observations, 0),
           ms.assisted_performance
      from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
      join lms.subject sub on sub.id = ta.subject_id
      join lms.account acc on acc.user_id = ta.teacher_user_id
      left join f on f.section_id = sec.id and f.subject_id = sub.id
      left join ms on ms.section_id = sec.id and ms.grade = sec.grade
                  and ms.subject = coalesce(sub.syllabus_subject, sub.name)
     where ta.org_id = org and sec.academic_year_id = lms.current_year(org)
     order by sec.grade, sec.name, sub.name;
end;
$$;

-- 0112's, reading "on their own" from the verified columns.
create or replace function lms.school_students(p_section uuid default null)
returns table (
  user_id uuid, display_name text, login_id text, section_id uuid, class_name text, roll_number text,
  work_due integer, handin_rate float8, average_score float8, mastery float8, last_active timestamptz,
  unassisted_mastery float8, unassisted_observations integer, assisted_performance float8
)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  children uuid[];
begin
  if p_section is not null then
    select coalesce(array_agg(e.student_user_id), '{}') into children
      from lms.enrolment e
     where e.section_id = p_section and e.left_on is null;
  end if;
  return query
    with f as (
      select wf.student_user_id, count(*)::int as work_due,
             (count(*) filter (where wf.handed_in))::float8 / nullif(count(*), 0) as handin_rate,
             avg(wf.score) as average_score
        from lms.work_facts(org, p_students => children, p_due_by => now()) wf
       where not wf.absent
       group by wf.student_user_id
    )
    select a.user_id, a.display_name, a.login_id, sec.id, sec.grade || sec.name, e.roll_number,
           coalesce(f.work_due, 0),
           f.handin_rate,
           f.average_score,
           b.mastery,
           (select max(le.received_at) from public.ledger_event le where le.user_id = a.user_id),
           b.unassisted_mastery,
           b.unassisted_observations,
           b.assisted_performance
      from lms.account a
      join lms.enrolment e on e.student_user_id = a.user_id and e.left_on is null
      join lms.section sec on sec.id = e.section_id
      left join f on f.student_user_id = a.user_id
      cross join lateral (
        select avg(cs.mastery)::float8 as mastery,
               (avg(cs.verified_mastery) filter (where cs.verified_observations > 0))::float8 as unassisted_mastery,
               coalesce(sum(cs.verified_observations), 0)::int as unassisted_observations,
               (avg(cs.assisted_performance) filter (where cs.answer_observations > cs.unassisted_observations))::float8
                 as assisted_performance
          from public.concept_state cs
         where cs.user_id = a.user_id and cs.answer_observations > 0
      ) b
     where a.org_id = org and a.kind = 'student' and (p_section is null or sec.id = p_section)
     order by sec.grade, sec.name,
              case when e.roll_number ~ '^[0-9]{1,9}$' then e.roll_number::int end nulls last, a.display_name;
end;
$$;

