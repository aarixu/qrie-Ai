-- THE SCHOOL'S LOGO, for the white label (both apps, and every report card).
--
-- Kept in the database, not Storage: it is one small picture per school,
-- read by everyone in the school on every visit, and a table needs no
-- bucket policy to keep it to that school. The admin sets it: only a PNG or
-- a JPEG that begins and ends as one does, 256 KB at most. The bytes in
-- between are not decoded. Anything else is refused rather than converted —
-- an SVG can carry script.
--
-- Written against packages/lms-client/tests/brand.test.ts, first.

create table if not exists lms.school_logo (
  org_id uuid primary key references lms.school on delete cascade,
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  data bytea not null check (octet_length(data) between 8 and 262144),
  updated_at timestamptz not null default now()
);

-- Reached only through the functions below.
revoke all on lms.school_logo from public, anon, authenticated;
grant all on lms.school_logo to service_role;
alter table lms.school_logo enable row level security;

-- p_mime and p_data null together remove the logo.
create or replace function lms.set_school_logo(p_mime text, p_data text)
returns void
language plpgsql volatile security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
  bytes bytea;
begin
  if p_mime is null and p_data is null then
    delete from lms.school_logo where org_id = org;
    return;
  end if;
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg') then
    raise exception 'a logo must be a PNG or a JPEG';
  end if;
  begin
    bytes := decode(coalesce(p_data, ''), 'base64');
  exception when others then
    raise exception 'that is not a picture';
  end;
  if octet_length(bytes) > 262144 then
    raise exception 'a logo must be 256 KB or smaller';
  end if;
  -- A PNG: its signature, then the IHDR chunk, and the IEND chunk last.
  if p_mime = 'image/png' and (
    octet_length(bytes) < 57
    or substring(bytes from 1 for 8) <> '\x89504e470d0a1a0a'::bytea
    or substring(bytes from 13 for 4) <> '\x49484452'::bytea
    or substring(bytes from octet_length(bytes) - 11 for 12) <> '\x0000000049454e44ae426082'::bytea
  ) then
    raise exception 'that file is not a PNG';
  end if;
  -- A JPEG: its start-of-image marker first and end-of-image marker last.
  if p_mime = 'image/jpeg' and (
    octet_length(bytes) < 8
    or substring(bytes from 1 for 3) <> '\xffd8ff'::bytea
    or substring(bytes from octet_length(bytes) - 1 for 2) <> '\xffd9'::bytea
  ) then
    raise exception 'that file is not a JPEG';
  end if;
  insert into lms.school_logo (org_id, mime, data, updated_at)
  values (org, p_mime, bytes, now())
  on conflict (org_id) do update set mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at;
end;
$$;

-- The caller's own school's logo; no rows when it has none.
create or replace function lms.school_logo()
returns table (mime text, base64 text, updated_at timestamptz)
language sql stable security definer
set search_path = public, lms
as $$
  select l.mime, replace(encode(l.data, 'base64'), E'\n', ''), l.updated_at
    from lms.school_logo l
    join lms.account a on a.org_id = l.org_id
   where a.user_id = auth.uid();
$$;

revoke all on function lms.set_school_logo(text, text) from public, anon;
revoke all on function lms.school_logo() from public, anon;
grant execute on function lms.set_school_logo(text, text) to authenticated, service_role;
grant execute on function lms.school_logo() to authenticated, service_role;
