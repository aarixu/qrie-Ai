// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { makeFinance, rpc, serviceRpc } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { createUser, freshDatabase, type JwtClaims } from './harness.ts';
import { ledgerEvent } from './admin-school-fixtures.ts';
import { keepFlag, populateChild } from './safety-fixtures.ts';

/**
 * ERASURE, WHAT IS KEPT, AND THE CONTEST PURGE (migration 0069). Written first.
 *
 * Erasure has one door: a request recorded with a reference that is never an
 * email or a phone number, verified (a school student must have left first),
 * then erased by the owner with a fresh code. Photos are removed from Storage
 * first (admin-api, Task 10); only then do the rows go, by deleting the auth
 * user, whose foreign keys this file pins one by one. The login ID leaves the
 * school's activity log and the request. One child-erased row is written.
 */

/** Every foreign key to auth.users, measured 2026-10-08, with its delete rule (c cascade, n set null, r restrict). */
const FOREIGN_KEYS = (
  'admin.platform_staff.user_id:r admin.user_block.user_id:c concept_state.user_id:c consent_record.user_id:c ' +
  'contest_signup.user_id:c learner.auth_user_id:c learner_model.user_id:c learning_session.user_id:c ' +
  'ledger_event.user_id:c lms.account.user_id:c lms.assignment.created_by:n lms.assignment_student.student_user_id:c ' +
  'lms.attendance.marked_by:n lms.attendance.student_user_id:c lms.audit_event.actor:n ' +
  'lms.enrolment.student_user_id:c lms.event.created_by:n lms.guardian.parent_user_id:c ' +
  'lms.guardian.student_user_id:c lms.item.created_by:n lms.item_approval.approved_by:n lms.item_draft.created_by:c ' +
  'lms.mark.marked_by:n lms.mark_history.changed_by:n lms.notice.created_by:n lms.notice_read.user_id:c ' +
  'lms.report_remark.student_user_id:c lms.report_remark.written_by:n lms.submission.student_user_id:c ' +
  'lms.task_done.student_user_id:c lms.teaching_assignment.teacher_user_id:c lms.test_answer.student_user_id:c ' +
  'lms.test_start.student_user_id:c lms.work_comment.student_user_id:c lms.work_comment.written_by:n ' +
  'lms.work_status.set_by:n lms.work_status.student_user_id:c membership.user_id:c otp_send.user_id:c ' +
  'prep_lock.user_id:c relay_usage.user_id:c student_report.user_id:c student_state.user_id:c usage_event.user_id:c'
).split(' ');

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let child: string;
let direct: string;
let school: School;
let kid: { login: string; parent: string; assignment: string; photo: string };
let today: string;
let requestId: string;
let otherRequest: string;
let directRequest: string;

