-- NOTICES: WHAT THE SCHOOL'S WHATSAPP GROUPS ARE USED FOR TODAY.
--
-- A notice is a message, not a date (0029's events are dates): a title of 1
-- to 120 characters, a message of 1 to 2000, and at most one file.
--
-- WHO SENDS TO WHOM. A teacher sends to one or more of the sections they
-- teach this year; the admin to any of this year's sections of the school,
-- or to the whole school. Only the admin sends to the whole school.
--
-- WHO READS IT. A child: the notices for their own section this year, and
-- the whole school's. A teacher: the whole school's, those for the sections
-- they teach this year, and their own. The admin: all of the school's. Only
-- this year's: a notice belongs to the school year it was sent in (0034's
-- current_year), so a new year (0037) starts with none. Someone who has left
-- (0034) reads nothing, and another school nothing at all.
--
-- THE FILE. A PDF, a JPEG or a PNG of 512 KB at most, kept in the database
-- as the logo is (0032) and checked the same way: it must begin and end as
-- its kind of file does. A PDF must start with %PDF- and have %%EOF in its
-- last kilobyte. The bytes in between are not decoded. Anything else is
-- refused, not converted. It is kept under the name it was sent with, less
-- any marks that change the direction of text, and with its last extension
-- replaced by its kind's own (.pdf, .jpg, .png), so it is never saved on a
-- phone as anything else.
--
-- READ RECEIPTS. Opening a notice records, once, that the caller read it.
-- Its writer and the admin see how many of its audience have read it, and
-- who has not: the admin all of it, its writer only the children of the
-- classes they still teach. THE AUDIENCE IS WHOEVER THE NOTICE IS FOR NOW, not whoever it
-- was for when it was sent: the children enrolled today in its sections (for
-- the whole school, in any section of its year) and, for the whole school,
-- every teacher who has not left. A child who joins the class later is
-- counted; a child who leaves the school or moves out of the class is not,
-- and nor is their read.
--
-- Its writer, while still at the school, or the admin deletes a notice of
-- this year, and its reads with it. Sending and deleting go in the activity
-- log (0034).
--
-- Written against packages/lms-client/tests/notices.test.ts, first.

create table if not exists lms.notice (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  academic_year_id uuid not null,
  -- True: the whole school; false: the sections in lms.notice_section.
  whole_school boolean not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  attachment_name text check (attachment_name is null or char_length(attachment_name) between 1 and 100),
  attachment_mime text check (attachment_mime is null or attachment_mime in ('application/pdf', 'image/jpeg', 'image/png')),
  attachment bytea check (attachment is null or octet_length(attachment) between 8 and 524288),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  check ((attachment is null) = (attachment_mime is null) and (attachment is null) = (attachment_name is null)),
  foreign key (academic_year_id, org_id) references lms.academic_year (id, org_id) on delete cascade,
  unique (id, org_id)
);
create index if not exists notice_school_time on lms.notice (org_id, created_at desc);

create table if not exists lms.notice_section (
  notice_id uuid not null,
  section_id uuid not null,
  org_id uuid not null,
  primary key (notice_id, section_id),
  foreign key (notice_id, org_id) references lms.notice (id, org_id) on delete cascade,
  foreign key (section_id, org_id) references lms.section (id, org_id) on delete cascade
);
create index if not exists notice_section_section on lms.notice_section (section_id);

create table if not exists lms.notice_read (
  notice_id uuid not null references lms.notice on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);

-- Reached only through the functions below.
revoke all on lms.notice, lms.notice_section, lms.notice_read from public, anon, authenticated;
grant all on lms.notice, lms.notice_section, lms.notice_read to service_role;
alter table lms.notice enable row level security;
alter table lms.notice_section enable row level security;
alter table lms.notice_read enable row level security;

-- ---------------------------------------------------------------------------
-- Who may read, who may manage, and whom a notice is for. Internal.
-- ---------------------------------------------------------------------------

