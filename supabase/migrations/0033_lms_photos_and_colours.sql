-- PHOTOS OF PEOPLE, AND THE SCHOOL'S TWO COLOURS.
--
-- 1. A photo per person — a student's or a teacher's — set by the school's
--    admin only, never by a child or a teacher. Seen only by those who may
--    see the person: a student's by the student, their teachers and the
--    admin (0031's may_see_student); a teacher's by their own school. Only a
--    JPEG that begins and ends as one does, 64 KB at most: the portal
--    shrinks every picture to a small square JPEG before it is sent. Kept in
--    the database, like the logo (0032), so no bucket policy is needed.
-- 2. The school's brand is two colours, `primary` and `accent`, each
--    #rrggbb; any other setting is refused.
--
-- Written against packages/lms-client/tests/photos.test.ts, first.

create table if not exists lms.account_photo (
  user_id uuid primary key references lms.account (user_id) on delete cascade,
  org_id uuid not null references lms.school on delete cascade,
  data bytea not null check (octet_length(data) between 8 and 65536),
  updated_at timestamptz not null default now()
);

-- Reached only through the functions below.
revoke all on lms.account_photo from public, anon, authenticated;
grant all on lms.account_photo to service_role;
alter table lms.account_photo enable row level security;

-- p_data null removes the photo.
create or replace function lms.set_account_photo(p_login_id text, p_data text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  target uuid;
  bytes bytea;
begin
  select a.user_id into target from lms.account a
   where a.org_id = org and a.login_id = upper(btrim(coalesce(p_login_id, '')));
  if target is null then
    raise exception 'there is no one in your school with the ID %', coalesce(p_login_id, '(none)');
  end if;
  if p_data is null then
    delete from lms.account_photo where user_id = target;
    return;
  end if;
  begin
    bytes := decode(p_data, 'base64');
  exception when others then
    raise exception 'that is not a picture';
  end;
  if octet_length(bytes) > 65536 then
    raise exception 'a photo must be 64 KB or smaller';
  end if;
  -- A JPEG: its start-of-image marker first and end-of-image marker last.
  if octet_length(bytes) < 8
     or substring(bytes from 1 for 3) <> '\xffd8ff'::bytea
     or substring(bytes from octet_length(bytes) - 1 for 2) <> '\xffd9'::bytea then
    raise exception 'that file is not a JPEG';
  end if;
  insert into lms.account_photo (user_id, org_id, data, updated_at)
  values (target, org, bytes, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at;
end;
$$;

-- The photos among p_users the caller may see; at most 300 asked for at once.
create or replace function lms.account_photos(p_users uuid[])
returns table (user_id uuid, base64 text, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, lms
as $$
begin
  if coalesce(cardinality(p_users), 0) > 300 then
    raise exception 'ask for at most 300 photos at a time';
  end if;
  return query
    select p.user_id, replace(encode(p.data, 'base64'), E'\n', ''), p.updated_at
      from lms.account_photo p
      join lms.account a on a.user_id = p.user_id
     where p.user_id = any (p_users)
       and case
             when a.kind = 'student' then lms.may_see_student(a.user_id)
             else exists (select 1 from lms.account me where me.user_id = auth.uid() and me.org_id = a.org_id)
           end;
end;
$$;

-- The brand: `primary` and `accent`, each #rrggbb, kept lower-case. 0031's
-- version kept only `primary`.
create or replace function lms.set_school_brand(p_brand jsonb)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  kept jsonb := '{}'::jsonb;
  k text;
  v text;
begin
  if p_brand is null or jsonb_typeof(p_brand) <> 'object' then
    raise exception 'a brand is a set of colours';
  end if;
  for k in select jsonb_object_keys(p_brand) loop
    if k not in ('primary', 'accent') then
      raise exception 'a brand has a primary and an accent colour, not %', k;
    end if;
    v := p_brand ->> k;
    continue when v is null;
    if v !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'a colour is written #rrggbb';
    end if;
    kept := kept || jsonb_build_object(k, lower(v));
  end loop;
  update lms.school set brand = kept where org_id = org;
end;
$$;

revoke all on function lms.set_account_photo(text, text) from public, anon;
revoke all on function lms.account_photos(uuid[]) from public, anon;
grant execute on function lms.set_account_photo(text, text) to authenticated, service_role;
grant execute on function lms.account_photos(uuid[]) to authenticated, service_role;
