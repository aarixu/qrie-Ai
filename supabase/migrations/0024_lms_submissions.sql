-- SUBMISSIONS AND MARKS, the MCQ half — LMS build plan, L3.
--
-- The rule everything below serves: A STUDENT SENDS ONLY WHICH OPTIONS THEY
-- CHOSE. Whether that is right is decided here, by lms.submit_mcq, from a key
-- the student can never read (0023). No browser can insert or change a
-- submission, an answer or a mark: those tables are SELECT-only to every
-- signed-in role, and written only by the two SECURITY DEFINER functions
-- below. This replaces the plan's "a separate Edge Function" — the same
-- guarantee, one fewer thing to deploy, and testable against the real
-- migrations (supabase/tests/lms-submissions.test.ts, written first).
--
-- Also:
--   * attempts are counted and capped by the assignment's attempts_allowed;
--   * a submission after the due date is taken and flagged late;
--   * an answer to a question not on the assignment, or an option the
--     question does not have, is REJECTED — never clamped or dropped;
--   * the teacher's number is kept BESIDE the machine's, with who gave it and
--     when (decision 6), and every change goes into a history nobody edits;
--   * each answer is also written to the ledger as source 'homework' —
--     server-written evidence a client cannot forge, for the brain (L6);
--   * none of it is in the ledger's 90-day purge: these are school records.
--
-- Photos of notebook work are the other half of L3.

create table if not exists lms.submission (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  assignment_id uuid not null references lms.assignment on delete cascade,
  student_user_id uuid not null references auth.users on delete cascade,
  -- What was handed in. Attempts are counted per kind, so sending photos of
  -- the notebook never uses up an attempt at the MCQs of the same assignment.
  kind text not null default 'mcq' check (kind in ('mcq', 'photo')),
  attempt smallint not null check (attempt >= 1),
  submitted_at timestamptz not null default now(),
  late boolean not null,
  unique (assignment_id, student_user_id, kind, attempt)
);

create index if not exists submission_assignment on lms.submission (assignment_id);

create table if not exists lms.submission_answer (
  submission_id uuid not null references lms.submission on delete cascade,
  item_id uuid not null references lms.item on delete restrict,
  chosen_index smallint,
  correct boolean not null,
  primary key (submission_id, item_id)
);

create table if not exists lms.mark (
  submission_id uuid primary key references lms.submission on delete cascade,
  machine_correct smallint not null,
  machine_total smallint not null,
  teacher_score numeric(6, 2),
  teacher_max numeric(6, 2),
  marked_by uuid references auth.users on delete set null,
  marked_at timestamptz,
  check (machine_total >= 0 and machine_correct between 0 and machine_total),
  check ((teacher_score is null) = (teacher_max is null)),
  check (teacher_max is null or (teacher_max > 0 and teacher_score between 0 and teacher_max))
);

create table if not exists lms.mark_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references lms.submission on delete cascade,
  old_score numeric(6, 2),
  old_max numeric(6, 2),
  new_score numeric(6, 2) not null,
  new_max numeric(6, 2) not null,
  changed_by uuid references auth.users on delete set null,
  changed_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------

create or replace function lms.can_see_submission(p_submission uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.submission s
     where s.id = p_submission
       and (
         s.student_user_id = auth.uid()
         or lms.can_manage_assignment(s.assignment_id)
         or lms.is_admin(s.org_id)
       )
  );
$$;