-- Whether the caller may read this notice (see WHO READS IT above).
create or replace function lms.may_see_notice(p_notice uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select exists (
    select 1 from lms.notice n
     where n.id = p_notice
       and public.is_member(n.org_id)
       and n.academic_year_id = lms.current_year(n.org_id)
       and (
         n.whole_school
         or n.created_by = auth.uid()
         or lms.is_admin(n.org_id)
         or exists (
           select 1 from lms.notice_section ns
            where ns.notice_id = n.id
              and (lms.in_section(ns.section_id) or lms.teaches_section(ns.section_id))
         )
       )
  );
$$;

-- Whether the caller may delete it and see who has read it: its writer or
-- the admin, among those who may read it.
create or replace function lms.may_manage_notice(p_notice uuid)
returns boolean
language sql stable security definer
set search_path = public, lms
as $$
  select lms.may_see_notice(p_notice)
     and exists (
       select 1 from lms.notice n
        where n.id = p_notice and (n.created_by = auth.uid() or lms.is_admin(n.org_id))
     );
$$;

-- Whom the notice is for now (see READ RECEIPTS above): its children, each
-- with their section and roll, and for the whole school its teachers too —
-- as far as the caller may see them: the admin all of them, anyone else only
-- the children of the sections they teach this year.
create or replace function lms.notice_audience(p_notice uuid)
returns table (user_id uuid, kind text, section_id uuid, roll_number text)
language sql stable security definer
set search_path = public, lms
as $$
  select e.student_user_id, 'student'::text, e.section_id, e.roll_number
    from lms.notice n
    join lms.section sec on sec.org_id = n.org_id and sec.academic_year_id = n.academic_year_id
    join lms.enrolment e on e.section_id = sec.id and e.left_on is null
    join lms.account a on a.user_id = e.student_user_id and a.left_at is null
   where n.id = p_notice
     and (n.whole_school
          or exists (select 1 from lms.notice_section ns where ns.notice_id = n.id and ns.section_id = sec.id))
     and (lms.is_admin(n.org_id) or lms.teaches_section(sec.id))
  union all
  select a.user_id, 'teacher'::text, null::uuid, null::text
    from lms.notice n
    join lms.account a on a.org_id = n.org_id and a.kind = 'teacher' and a.left_at is null
   where n.id = p_notice and n.whole_school and lms.is_admin(n.org_id);
$$;

-- ---------------------------------------------------------------------------
-- Sending and deleting.
-- ---------------------------------------------------------------------------

-- p_sections null or empty: the whole school. p_attachment is base64.
create or replace function lms.send_notice(
  p_title text,
  p_body text,
  p_sections uuid[] default null,
  p_attachment_name text default null,
  p_attachment_mime text default null,
  p_attachment text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := public.current_org_id();
  y uuid;
  words_title text := lms.trim_space(p_title);
  words_body text := lms.trim_space(p_body);
  sections uuid[];
  s uuid;
  bytes bytea;
  file_name text;
  new_id uuid;
begin
  if org is null or not lms.is_staff(org) then
    raise exception 'only a teacher or the school admin can send a notice';
  end if;
  y := lms.current_year(org);
  if y is null then
    raise exception 'your school has no school year yet';
  end if;
  if char_length(words_title) not between 1 and 120 then
    raise exception 'a notice has a title of 1 to 120 characters';
  end if;
  if char_length(words_body) not between 1 and 2000 then
    raise exception 'a notice has a message of 1 to 2000 characters';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into sections
    from unnest(coalesce(p_sections, '{}'::uuid[])) x
   where x is not null;
  if cardinality(sections) = 0 then
    if not lms.is_admin(org) then
      raise exception 'only the school admin can send a notice to the whole school';
    end if;
  else
    foreach s in array sections loop
      if not exists (select 1 from lms.section sec where sec.id = s and sec.org_id = org and sec.academic_year_id = y) then
        raise exception 'that is not a class of this year in your school';
      end if;
      if not (lms.is_admin(org) or lms.teaches_section(s)) then
        raise exception 'you can send a notice only to classes you teach';
      end if;
    end loop;
  end if;

  if p_attachment_mime is not null or p_attachment is not null then
    if p_attachment_mime is null or p_attachment_mime not in ('application/pdf', 'image/jpeg', 'image/png') then
      raise exception 'an attachment must be a PDF, a JPEG or a PNG';
    end if;
    begin
      bytes := decode(coalesce(p_attachment, ''), 'base64');
    exception when others then
      raise exception 'that file could not be read';
    end;
    if octet_length(bytes) > 524288 then
      raise exception 'an attachment must be 512 KB or smaller';
    end if;
    -- A PDF: its header first, and its end-of-file marker in the last kilobyte.
    if p_attachment_mime = 'application/pdf' and (
      octet_length(bytes) < 16
      or substring(bytes from 1 for 5) <> '\x255044462d'::bytea
      or position('\x2525454f46'::bytea in substring(bytes from greatest(octet_length(bytes) - 1023, 1))) = 0
    ) then
      raise exception 'that file is not a PDF';
    end if;
    -- A PNG: its signature, then the IHDR chunk, and the IEND chunk last.
    if p_attachment_mime = 'image/png' and (
      octet_length(bytes) < 57
      or substring(bytes from 1 for 8) <> '\x89504e470d0a1a0a'::bytea
      or substring(bytes from 13 for 4) <> '\x49484452'::bytea
      or substring(bytes from octet_length(bytes) - 11 for 12) <> '\x0000000049454e44ae426082'::bytea
    ) then
      raise exception 'that file is not a PNG';
    end if;
    -- A JPEG: its start-of-image marker first and end-of-image marker last.
    if p_attachment_mime = 'image/jpeg' and (
      octet_length(bytes) < 8
      or substring(bytes from 1 for 3) <> '\xffd8ff'::bytea
      or substring(bytes from octet_length(bytes) - 1 for 2) <> '\xffd9'::bytea
    ) then
      raise exception 'that file is not a JPEG';
    end if;
    -- Without direction marks, which can make "fees.pdf" of "fees" + U+202E +
    -- "fdp.exe", and ending in its own kind's extension, whatever it was sent as.
    file_name := regexp_replace(lms.trim_space(p_attachment_name),
                                E'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', 'g');
    file_name := coalesce(nullif(lms.trim_space(regexp_replace(file_name, '\.[^.]*$', '')), ''), 'attachment')
                 || case p_attachment_mime when 'application/pdf' then '.pdf' when 'image/png' then '.png' else '.jpg' end;
    if char_length(file_name) > 100 or file_name ~ '[/\\[:cntrl:]]' then
      raise exception 'a file name is up to 100 characters, with no slashes';
    end if;
  end if;

  insert into lms.notice (org_id, academic_year_id, whole_school, title, body,
                          attachment_name, attachment_mime, attachment, created_by)
  values (org, y, cardinality(sections) = 0, words_title, words_body,
          file_name, p_attachment_mime, bytes, auth.uid())
  returning id into new_id;
  insert into lms.notice_section (notice_id, section_id, org_id)
  select new_id, x, org from unnest(sections) x;

  perform lms.audit(org, 'notice-sent', words_title, jsonb_build_object(
    'to', case when cardinality(sections) = 0 then to_jsonb('whole school'::text)
               else (select to_jsonb(array_agg(sec.grade || sec.name order by sec.grade, sec.name))
                       from lms.section sec where sec.id = any (sections)) end,
    'attachment', file_name
  ));
  return new_id;
end;
$$;

create or replace function lms.delete_notice(p_notice uuid)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid;
  words_title text;
begin
  select n.org_id, n.title into org, words_title from lms.notice n where n.id = p_notice;
  if org is null or not lms.may_manage_notice(p_notice) then
    raise exception 'only whoever sent it, or the school admin, can delete this notice';
  end if;
  delete from lms.notice where id = p_notice;
  perform lms.audit(org, 'notice-deleted', words_title);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading.
-- ---------------------------------------------------------------------------

-- This year's notices the caller may read, newest first, with when they
-- first opened each; and, for its writer and the admin, how many of its
-- audience have read it, of how many.
create or replace function lms.my_notices()
returns table (
  notice_id uuid, title text, body text, whole_school boolean, class_names text,
  sent_by_name text, sent_at timestamptz,
  attachment_name text, attachment_mime text, attachment_bytes integer,
  read_at timestamptz, mine boolean, can_delete boolean, readers integer, audience integer
)
language sql stable security definer
set search_path = public, lms
as $$
  select n.id, n.title, n.body, n.whole_school,
         (select string_agg(sec.grade || sec.name, ', ' order by sec.grade, sec.name)
            from lms.notice_section ns join lms.section sec on sec.id = ns.section_id
           where ns.notice_id = n.id),
         w.display_name, n.created_at,
         n.attachment_name, n.attachment_mime, octet_length(n.attachment),
         r.read_at,
         coalesce(n.created_by = auth.uid(), false),
         m.yes,
         case when m.yes then (select count(*)::int from lms.notice_audience(n.id) au
                                 join lms.notice_read nr on nr.notice_id = n.id and nr.user_id = au.user_id) end,
         case when m.yes then (select count(*)::int from lms.notice_audience(n.id)) end
    from lms.notice n
    cross join lateral (select lms.may_manage_notice(n.id) as yes) m
    left join lms.account w on w.user_id = n.created_by
    left join lms.notice_read r on r.notice_id = n.id and r.user_id = auth.uid()
   where n.org_id = public.current_org_id()
     and lms.may_see_notice(n.id)
   order by n.created_at desc, n.id;
$$;

create or replace function lms.read_notice(p_notice uuid)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
begin
  if p_notice is null or not lms.may_see_notice(p_notice) then
    raise exception 'this notice is not for you';
  end if;
  insert into lms.notice_read (notice_id, user_id) values (p_notice, auth.uid())
  on conflict (notice_id, user_id) do nothing;
end;
$$;

-- The notice's file as base64; no rows when it has none.
create or replace function lms.notice_attachment(p_notice uuid)
returns table (file_name text, mime text, base64 text)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if p_notice is null or not lms.may_see_notice(p_notice) then
    raise exception 'this notice is not for you';
  end if;
  return query
    select n.attachment_name, n.attachment_mime, replace(encode(n.attachment, 'base64'), E'\n', '')
      from lms.notice n
     where n.id = p_notice and n.attachment is not null;
end;
$$;

-- Everyone the notice is for now, and when each first opened it: children
-- by class and roll, then teachers.
create or replace function lms.notice_readers(p_notice uuid)
returns table (
  user_id uuid, display_name text, login_id text, kind text, class_name text, roll_number text, read_at timestamptz
)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if p_notice is null or not lms.may_manage_notice(p_notice) then
    raise exception 'only whoever sent it, or the school admin, can see who has read this notice';
  end if;
  return query
    select au.user_id, a.display_name, a.login_id, au.kind,
           case when sec.id is not null then sec.grade || sec.name end,
           au.roll_number, nr.read_at
      from lms.notice_audience(p_notice) au
      join lms.account a on a.user_id = au.user_id
      left join lms.section sec on sec.id = au.section_id
      left join lms.notice_read nr on nr.notice_id = p_notice and nr.user_id = au.user_id
     order by au.kind, sec.grade, sec.name,
              case when au.roll_number ~ '^[0-9]{1,9}$' then au.roll_number::int end nulls last,
              a.display_name;
end;
$$;

revoke all on function lms.may_see_notice(uuid) from public, anon, authenticated;
revoke all on function lms.may_manage_notice(uuid) from public, anon, authenticated;
revoke all on function lms.notice_audience(uuid) from public, anon, authenticated;
revoke all on function lms.send_notice(text, text, uuid[], text, text, text) from public, anon;
revoke all on function lms.delete_notice(uuid) from public, anon;
revoke all on function lms.my_notices() from public, anon;
revoke all on function lms.read_notice(uuid) from public, anon;
revoke all on function lms.notice_attachment(uuid) from public, anon;
revoke all on function lms.notice_readers(uuid) from public, anon;

grant execute on function lms.may_see_notice(uuid) to service_role;
grant execute on function lms.may_manage_notice(uuid) to service_role;
grant execute on function lms.notice_audience(uuid) to service_role;
grant execute on function lms.send_notice(text, text, uuid[], text, text, text) to authenticated, service_role;
grant execute on function lms.delete_notice(uuid) to authenticated, service_role;
grant execute on function lms.my_notices() to authenticated, service_role;
grant execute on function lms.read_notice(uuid) to authenticated, service_role;
grant execute on function lms.notice_attachment(uuid) to authenticated, service_role;
grant execute on function lms.notice_readers(uuid) to authenticated, service_role;
