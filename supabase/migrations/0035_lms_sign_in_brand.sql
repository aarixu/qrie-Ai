-- THE SCHOOL'S LOOK ON THE SIGN-IN SCREEN, before anyone signs in.
--
-- A child types an ID that begins with their school's code (DEMO-8A-1), or
-- opens a link that carries it, and the sign-in screen dresses in that
-- school's name, colours and logo. This is the one lms function a signed-out
-- browser (anon) may call, and it gives only what the school already shows
-- every visitor: no people, no counts, nothing about whether an ID exists.
-- A code not written as codes are (0022: 3-12 capitals or digits) finds
-- nothing.
--
-- Written against packages/lms-client/tests/brand.test.ts, first.

create or replace function lms.school_brand(p_code text)
returns table (school_name text, brand jsonb, logo_mime text, logo_base64 text)
language sql stable security definer
set search_path = public, lms
as $$
  select s.display_name, s.brand, l.mime, replace(encode(l.data, 'base64'), E'\n', '')
    from lms.school s
    left join lms.school_logo l on l.org_id = s.org_id
   where p_code ~ '^[A-Z0-9]{3,12}$' and s.code = p_code;
$$;

-- A signed-out browser may reach into the schema for this one function; it
-- holds no grant on any lms table (supabase/tests/lms-invariants.test.ts).
grant usage on schema lms to anon;

revoke all on function lms.school_brand(text) from public;
grant execute on function lms.school_brand(text) to anon, authenticated, service_role;