create or replace function lms.submit_mcq(p_assignment uuid, p_answers jsonb)
returns table (submission_id uuid, correct integer, total integer)
language plpgsql
security definer
set search_path = public, lms
as $$
declare
  me uuid := auth.uid();
  a lms.assignment;
  it lms.item;
  k text;
  v jsonb;
  chosen smallint;
  is_right boolean;
  n_attempt smallint;
  sid uuid;
  session uuid := gen_random_uuid();
  n_correct integer := 0;
  n_total integer := 0;
  n_seq integer := 0;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or a.published_at is null or not lms.in_section(a.section_id) then
    raise exception 'this is not your homework';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must map each item id to the option chosen';
  end if;
  for k in select jsonb_object_keys(p_answers) loop
    if not exists (
      select 1 from lms.assignment_item ai where ai.assignment_id = a.id and ai.item_id::text = k
    ) then
      raise exception 'item % is not on this assignment', k;
    end if;
  end loop;

  select coalesce(max(s.attempt), 0) + 1 into n_attempt
    from lms.submission s
   where s.assignment_id = a.id and s.student_user_id = me and s.kind = 'mcq';
  if n_attempt > a.attempts_allowed then
    raise exception 'no attempts left for this homework';
  end if;

  insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, late)
  values (a.org_id, a.id, me, 'mcq', n_attempt, now() > a.due_at)
  returning id into sid;

  insert into public.learning_session (id, org_id, user_id, source, started_at, ended_at)
  values (session, a.org_id, me, 'homework', now(), now());

  for it in
    select i.* from lms.assignment_item ai join lms.item i on i.id = ai.item_id
     where ai.assignment_id = a.id and i.kind = 'mcq'
     order by ai.position
  loop
    v := p_answers -> it.id::text;
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
      gen_random_uuid(), a.org_id, me, session, n_seq, now(), 'answered', 'homework', 'tap', it.outcome_ids,
      jsonb_build_object(
        'correct', is_right,
        'chosenIndex', chosen,
        'itemId', it.id,
        'assignmentId', a.id,
        'submissionId', sid,
        'attempt', n_attempt,
        -- Rung 0 of the assistance ladder: the product gave no help. The
        -- fold credits unassisted mastery only on rung 0 (learner-model,
        -- fold.ts), so without this every homework answer counts as helped.
        'assistanceRung', 0
      )
    );
  end loop;

  insert into lms.mark (submission_id, machine_correct, machine_total)
  values (sid, n_correct, n_total);

  return query select sid, n_correct, n_total;
end;
$$;

create or replace function lms.set_teacher_mark(p_submission uuid, p_score numeric, p_max numeric)
returns void
language plpgsql
security definer
set search_path = public, lms
as $$
declare
  s lms.submission;
  a lms.assignment;
  m lms.mark;
begin
  select * into s from lms.submission where id = p_submission;
  select * into a from lms.assignment where id = s.assignment_id;
  if s.id is null or not lms.teaches_class(a.section_id, a.subject_id) then
    raise exception 'this is not your class';
  end if;
  select * into m from lms.mark where submission_id = s.id;
  update lms.mark
     set teacher_score = p_score, teacher_max = p_max, marked_by = auth.uid(), marked_at = now()
   where submission_id = s.id;
  insert into lms.mark_history (submission_id, old_score, old_max, new_score, new_max, changed_by)
  values (s.id, m.teacher_score, m.teacher_max, p_score, p_max, auth.uid());
end;
$$;

revoke all on function lms.can_see_submission(uuid) from public, anon;
revoke all on function lms.submit_mcq(uuid, jsonb) from public, anon;
revoke all on function lms.set_teacher_mark(uuid, numeric, numeric) from public, anon;
grant execute on function lms.can_see_submission(uuid) to authenticated, service_role;
grant execute on function lms.submit_mcq(uuid, jsonb) to authenticated, service_role;
grant execute on function lms.set_teacher_mark(uuid, numeric, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read-only to browsers. Written only by the functions above.
-- ---------------------------------------------------------------------------

grant select on lms.submission, lms.submission_answer, lms.mark, lms.mark_history to authenticated;
grant all on lms.submission, lms.submission_answer, lms.mark, lms.mark_history to service_role;
revoke all on lms.submission, lms.submission_answer, lms.mark, lms.mark_history from anon;

alter table lms.submission enable row level security;
alter table lms.submission_answer enable row level security;
alter table lms.mark enable row level security;
alter table lms.mark_history enable row level security;

drop policy if exists "read your own, your class's, or your school's submissions" on lms.submission;
create policy "read your own, your class's, or your school's submissions" on lms.submission
  for select using (lms.can_see_submission(id));

drop policy if exists "read answers you may see" on lms.submission_answer;
create policy "read answers you may see" on lms.submission_answer
  for select using (lms.can_see_submission(submission_id));

drop policy if exists "read marks you may see" on lms.mark;
create policy "read marks you may see" on lms.mark
  for select using (lms.can_see_submission(submission_id));

drop policy if exists "read mark history you may see" on lms.mark_history;
create policy "read mark history you may see" on lms.mark_history
  for select using (lms.can_see_submission(submission_id));
