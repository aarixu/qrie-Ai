-- PHOTOS OF NOTEBOOK WORK — LMS build plan, L3 (the photo half). Marked by
-- the teacher, never by a model (final plan, J1).
--
-- Photos live in a PRIVATE bucket, `lms-work`, at
--
--     <org id>/<assignment id>/<student id>/<file>
--
-- and the path is what every rule reads (supabase/tests/lms-photos.test.ts,
-- written first):
--
--   upload — only into your own folder, for PUBLISHED work in YOUR section
--            whose answer types include 'photo'. A malformed path is refused.
--   read   — the student who took it, the class's teacher, the school's admin.
--            Not a classmate, not another class's teacher.
--   change — nobody from a browser. A photo cannot be swapped after upload;
--            the student uploads another.
--
-- lms.submit_photos turns uploaded photos into a submission of kind 'photo'
-- (attempts counted apart from the MCQs, 0024) with a mark row that has no
-- machine part, for the teacher to fill with lms.set_teacher_mark.
--
-- Photos write nothing to the ledger: until a teacher marks one there is no
-- correctness to learn from, and the brain (L6) folds marks, not uploads.
--
-- The 5 MB limit is UNVERIFIED against real phones. The student app (L5) is
-- meant to shrink photos before upload; until it does, 5 MB is sized to admit
-- an ordinary phone JPEG.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lms-work', 'lms-work', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists lms.submission_photo (
  submission_id uuid not null references lms.submission on delete cascade,
  object_name text not null unique,
  position smallint not null check (position between 1 and 10),
  primary key (submission_id, position)
);

-- ---------------------------------------------------------------------------
-- Reading a work path. Returns nulls for anything that is not
-- <uuid>/<uuid>/<uuid>/<file>, so every rule built on it fails closed.
-- ---------------------------------------------------------------------------

create or replace function lms.work_path(p_name text)
returns table (org_id uuid, assignment_id uuid, student_id uuid)
language plpgsql immutable
as $$
declare
  parts text[] := string_to_array(p_name, '/');
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if array_length(parts, 1) = 4 and parts[1] ~ uuid_re and parts[2] ~ uuid_re and parts[3] ~ uuid_re
     and length(parts[4]) between 1 and 100 then
    return query select parts[1]::uuid, parts[2]::uuid, parts[3]::uuid;
  else
    return query select null::uuid, null::uuid, null::uuid;
  end if;
end;
$$;

create or replace function lms.may_upload_work(p_name text)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select coalesce((
    select p.student_id = auth.uid()
       and a.published_at is not null
       and 'photo' = any (a.answer_types)
       and lms.in_section(a.section_id)
      from lms.work_path(p_name) p
      join lms.assignment a on a.id = p.assignment_id and a.org_id = p.org_id
  ), false);
$$;

create or replace function lms.may_read_work(p_name text)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select coalesce((
    select p.student_id = auth.uid()
        or lms.can_manage_assignment(p.assignment_id)
        or lms.is_admin(p.org_id)
      from lms.work_path(p_name) p
      join lms.assignment a on a.id = p.assignment_id and a.org_id = p.org_id
  ), false);
$$;

create or replace function lms.submit_photos(p_assignment uuid, p_paths text[])
returns uuid
language plpgsql
security definer
set search_path = public, lms, storage
as $$
declare
  me uuid := auth.uid();
  a lms.assignment;
  n_attempt smallint;
  sid uuid;
  i integer;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select * into a from lms.assignment where id = p_assignment;
  if a.id is null or a.published_at is null or not ('photo' = any (a.answer_types))
     or not lms.in_section(a.section_id) then
    raise exception 'this is not your homework';
  end if;
  if coalesce(array_length(p_paths, 1), 0) not between 1 and 10 then
    raise exception 'hand in 1 to 10 photos';
  end if;
  for i in 1 .. array_length(p_paths, 1) loop
    if p_paths[i] is distinct from format('%s/%s/%s/%s', a.org_id, a.id, me, split_part(p_paths[i], '/', 4))
       or not exists (
         -- The live project has both owner (uuid, older) and owner_id (text,
         -- newer); which one the Storage API fills was not verified, so
         -- either identifies the uploader.
         select 1 from storage.objects o
          where o.bucket_id = 'lms-work' and o.name = p_paths[i]
            and (o.owner = me or o.owner_id = me::text)
       ) then
      raise exception 'photo % was not uploaded by you for this homework', p_paths[i];
    end if;
  end loop;

  select coalesce(max(s.attempt), 0) + 1 into n_attempt
    from lms.submission s
   where s.assignment_id = a.id and s.student_user_id = me and s.kind = 'photo';
  if n_attempt > a.attempts_allowed then
    raise exception 'no attempts left for this homework';
  end if;

  insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, late)
  values (a.org_id, a.id, me, 'photo', n_attempt, now() > a.due_at)
  returning id into sid;

  for i in 1 .. array_length(p_paths, 1) loop
    insert into lms.submission_photo (submission_id, object_name, position) values (sid, p_paths[i], i);
  end loop;

  insert into lms.mark (submission_id, machine_correct, machine_total) values (sid, 0, 0);
  return sid;
end;
$$;

revoke all on function lms.work_path(text) from public, anon;
revoke all on function lms.may_upload_work(text) from public, anon;
revoke all on function lms.may_read_work(text) from public, anon;
revoke all on function lms.submit_photos(uuid, text[]) from public, anon;
grant execute on function lms.work_path(text) to authenticated, service_role;
grant execute on function lms.may_upload_work(text) to authenticated, service_role;
grant execute on function lms.may_read_work(text) to authenticated, service_role;
grant execute on function lms.submit_photos(uuid, text[]) to authenticated, service_role;

grant select on lms.submission_photo to authenticated;
grant all on lms.submission_photo to service_role;
revoke all on lms.submission_photo from anon;
alter table lms.submission_photo enable row level security;

drop policy if exists "read photos of submissions you may see" on lms.submission_photo;
create policy "read photos of submissions you may see" on lms.submission_photo
  for select using (lms.can_see_submission(submission_id));

-- ---------------------------------------------------------------------------
-- The bucket's rules. Only insert and select; no update or delete policy, so
-- nobody can swap or remove a photo from a browser.
-- ---------------------------------------------------------------------------

drop policy if exists "students upload work into their own folder" on storage.objects;
create policy "students upload work into their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lms-work' and lms.may_upload_work(name));

drop policy if exists "the work's student, teacher and admin read it" on storage.objects;
create policy "the work's student, teacher and admin read it" on storage.objects
  for select to authenticated
  using (bucket_id = 'lms-work' and lms.may_read_work(name));
