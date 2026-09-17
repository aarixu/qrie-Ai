-- ONE COLD TOPIC, ONE PREPARATION, HOWEVER MANY STUDENTS OPEN IT.
--
-- Preparation contributes `16.55 x Rs 30 / S` to the student-hour, where S is
-- the number of students who end up sharing a topic. At S = 1 that is Rs 496.5
-- a student-hour, ninety-nine times the ceiling -- and S = 1 is the DEFAULT
-- state today, not a bad case. Preparation runs in the student's own browser
-- (`apps/classroom/src/lib/liveClass.ts`), every limit in `claim_relay` is
-- keyed on one user, and a repo-wide search for a semaphore, a queue, admission
-- control or a per-topic lock finds nothing. So N students opening one cold
-- topic run N preparations and throw N-1 of the results away: `classStore`
-- treats a storage 409 as success and sends `ignore-duplicates` on the row, so
-- the duplicates are discarded AFTER they have been paid for in full.
--
-- It is also what breaks first at a hundred students. One preparation is
-- roughly forty relay calls over about ninety-six seconds with the visuals
-- fanned out in parallel; a cohort arriving on one new topic is thousands of
-- calls in flight against one Vertex project and one project-wide ceiling.
--
-- THE KEY IS `topic_ref`, AND ONLY EVER `topic_ref`.
-- `<syllabus>/<chapter>/<topic>`, the join key of the whole product. Never the
-- derived class id: two students reaching one topic by different derivations
-- must take ONE lock, and a key each client derives for itself is two locks,
-- which is no lock.

create table if not exists public.prep_lock (
  topic_ref text primary key,
  user_id uuid not null references auth.users on delete cascade,
  org_id uuid not null references public.organization on delete cascade,
  taken_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists prep_lock_expires on public.prep_lock (expires_at);

-- RLS on, not one policy, like every other control surface here. The only way
-- in is the definer functions below, which the relay reaches with the
-- service-role key. A student never touches this table: painting a "someone is
-- preparing this" badge is a READ, and reads go through the state route, not
-- through the lock.
alter table public.prep_lock enable row level security;

revoke all on table public.prep_lock from anon, authenticated;

/**
 * Take the lock for one topic, or say who holds it and why not.
 *
 * `granted` false with reason 'held' means somebody else is already preparing
 * this exact topic and the caller should wait for them rather than pay for a
 * second copy. Reason 'busy' means the project is at its concurrency ceiling
 * and the caller should be turned away entirely -- a queue that admits everyone
 * is not admission control.
 *
 * The TTL is what covers a browser that closed mid-preparation. Nothing else
 * can: there is no session to hang a cleanup off, and a student who force-quits
 * an app is the ordinary case, not the exception. 180 seconds is roughly twice
 * the measured ninety-six second preparation, so a slow phone is not mistaken
 * for a dead one.
 */
create or replace function public.take_prep_lock(
  p_topic text,
  p_user uuid,
  p_org uuid,
  p_ttl_seconds integer default 180
)
returns table (granted boolean, reason text, holder uuid, expires_at timestamptz, running integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_at timestamptz := now();
  ceiling_preps integer;
  in_flight integer;
  won_expires timestamptz;
  held_by uuid;
  held_until timestamptz;
begin
  if p_topic is null or p_topic = '' or p_user is null or p_org is null then
    raise exception 'take_prep_lock needs a topic, a user and an organisation';
  end if;

  -- Expired first, always. A lock nobody released is the normal end of a
  -- preparation, not an error, and sweeping here means nothing has to run on a
  -- timer.
  delete from public.prep_lock where expires_at < now_at;

  select c.max_concurrent_preps into ceiling_preps
    from public.relay_control c where c.id limit 1;
  if ceiling_preps is null then ceiling_preps := 8; end if;

  select count(*)::integer into in_flight from public.prep_lock;

  -- ADMISSION CONTROL, BEFORE THE PER-TOPIC CLAIM. A caller who would be the
  -- ninth simultaneous preparation is turned away even if their own topic is
  -- free, because the thing being protected is the project, not the topic.
  if in_flight >= ceiling_preps then
    return query select false, 'busy'::text, null::uuid, null::timestamptz, in_flight;
    return;
  end if;

  -- One statement decides it. Two students arriving together cannot both come
  -- back with a row: the loser conflicts and gets nothing returned.
  insert into public.prep_lock as l (topic_ref, user_id, org_id, taken_at, expires_at)
  values (p_topic, p_user, p_org, now_at, now_at + make_interval(secs => p_ttl_seconds))
  on conflict (topic_ref) do nothing
  returning l.expires_at into won_expires;

  if won_expires is not null then
    return query select true, null::text, p_user, won_expires, in_flight + 1;
    return;
  end if;

  -- Lost it. Say who has it and until when, so the caller can wait for the
  -- class they are about to be handed rather than start paying for its twin.
  select l.user_id, l.expires_at into held_by, held_until
    from public.prep_lock l where l.topic_ref = p_topic;

  return query select false, 'held'::text, held_by, held_until, in_flight;
end;
$$;

/**
 * Give it back, on success and on failure alike.
 *
 * Only the holder may release, so a second student who lost the race cannot
 * free the winner's lock and start a third preparation. A release that matches
 * nothing is not an error: the TTL may already have swept it, and a caller
 * tidying up after a crash should not be handed an exception for being late.
 */
create or replace function public.release_prep_lock(p_topic text, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  gone integer;
begin
  delete from public.prep_lock
   where topic_ref = p_topic
     and user_id = p_user;
  get diagnostics gone = row_count;
  return gone > 0;
end;
$$;

revoke all on function public.take_prep_lock(text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.take_prep_lock(text, uuid, uuid, integer) to service_role;

revoke all on function public.release_prep_lock(text, uuid) from public, anon, authenticated;
grant execute on function public.release_prep_lock(text, uuid) to service_role;
