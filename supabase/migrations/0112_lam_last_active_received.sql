-- "LAST ACTIVE" IS THE SERVER'S CLOCK (lam-one-brain Task 13, D28).
--
-- lms.school_students (0105) took a child's last activity from
-- max(ledger_event.at), the phone's clock, which 0006 calls explicitly
-- untrusted. record_evidence (0107) clamps `at` for every new answer, but a
-- row written before it, or by the service role, still made a child read as
-- active in 2099 (or long gone, with the clock set back). This is 0105's
-- function with that one column read from `received_at`, which only Postgres
-- sets, as the founder's list already does (0041), and nothing else changed.
-- The index gives it one read per learner, as ledger_event_user_at (0006) did
-- for `at`.

create index if not exists ledger_event_user_received on public.ledger_event (user_id, received_at desc);
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
               (avg(cs.unassisted_mastery) filter (where cs.unassisted_observations > 0))::float8 as unassisted_mastery,
               coalesce(sum(cs.unassisted_observations), 0)::int as unassisted_observations,
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

revoke all on function lms.school_students(uuid) from public, anon;
grant execute on function lms.school_students(uuid) to authenticated, service_role;
