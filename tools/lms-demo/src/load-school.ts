import type { PGlite } from '@electric-sql/pglite';

/**
 * A SCHOOL OF 1,500, for timing the reads a big school makes every day
 * (tests/load.test.ts, run with LMS_LOAD=1).
 *
 * 1,500 students in 50 sections (grades 6 to 10, A to J, 30 each), 60
 * teachers, five subjects, and 40 pieces of published work per section
 * (eight per subject: four MCQ homeworks, a checklist, a test on paper with
 * marks, an online test, and an MCQ homework still open), with hand-ins,
 * late ones, answers, second tries, notebook photos, MCQ marks, teachers'
 * marks, ticks, absences, two ledger answers per first MCQ try and the brain's
 * beliefs. Beside them, the people a report must leave out: Science practice
 * set for five children of each section (0040), ten children who have left
 * with their hand-ins (0034), and last year's 6B with its work (0037).
 * Written straight into the tables as the database owner with triggers off
 * — a load, not a test of the write paths — then ANALYZEd. Every person,
 * class, subject, piece of work and hand-in has a fixed id (md5 of a name),
 * and what each child did is fixed too, so two builds hold the same school.
 * Dates are counted back from when it is built.
 */

const ORG = `md5('load-org')::uuid`;
const YEAR = `md5('load-year')::uuid`;
const SUBJECTS = `array['Mathematics', 'Science', 'English', 'Social Science', 'Hindi']`;
const user = (n: string) => `md5('load-user-' || ${n})::uuid`;
const section = (s: string) => `md5('load-section-' || ${s})::uuid`;
const subject = (j: string) => `md5('load-subject-' || ${j})::uuid`;
const work = (s: string, j: string, k: string) => `md5('load-work-' || ${s} || '-' || ${j} || '-' || ${k})::uuid`;
// The teacher of section s, subject j: one of 60, in turn.
const teacherOf = (s: string, j: string) => user(`(1501 + (${s} * 5 + ${j}) % 60)`);