const day = async (offset: number) =>
  (await db.query<{ d: string }>(`select (lms.india_today() + $1::int)::text as d`, [offset])).rows[0].d;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  finance = await makeFinance(db);
  child = await anonymousChild(db);
  direct = await createUser(db);
  school = await buildSchool(db, 'ERA');
  kid = await populateChild(db, school, school.kid8a);
  await rpc(db, aal2(ops), 'school_person_disable', { p_code: 'ERA', p_login: kid.login, p_reason: 'left the school', p_env: 'TEST' });
  today = await day(0);
});
afterAll(async () => {
  await db.close();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const call = <T>(claims: JwtClaims, fn: string, args: Record<string, unknown> = {}) => rpc<T>(db, claims, fn, args);
const intake = async (claims: JwtClaims, over: Record<string, unknown> = {}) =>
  call<{ requestId: string }>(claims, 'erasure_intake', {
    p_channel: 'email',
    p_requester: 'parent',
    p_reference: 'MAIL 2026/11 #4',
    p_code: 'ERA',
    p_login: kid.login,
    p_user: null,
    p_received_on: await day(-2),
    p_reason: 'a parent asked by email',
    p_env: 'TEST',
    ...over,
  });
const verify = (claims: JwtClaims, id: string, how = 'parent-callback') =>
  call(claims, 'erasure_verify', { p_request: id, p_how: how, p_reason: 'rang the parent back', p_env: 'TEST' });
const prepare = (claims: JwtClaims, id: string) =>
  call<{ requestId: string; userId: string; bucket: string; objects: string[] }>(claims, 'erasure_prepare', {
    p_request: id, p_reason: 'verified request', p_env: 'TEST',
  });
const complete = (id: string, photos: number) => serviceRpc<Record<string, unknown>>(db, 'erasure_complete', { p_request: id, p_objects_removed: photos });
const fkCounts = async (user: string) => {
  const { rows } = await db.query<{ tbl: string; col: string }>(
    `select format('%I.%I', n.nspname, c2.relname) as tbl, a.attname::text as col
       from pg_constraint c
       join pg_class c2 on c2.oid = c.conrelid
       join pg_namespace n on n.oid = c2.relnamespace
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.confrelid = 'auth.users'::regclass and c.contype = 'f'`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) {
    const { n } = await one<{ n: number }>(`select count(*)::int as n from ${r.tbl} where ${r.col} = $1`, [user]);
    if (n > 0) out[`${r.tbl}.${r.col}`] = n;
  }
  return out;
};

describe('what erasure reaches', () => {
  it('every foreign key to auth.users is one this plan has looked at', async () => {
    const { rows } = await db.query<{ s: string }>(
      `select c.conrelid::regclass::text || '.' || a.attname::text || ':' || c.confdeltype::text as s
         from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.confrelid = 'auth.users'::regclass and c.contype = 'f' order by 1`,
    );
    expect(rows.map((r) => r.s)).toEqual([...FOREIGN_KEYS].sort());
    expect(rows).toHaveLength(44);
  });
});

describe('a request', () => {
  it('ops records a request with a reference that is never an email or a phone number, for a school student or a direct user', async () => {
    const ref = /a reference is 3 to 60 letters, digits, spaces, #, \/, _ or -, and never an email address or a phone number/;
    await expect(intake(aal2(ops), { p_reference: 'a@b.co' })).rejects.toThrow(ref);
    await expect(intake(aal2(ops), { p_reference: '9876543210' })).rejects.toThrow(ref);
    await expect(intake(aal2(ops), { p_reference: 'ab' })).rejects.toThrow(ref);
    await expect(intake(aal2(ops), { p_channel: 'fax' })).rejects.toThrow(/a request came by email, phone, letter, school or in-app/);
    await expect(intake(aal2(ops), { p_requester: 'neighbour' })).rejects.toThrow(/the request is from a parent, the student, the school or someone else/);
    const when = /the day it was received is in the last year, not in the future/;
    await expect(intake(aal2(ops), { p_received_on: await day(1) })).rejects.toThrow(when);
    await expect(intake(aal2(ops), { p_received_on: await day(-400) })).rejects.toThrow(when);
    await expect(intake(aal2(ops), { p_login: 'ERA-T1' })).rejects.toThrow(/only a student's account is erased from here/);
    await expect(intake(aal2(ops), { p_login: 'ERA-999' })).rejects.toThrow(/there is no one at this school with the ID ERA-999/);
    await expect(intake(aal2(ops), { p_code: null, p_login: null, p_user: ops.id })).rejects.toThrow(/a member of staff is not erased from here/);
    await expect(intake(aal2(ops), { p_code: null, p_login: null, p_user: school.kid8b })).rejects.toThrow(/that user is not a direct user/);
    await expect(intake(aal2(ops), { p_code: null, p_login: null })).rejects.toThrow(
      /name the child: a school code and login ID, or a direct user's ID/,
    );
    for (const claims of [aal2(safety), aal2(finance), { sub: child, aal: 'aal2' as const }]) {
      await expect(intake(claims)).rejects.toThrow(/not allowed/);
    }
    requestId = (await intake(aal2(ops))).requestId;
    await expect(intake(aal2(ops))).rejects.toThrow(/this child already has an open request/);
    directRequest = (await intake(aal2(owner), { p_code: null, p_login: null, p_user: direct, p_channel: 'in-app', p_requester: 'student' })).requestId;
    const audit = await one<{ details: unknown; target_id: string }>(
      `select details, target_id from admin.audit_event where action = 'erasure-requested' and target_id = $1`,
      [requestId],
    );
    expect(audit.details).toEqual({ requestId, subjectKind: 'school-student', school: 'ERA' });
    expect(JSON.stringify(audit)).not.toContain(kid.login);
  });

  it('the list shows the due day and no names; one request shows the name and what would be erased', async () => {
    const list = await call<{ id: string; receivedOn: string; dueOn: string; daysLeft: number; loginId: string | null; school: { code: string } | null; subjectKind: string; status: string }[]>(
      aal2(ops), 'erasure_requests',
    );
    const mine = list.find((r) => r.id === requestId)!;
    expect(mine).toMatchObject({ receivedOn: await day(-2), dueOn: await day(28), daysLeft: 28, loginId: kid.login, school: { code: 'ERA' }, subjectKind: 'school-student', status: 'received' });
    expect(list.find((r) => r.id === directRequest)).toMatchObject({ subjectKind: 'direct', school: null, loginId: null });
    expect(JSON.stringify(list)).not.toContain('Riya');
    const d = await call<{ displayName: string; left: boolean; preview: { rows: Record<string, number>; photos: number; activityLogLines: number } }>(
      aal2(ops), 'erasure_request', { p_request: requestId },
    );
    expect(d.displayName).toBe('Riya');
    expect(d.left).toBe(true);
    for (const key of [
      'lms.account.user_id',
      'public.student_report.user_id',
      'public.learning_session.user_id',
      'public.ledger_event.user_id',
      'public.usage_event.user_id',
      'public.student_state.user_id',
      'public.consent_record.user_id',
      'public.contest_signup.user_id',
      'lms.submission.student_user_id',
      'lms.attendance.student_user_id',
      'lms.work_comment.student_user_id',
      'lms.notice_read.user_id',
      'lms.guardian.student_user_id',
      'lms.enrolment.student_user_id',
    ]) {
      expect(d.preview.rows[key], key).toBeGreaterThan(0);
    }
    expect(d.preview.photos).toBe(1);
    expect(d.preview.activityLogLines).toBeGreaterThanOrEqual(2);
    await expect(call(aal2(safety), 'erasure_request', { p_request: requestId })).rejects.toThrow(/not allowed/);
    await expect(call(aal2(finance), 'erasure_requests')).rejects.toThrow(/not allowed/);
  });

  it('a school student must have left before the request is verified', async () => {
    otherRequest = (await intake(aal2(ops), { p_login: 'ERA-102', p_reference: 'LETTER 7' })).requestId;
    await expect(verify(aal2(ops), otherRequest)).rejects.toThrow(
      /mark this child as left first \(the school admin, or Disable on their card\)/,
    );
    await expect(verify(aal2(ops), requestId, 'a hunch')).rejects.toThrow(
      /say how the request was verified: school-confirmed, parent-callback, in-person or account-signed-in/,
    );
  });

  it('only the owner with a fresh code starts an erasure, and only a verified one', async () => {
    await expect(prepare(fresh(owner), requestId)).rejects.toThrow(/only a verified request is erased/);
    await verify(aal2(ops), requestId);
    await expect(verify(aal2(ops), requestId)).rejects.toThrow(/only a received request is verified/);
    await expect(prepare(fresh(ops), requestId)).rejects.toThrow(/not allowed/);
    await expect(prepare(aal2(owner), requestId)).rejects.toThrow(/confirm with your authenticator code first/);
    const got = await prepare(fresh(owner), requestId);
    expect(got).toEqual({ requestId, userId: school.kid8a, bucket: 'lms-work', objects: [kid.photo] });
    expect((await one<{ status: string }>(`select status from admin.erasure_request where id = $1`, [requestId])).status).toBe('erasing');
  });

  it('nothing is erased while a photo remains, and the request stays erasing', async () => {
    await expect(complete(requestId, 0)).rejects.toThrow(/1 photos of this child are still in storage/);
    expect((await one<{ status: string }>(`select status from admin.erasure_request where id = $1`, [requestId])).status).toBe('erasing');
    expect((await one<{ n: number }>(`select count(*)::int as n from lms.account where user_id = $1`, [school.kid8a])).n).toBe(1);
  });

  it('once the photos are gone, every row about the child goes, the login ID leaves the school\'s activity log, and one child-erased row is written', async () => {
    await db.query(`delete from storage.objects where bucket_id = 'lms-work' and name = $1`, [kid.photo]);
    const out = await complete(requestId, 1);
    expect(out).toMatchObject({ requestId, photos: 1 });
    expect((out.activityLogLines as number) >= 2).toBe(true);
    expect((out.rows as Record<string, number>)['lms.account.user_id']).toBe(1);
    expect(await fkCounts(school.kid8a)).toEqual({});
    expect((await one<{ n: number }>(`select count(*)::int as n from auth.users where id = $1`, [school.kid8a])).n).toBe(0);
    const log = await db.query<{ t: string }>(`select target || ' ' || details::text as t from lms.audit_event where org_id = $1`, [school.org]);
    expect(log.rows.some((r) => r.t.includes(kid.login))).toBe(false);
    expect(log.rows.some((r) => r.t.includes('[erased]'))).toBe(true);
    const req = await one<{ status: string; login_id: string | null; tallies: { photos: number } }>(
      `select status, login_id, tallies from admin.erasure_request where id = $1`,
      [requestId],
    );
    expect(req.status).toBe('erased');
    expect(req.login_id).toBeNull();
    expect(req.tallies.photos).toBe(1);
    const erased = await db.query<{ actor: string }>(
      `select actor from admin.audit_event where action = 'child-erased' and target_id = $1`,
      [requestId],
    );
    expect(erased.rows).toEqual([{ actor: owner.id }]);
    expect((await one<{ n: number }>(`select count(*)::int as n from auth.users where id = $1`, [kid.parent])).n).toBe(1);
    await expect(complete(requestId, 1)).rejects.toThrow(/this request is not being erased/);
  });

  it('the request is refused by the owner with a reason, and a closed request cannot be erased', async () => {
    await expect(call(aal2(ops), 'erasure_refuse', { p_request: otherRequest, p_reason: 'not the parent', p_env: 'TEST' })).rejects.toThrow(/not allowed/);
    await call(aal2(owner), 'erasure_refuse', { p_request: otherRequest, p_reason: 'the caller was not the parent', p_env: 'TEST' });
    const r = await one<{ status: string; refused_reason: string }>(`select status, refused_reason from admin.erasure_request where id = $1`, [otherRequest]);
    expect(r).toEqual({ status: 'refused', refused_reason: 'the caller was not the parent' });
    await expect(call(aal2(owner), 'erasure_refuse', { p_request: otherRequest, p_reason: 'again', p_env: 'TEST' })).rejects.toThrow(
      /only an open request is refused/,
    );
    await expect(prepare(fresh(owner), otherRequest)).rejects.toThrow(/only a verified request is erased/);
    await expect(call(aal2(owner), 'erasure_refuse', { p_request: requestId, p_reason: 'too late', p_env: 'TEST' })).rejects.toThrow(
      /only an open request is refused/,
    );
  });

  it('a direct user is erased the same way and their solo organisation goes with them', async () => {
    const solo = await db.query<{ id: string }>(
      `select o.id from public.organization o join public.membership m on m.org_id = o.id where m.user_id = $1 and o.kind = 'solo'`,
      [direct],
    );
    expect(solo.rows).toHaveLength(1);
    await verify(aal2(ops), directRequest, 'account-signed-in');
    expect((await prepare(fresh(owner), directRequest)).objects).toEqual([]);
    await complete(directRequest, 0);
    expect(await fkCounts(direct)).toEqual({});
    expect((await one<{ n: number }>(`select count(*)::int as n from public.organization where id = $1`, [solo.rows[0].id])).n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.organization where id = $1`, [school.org])).n).toBe(1);
  });
});

describe('what is kept', () => {
  it('the retention truth names every job it claims, and lists the tables it says it covers', async () => {
    for (const who of [owner, ops, safety]) {
      const t = await call<{
        rows: { what: string; tables: string[]; holds: string; kept: string; enforcedBy: string; job: { name: string; schedule: string | null } | null }[];
        contest: { purgeOn: string | null; purgedAt: string | null };
        distressCapture: { state: string };
      }>(aal2(who), 'retention_truth');
      const jobs = (await db.query<{ jobname: string; schedule: string }>(`select jobname, schedule from cron.job`)).rows;
      for (const row of t.rows) {
        expect(Object.keys(row).sort()).toEqual(['enforcedBy', 'holds', 'job', 'kept', 'tables', 'what']);
        if (row.enforcedBy.startsWith('job ')) {
          expect(row.job, row.what).not.toBeNull();
          expect(jobs.find((j) => j.jobname === row.job!.name), row.job!.name).toBeDefined();
          expect(row.job!.schedule).toBe(jobs.find((j) => j.jobname === row.job!.name)!.schedule);
        } else {
          expect(row.job, row.what).toBeNull();
        }
      }
      const tables = t.rows.flatMap((r) => r.tables);
      for (const name of ['public.usage_event', 'public.otp_send', 'public.contest_signup', 'admin.safety_event', 'public.student_report', 'public.ledger_event']) {
        expect(tables).toContain(name);
      }
      expect(t.contest).toEqual({ purgeOn: null, purgedAt: null });
      expect(t.distressCapture.state).toBe('not-captured');
    }
    await expect(call(aal2(finance), 'retention_truth')).rejects.toThrow(/not allowed/);
  });

  it("the tutor's class and answer records are kept until the account is erased: the nightly purge deletes no event yet", async () => {
    const user = await createUser(db);
    await ledgerEvent(db, school.org, user, 100);
    await db.query(`update public.learning_session set received_at = now() - interval '100 days' where user_id = $1`, [user]);
    await db.query(`select * from public.purge_old_ledger(90)`);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.ledger_event where user_id = $1`, [user])).n).toBe(1);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.learning_session where user_id = $1`, [user])).n).toBe(1);
    const t = await call<{ rows: { tables: string[]; kept: string; enforcedBy: string; job: unknown }[] }>(aal2(owner), 'retention_truth');
    const row = t.rows.find((r) => r.tables.includes('public.ledger_event'))!;
    expect(row.kept).toBe('until the account is erased (a sitting with no events goes after 90 days)');
    expect(row.enforcedBy).toBe(
      'nothing yet: job purge-old-ledger deletes no event until the server fold sets purge_safe_before, and nothing sets it (0021)',
    );
    expect(row.job).toBeNull();
  });

  it('the purge date is the owner\'s, with a fresh code, from tomorrow to two years ahead', async () => {
    const set = (claims: JwtClaims, on: string) => call(claims, 'contest_purge_set', { p_on: on, p_reason: 'prizes are posted', p_env: 'TEST' });
    await expect(set(fresh(ops), await day(1))).rejects.toThrow(/not allowed/);
    await expect(set(aal2(owner), await day(1))).rejects.toThrow(/confirm with your authenticator code first/);
    await expect(set(fresh(owner), today)).rejects.toThrow(/a purge date is from tomorrow to two years ahead/);
    await expect(set(fresh(owner), await day(731))).rejects.toThrow(/a purge date is from tomorrow to two years ahead/);
  });

  it('the contest purge clears personal fields of entries made before its day and keeps the counts', async () => {
    const before = await createUser(db);
    const after = await createUser(db);
    const entry = (user: string, created: string) =>
      db.query(
        `insert into public.contest_signup (user_id, student_name, klass, student_phone, address, takes_tuition, city, school_name, campaign,
                                            parent_name_unverified, parent_phone_unverified, created_at)
         values ($1, 'Asha', 7, '+919800000001', '1 Lake Road', true, 'Pune', 'Lake School', 'diwali', 'Her parent', '+919800000002', ${created})`,
        [user],
      );
    await entry(before, `now() - interval '3 days'`);
    await entry(after, 'now()');
    await call(fresh(owner), 'contest_purge_set', { p_on: await day(1), p_reason: 'prizes are posted', p_env: 'TEST' });
    expect((await one<{ v: string }>(`select value #>> '{}' as v from admin.setting where key = 'contest_purge_on'`)).v).toBe(await day(1));
    expect((await one<{ details: unknown }>(`select details from admin.audit_event where action = 'contest-purge-set'`)).details).toEqual({ on: await day(1) });
    // The day passes.
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(`update admin.setting set value = to_jsonb((lms.india_today() - 1)::text) where key = 'contest_purge_on'`);
    });
    const out = await serviceRpc<{ contestEntriesCleared: number; flagsDeleted: number }>(db, 'privacy_daily', {});
    expect(out.contestEntriesCleared).toBe(1);
    const cleared = await one<Record<string, unknown>>(
      `select student_name, student_phone, address, city, school_name, parent_name_unverified, parent_phone_unverified, klass, campaign, takes_tuition
         from public.contest_signup where user_id = $1`,
      [before],
    );
    expect(cleared).toEqual({
      student_name: '', student_phone: null, address: null, city: null, school_name: null,
      parent_name_unverified: null, parent_phone_unverified: null, klass: 7, campaign: 'diwali', takes_tuition: true,
    });
    const kept = await one<{ student_name: string; address: string }>(`select student_name, address from public.contest_signup where user_id = $1`, [after]);
    expect(kept).toEqual({ student_name: 'Asha', address: '1 Lake Road' });
    expect((await one<{ v: string | null }>(`select value #>> '{}' as v from admin.setting where key = 'contest_purged_at'`)).v).not.toBeNull();
    const audit = await one<{ details: unknown; actor_role: string }>(`select details, actor_role from admin.audit_event where action = 'contest-purged'`);
    expect(audit).toEqual({ details: { entries: 1 }, actor_role: 'service' });
    // A second night clears nothing more.
    expect((await serviceRpc<{ contestEntriesCleared: number }>(db, 'privacy_daily', {})).contestEntriesCleared).toBe(0);
    const t = await call<{ contest: { purgeOn: string | null; purgedAt: string | null } }>(aal2(owner), 'retention_truth');
    expect(t.contest.purgeOn).toBe(await day(-1));
    expect(t.contest.purgedAt).not.toBeNull();
  });

  it('distress flags older than a year are deleted by the daily job, newer ones stay', async () => {
    const old = crypto.randomUUID();
    const recent = crypto.randomUUID();
    await keepFlag(db, school.kid8b, { id: old });
    await keepFlag(db, school.kid8b, { id: recent });
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(`update admin.safety_event set received_at = now() - interval '400 days' where id = $1`, [old]);
    });
    const out = await serviceRpc<{ flagsDeleted: number }>(db, 'privacy_daily', {});
    expect(out.flagsDeleted).toBe(1);
    const { rows } = await db.query<{ id: string }>(`select id from admin.safety_event`);
    expect(rows.map((r) => r.id)).toEqual([recent]);
  });

  it('the daily job is scheduled at 01:15 India time', async () => {
    const job = await one<{ schedule: string; command: string }>(`select schedule, command from cron.job where jobname = 'admin-privacy-daily'`);
    expect(job.schedule).toBe('45 19 * * *');
    expect(job.command).toContain('admin.privacy_daily()');
  });
});
