-- RECORD_EVIDENCE BOUNDS WHAT ONE EVENT CAN NAME (lam-one-brain M2 review).
--
-- Since 0110 record_evidence (0107) is the only way a phone writes evidence,
-- and 0107 bounded only the payload. The brain (packages/lms-brain think.ts)
-- makes a concept_state row for every outcome id it reads, in the graph or
-- not, so one child's token could make any number of rows and ledger bytes.
-- This is 0107's function with these refusals added and nothing else changed:
--
--   * an event naming more than 32 outcomes, or an outcome id over 200
--     characters: 'bad-outcomes'. A 'taught' event names every outcome its
--     lesson teaches; the largest lesson in content/ teaches 11, and the
--     longest id in the graph is 126 characters;
--   * a topicRef over 200 characters, on the event or on the p_sessions entry
--     of a sitting the event would open: 'bad-topic' (a topicRef is a
--     syllabus path such as class8-mathematics/rational-numbers);
--   * a call with more than 500 sittings: 22023, as for more than 500 events,
--     since each event looks its sitting up in p_sessions.

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