const SCHOOL = `
set session_replication_role = replica;

insert into public.organization (id, kind, name) values (${ORG}, 'school', 'Load School');
insert into lms.school (org_id, code, display_name, board) values (${ORG}, 'LOAD', 'Load Test School', 'CBSE');
insert into lms.academic_year (id, org_id, label, starts_on, ends_on)
values (${YEAR}, ${ORG}, '2026-27', current_date - 180, current_date + 180);

-- 1-1500 students, 1501-1560 teachers, 1561 the admin.
insert into auth.users (id, raw_app_meta_data)
select ${user('n')}, '{"provisioned_by":"school"}'::jsonb from generate_series(1, 1561) n;
insert into public.membership (org_id, user_id, role)
select ${ORG}, ${user('n')}, case when n <= 1500 then 'student' when n <= 1560 then 'teacher' else 'admin' end
  from generate_series(1, 1561) n;
insert into lms.account (org_id, user_id, login_id, kind, display_name)
select ${ORG}, ${user('n')}, 'LOAD-' || lpad(n::text, 4, '0'),
       case when n <= 1500 then 'student' when n <= 1560 then 'teacher' else 'admin' end,
       case when n <= 1500 then 'Student ' when n <= 1560 then 'Teacher ' else 'Admin ' end || n
  from generate_series(1, 1561) n;

insert into lms.subject (id, org_id, name)
select ${subject('j')}, ${ORG}, (${SUBJECTS})[j + 1] from generate_series(0, 4) j;
insert into lms.section (id, org_id, academic_year_id, grade, name)
select ${section('s')}, ${ORG}, ${YEAR}, 6 + s / 10, chr(65 + s % 10) from generate_series(0, 49) s;
insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id)
select ${ORG}, ${section('s')}, ${subject('j')}, ${teacherOf('s', 'j')}
  from generate_series(0, 49) s cross join generate_series(0, 4) j;
insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number, joined_on)
select ${ORG}, ${YEAR}, ${section('(n - 1) / 30')}, ${user('n')}, ((n - 1) % 30 + 1)::text, current_date - 180
  from generate_series(1, 1500) n;

-- The curriculum and the library: ten outcomes in five chapters, and twenty
-- questions, per grade and subject; all approved for the school.
insert into lms.outcome (id, grade, subject, chapter, title, position)
select 'load-g' || g || '-s' || j || '-o' || o, g, (${SUBJECTS})[j + 1], 'chapter-' || (o / 2), 'Outcome ' || o, o
  from generate_series(6, 10) g cross join generate_series(0, 4) j cross join generate_series(0, 9) o;
insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
select 'load-' || g || '-' || j || '-' || q, array['load-g' || g || '-s' || j || '-o' || (q % 10)], g,
       (${SUBJECTS})[j + 1], 'mcq', 'Question ' || q, '["a","b","c","d"]'::jsonb, 0, '["","x","y","z"]'::jsonb
  from generate_series(6, 10) g cross join generate_series(0, 4) j cross join generate_series(0, 19) q;
insert into lms.item_approval (org_id, item_id) select ${ORG}, id from lms.item where library_ref like 'load-%';

-- Forty pieces of work per section, eight per subject (k).
insert into lms.assignment (id, org_id, section_id, subject_id, created_by, kind, title, due_at, published_at,
                            attempts_allowed, answer_types, time_limit_minutes, max_marks, results_released_at)
select ${work('s', 'j', 'k')}, ${ORG}, ${section('s')}, ${subject('j')}, ${teacherOf('s', 'j')},
       case when k in (5, 6) then 'test' else 'homework' end,
       (array['Homework 1', 'Homework 2', 'Homework 3', 'Homework 4', 'Notebook', 'Paper test', 'Online test', 'Homework 5'])[k + 1],
       d.due, d.due - interval '6 days',
       case when k < 4 then 2 else 1 end,
       case when k = 2 then array['mcq', 'photo'] when k = 4 then array['checklist'] when k = 5 then array['paper']
            else array['mcq'] end,
       case when k = 6 then 30::smallint end,
       case when k = 5 then 20 end,
       case when k = 5 then d.due + interval '2 days' when k = 6 and j % 2 = 0 then d.due + interval '1 day' end
  from generate_series(0, 49) s cross join generate_series(0, 4) j cross join generate_series(0, 7) k
  cross join lateral (
    select now() - make_interval(days => (array[52, 44, 36, 26, 18, 12, 5, -3])[k + 1])
                 + make_interval(hours => j * 3, mins => s) as due
  ) d;
insert into lms.assignment_task (assignment_id, position, text)
select ${work('s', 'j', '4')}, p, 'Exercise ' || p
  from generate_series(0, 49) s cross join generate_series(0, 4) j cross join generate_series(1, 3) p;
insert into lms.assignment_item (assignment_id, item_id, position)
select ${work('s', 'j', 'k')}, i.id, p + 1
  from generate_series(0, 49) s cross join generate_series(0, 4) j cross join unnest(array[0, 1, 2, 3, 6, 7]) k
  cross join generate_series(0, 4) p
  join lms.item i on i.library_ref = 'load-' || (6 + s / 10) || '-' || j || '-' || ((k * 5 + p) % 20);

-- Each child and piece of work: h, a fixed number from 0 to 99, decides
-- what they did.
create temp table load_pair as
select n, (n - 1) / 30 as s, j, k, a.id as assignment_id, a.due_at, a.kind,
       abs(hashtext('load-' || n || '-' || j || '-' || k)) % 100 as h
  from generate_series(1, 1500) n cross join generate_series(0, 4) j cross join generate_series(0, 7) k
  join lms.assignment a on a.id = ${work('(n - 1) / 30', 'j', 'k')};

-- MCQ hand-ins: most of the past work, some of the open; a few late.
insert into lms.submission (id, org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
select md5('load-sub-' || n || '-' || j || '-' || k)::uuid, ${ORG}, assignment_id, ${user('n')}, 'mcq', 1,
       case when k = 6 then due_at - interval '30 minutes'
            when h between 80 and 84 then due_at + interval '1 day'
            else due_at - make_interval(hours => h % 24) end,
       k <> 6 and h between 80 and 84
  from load_pair
 where (k in (0, 1, 2, 3, 6) and h < 85) or (k = 7 and h < 40);
insert into lms.test_start (assignment_id, student_user_id, started_at)
select assignment_id, ${user('n')}, due_at - interval '50 minutes' from load_pair where k = 6 and h < 85;
-- Each MCQ try marked, and some homeworks also marked by the teacher.
insert into lms.mark (submission_id, machine_correct, machine_total, teacher_score, teacher_max, marked_at)
select md5('load-sub-' || n || '-' || j || '-' || k)::uuid, h % 6, 5,
       case when k < 2 and h % 3 = 0 then h % 11 end,
       case when k < 2 and h % 3 = 0 then 10 end,
       case when k < 2 and h % 3 = 0 then due_at + interval '1 day' end
  from load_pair
 where (k in (0, 1, 2, 3, 6) and h < 85) or (k = 7 and h < 40);
-- The answers of each homework hand-in.
insert into lms.submission_answer (submission_id, item_id, chosen_index, correct)
select md5('load-sub-' || p.n || '-' || p.j || '-' || p.k)::uuid, ai.item_id,
       (p.h + ai.position) % 4, (p.h + ai.position) % 4 = 0
  from load_pair p join lms.assignment_item ai on ai.assignment_id = p.assignment_id
 where p.k in (0, 1, 2, 3) and p.h < 85;
-- A second try at some homeworks, two hours after the first.
insert into lms.submission (id, org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
select md5('load-sub2-' || n || '-' || j || '-' || k)::uuid, ${ORG}, assignment_id, ${user('n')}, 'mcq', 2,
       due_at - make_interval(hours => h % 24) + interval '2 hours', false
  from load_pair where k in (0, 1) and h < 80 and h % 5 = 0;
insert into lms.mark (submission_id, machine_correct, machine_total)
select md5('load-sub2-' || n || '-' || j || '-' || k)::uuid, (h + 2) % 6, 5
  from load_pair where k in (0, 1) and h < 80 and h % 5 = 0;
-- Notebook photos for Homework 3 from some: some late, half of them marked.
insert into lms.submission (id, org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
select md5('load-photo-' || n || '-' || j)::uuid, ${ORG}, assignment_id, ${user('n')}, 'photo', 1,
       due_at + make_interval(hours => h % 2 * 5 - 1), h % 2 = 1
  from load_pair where k = 2 and h % 7 = 0;
insert into lms.mark (submission_id, machine_correct, machine_total, teacher_score, teacher_max, marked_at)
select md5('load-photo-' || n || '-' || j)::uuid, 0, 0,
       case when h % 14 = 0 then h % 9 end, case when h % 14 = 0 then 10 end,
       case when h % 14 = 0 then due_at + interval '2 days' end
  from load_pair where k = 2 and h % 7 = 0;

-- The test on paper: marks for most, absent for the rest.
insert into lms.submission (id, org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
select md5('load-sub-' || n || '-' || j || '-' || k)::uuid, ${ORG}, assignment_id, ${user('n')}, 'paper', 1,
       due_at + interval '1 day', false
  from load_pair where k = 5 and h < 95;
insert into lms.mark (submission_id, machine_correct, machine_total, teacher_score, teacher_max, marked_at)
select md5('load-sub-' || n || '-' || j || '-' || k)::uuid, 0, 0, h % 21, 20, due_at + interval '1 day'
  from load_pair where k = 5 and h < 95;
insert into lms.work_status (assignment_id, student_user_id, status, set_at)
select assignment_id, ${user('n')}, 'absent', due_at + interval '1 day' from load_pair where k = 5 and h >= 95;

-- The checklist: every exercise ticked by most, one by some; half of the
-- class checked by the teacher.
insert into lms.task_done (task_id, student_user_id, done_at)
select t.id, ${user('n')}, p.due_at - interval '2 hours'
  from load_pair p join lms.assignment_task t on t.assignment_id = p.assignment_id
 where p.k = 4 and (p.h < 80 or (p.h < 90 and t.position = 1));
insert into lms.work_status (assignment_id, student_user_id, status, set_at)
select assignment_id, ${user('n')}, 'checked', due_at + interval '1 day' from load_pair where k = 4 and h < 50;

-- Two answers in the ledger per first MCQ try.
insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
select md5('load-ev-' || p.n || '-' || p.j || '-' || p.k || '-' || q)::uuid, ${ORG}, ${user('p.n')},
       md5('load-sub-' || p.n || '-' || p.j || '-' || p.k)::uuid, q, p.due_at - make_interval(hours => p.h % 24),
       'answered', case when p.k = 6 then 'test' else 'homework' end, 'tap',
       array['load-g' || (6 + p.s / 10) || '-s' || p.j || '-o' || ((p.k + q) % 10)],
       jsonb_build_object('correct', (p.h + q) % 2 = 0)
  from load_pair p cross join generate_series(0, 1) q
 where (p.k in (0, 1, 2, 3, 6) and p.h < 85) or (p.k = 7 and p.h < 40);

-- Science practice in each section for its first five children only
-- (0040), handed in by most of them.
insert into lms.assignment (id, org_id, section_id, subject_id, created_by, kind, title, due_at, published_at,
                            attempts_allowed, answer_types)
select md5('load-practice-' || s)::uuid, ${ORG}, ${section('s')}, ${subject('1')}, ${teacherOf('s', '1')},
       'homework', 'Practice', now() - interval '10 days', now() - interval '12 days', 1, array['mcq']
  from generate_series(0, 49) s;
insert into lms.assignment_student (assignment_id, student_user_id, org_id)
select md5('load-practice-' || s)::uuid, ${user('s * 30 + r')}, ${ORG}
  from generate_series(0, 49) s cross join generate_series(1, 5) r;
insert into lms.submission (id, org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
select md5('load-practice-sub-' || s || '-' || r)::uuid, ${ORG}, md5('load-practice-' || s)::uuid,
       ${user('s * 30 + r')}, 'mcq', 1, now() - interval '11 days', false
  from generate_series(0, 49) s cross join generate_series(1, 4) r;
insert into lms.mark (submission_id, machine_correct, machine_total)
select md5('load-practice-sub-' || s || '-' || r)::uuid, (s + r) % 6, 5
  from generate_series(0, 49) s cross join generate_series(1, 4) r;

-- Ten children who have left (0034): last in 6A, their hand-ins kept.
insert into auth.users (id, raw_app_meta_data)
select ${user('n')}, '{"provisioned_by":"school"}'::jsonb from generate_series(1562, 1571) n;
insert into lms.account (org_id, user_id, login_id, kind, display_name, left_at)
select ${ORG}, ${user('n')}, 'LOAD-' || n, 'student', 'Leaver ' || n, now() - interval '10 days'
  from generate_series(1562, 1571) n;
insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number, joined_on, left_on)
select ${ORG}, ${YEAR}, ${section('0')}, ${user('n')}, (n - 1531)::text, current_date - 180, current_date - 10
  from generate_series(1562, 1571) n;
insert into lms.submission (id, org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
select md5('load-leaver-sub-' || n || '-' || j || '-' || k)::uuid, ${ORG}, ${work('0', 'j', 'k')}, ${user('n')},
       'mcq', 1, now() - interval '60 days', false
  from generate_series(1562, 1571) n cross join generate_series(0, 4) j cross join generate_series(0, 3) k;

-- Last year: 6B, now 7B, with five pieces of Mathematics work and every
-- child's hand-in; its enrolments closed when this year began.
insert into lms.academic_year (id, org_id, label, starts_on, ends_on)
values (md5('load-last-year')::uuid, ${ORG}, '2025-26', current_date - 545, current_date - 181);
insert into lms.section (id, org_id, academic_year_id, grade, name)
values (md5('load-last-6b')::uuid, ${ORG}, md5('load-last-year')::uuid, 6, 'B');
insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id)
values (${ORG}, md5('load-last-6b')::uuid, ${subject('0')}, ${teacherOf('11', '0')});
insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number, joined_on, left_on)
select ${ORG}, md5('load-last-year')::uuid, md5('load-last-6b')::uuid, ${user('n')}, (n - 330)::text,
       current_date - 545, current_date - 181
  from generate_series(331, 360) n;
insert into lms.assignment (id, org_id, section_id, subject_id, created_by, kind, title, due_at, published_at,
                            attempts_allowed, answer_types)
select md5('load-last-work-' || k)::uuid, ${ORG}, md5('load-last-6b')::uuid, ${subject('0')}, ${teacherOf('11', '0')},
       'homework', 'Last year ' || k, now() - make_interval(days => 200 + k), now() - make_interval(days => 207 + k),
       1, array['mcq']
  from generate_series(1, 5) k;
insert into lms.submission (id, org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
select md5('load-last-sub-' || n || '-' || k)::uuid, ${ORG}, md5('load-last-work-' || k)::uuid, ${user('n')},
       'mcq', 1, now() - make_interval(days => 201 + k), false
  from generate_series(331, 360) n cross join generate_series(1, 5) k;
insert into lms.mark (submission_id, machine_correct, machine_total)
select md5('load-last-sub-' || n || '-' || k)::uuid, (n + k) % 6, 5
  from generate_series(331, 360) n cross join generate_series(1, 5) k;

-- The brain's beliefs: a third of each child's outcomes, most answered.
insert into public.concept_state (org_id, user_id, outcome_id, mastery, unassisted_mastery, assisted_performance,
                                  observations, answer_observations)
select ${ORG}, ${user('n')}, 'load-g' || (6 + (n - 1) / 300) || '-s' || j || '-o' || o,
       ((n * 7 + o * 13 + j) % 100) / 100.0, ((n * 7 + o * 13 + j) % 100) / 100.0, 0.5,
       3, case when o % 4 = 0 then 0 else 2 end
  from generate_series(1, 1500) n cross join generate_series(0, 4) j cross join generate_series(0, 9) o
 where (n + o) % 3 = 0;

drop table load_pair;
set session_replication_role = origin;
analyze;
`;

export interface LoadSchool {
  admin: string;
  /** Student 345: roll 15 of 7B. */
  child: string;
  /** The teacher of 7B Mathematics. */
  teacher: string;
  section7b: string;
  maths: string;
}

export async function buildLoadSchool(db: PGlite): Promise<LoadSchool> {
  await db.exec(SCHOOL);
  const id = async (expr: string) => (await db.query<{ id: string }>(`select ${expr} as id`)).rows[0].id;
  return {
    admin: await id(user('1561')),
    child: await id(user('345')),
    teacher: await id(teacherOf('11', '0')),
    section7b: await id(section('11')),
    maths: await id(subject('0')),
  };
}
