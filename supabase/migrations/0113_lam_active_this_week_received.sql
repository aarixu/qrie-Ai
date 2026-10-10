-- "ACTIVE THIS WEEK" IS THE SERVER'S CLOCK (lam-one-brain M3 review, D28).
--
-- 0112 moved lms.school_students' "last active" to `received_at`, but the
-- school overview (0105) still counted a child as active in the last 7 days
-- from ledger_event.at, the phone's clock: a row written before
-- record_evidence (0107), or by the service role, dated 2099 counted the child
-- as active forever, and a clock set back hid a child who answered just now.
-- This is 0105's function with that one count read from `received_at`, which
-- only Postgres sets, and nothing else changed. ledger_event_received (0007)
-- indexes it. Same signature and columns, so it is replaced in place; its
-- grants are restated below as 0105 set them.

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
             (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8 as unassisted_mastery,
             coalesce(sum(cs.unassisted_observations), 0)::int as unassisted_observations,
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

revoke all on function lms.school_overview() from public, anon;
grant execute on function lms.school_overview() to authenticated, service_role;
