// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { tutorSession } from './admin-school-fixtures.ts';
import { makeFinance, rpc } from './billing-fixtures.ts';
import { buildSchool, seat, type School } from './fixtures.ts';
import { applyAfter, asClaims, createUser, freshDatabase, type JwtClaims } from './harness.ts';
import { report, setReport } from './safety-fixtures.ts';

/**
 * REPORT TRIAGE, CASES AND THE READ LOG (migration 0067). Written first.
 *
 * Reports are triaged by kind, age and status, never by their words. A child's
 * words leave the database only through admin.case_report: one report, inside
 * an open case held by the reader, opened with a fresh code and a reason,
 * logged in an insert-only read log, and at most 30 reads a day per person.
 */

const SENTINEL = 'SENTINEL child words 7f3a';
const TUTOR_SENTINEL = 'SENTINEL tutor line 7f3a';
const QUOTA = /you have opened 30 records today, the most in one day/;

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let safety2: Staff;
let finance: { id: string; role: 'finance' };
let child: string;
let direct: string;
let school: School;
let sitting: string;
let rSentinel: string;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety one');
  safety2 = await makeStaff(db, 'safety', 'Safety two');
  finance = await makeFinance(db);
  child = await anonymousChild(db);
  direct = await createUser(db);
  school = await buildSchool(db, 'SAF');
  sitting = await tutorSession(db, school.org, school.kid8a);
  await db.query(
    `insert into public.prepared_class (id, topic_ref, title, klass, subject) values ('CLS-SAF', 'sci/cells/topic', 'Cells', 8, 'science')`,
  );
  rSentinel = await report(db, school.kid8a, {
    kind: 'unsafe',
    note: SENTINEL,
    spokenLine: TUTOR_SENTINEL,
    lessonId: 'CLS-SAF',
    topicRef: 'sci/cells/topic',
    beatId: 'b3',
    sessionId: sitting,
    receivedMinutesAgo: 40,
  });
});
afterAll(async () => {
  await db.close();
});

const call = <T>(claims: JwtClaims, fn: string, args: Record<string, unknown> = {}) => rpc<T>(db, claims, fn, args);
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const open = (claims: JwtClaims, reportId: string, reason = 'the child may be at risk') =>
  call<{ caseId: string }>(claims, 'case_open', { p_report: reportId, p_reason: reason, p_env: 'TEST' });
const close = (claims: JwtClaims, caseId: string, outcome: string, reason = 'dealt with') =>
  call(claims, 'case_close', { p_case: caseId, p_outcome: outcome, p_reason: reason, p_env: 'TEST' });
const mark = (claims: JwtClaims, reportId: string, status: string) =>
  call(claims, 'report_mark', { p_report: reportId, p_status: status, p_reason: 'looked at it', p_env: 'TEST' });

interface ReportRow {
  id: string;
  kind: string;
  status: string;
  receivedAt: string;
  ageMinutes: number;
  seenAt: string | null;
  firstLookMinutes: number | null;
  school: { code: string; name: string } | null;
  lessonId: string;
  platform: string | null;
  openCaseId: string | null;
}
const list = (claims: JwtClaims, args: Record<string, unknown> = {}) =>
  call<{ rows: ReportRow[]; more: boolean }>(claims, 'safety_reports', args);

describe("0019's statuses (ruling R7)", () => {
  it("0019's statuses become read, triaged and closed, and unread stays new", async () => {
    const old = await freshDatabase({ through: '0066' });
    try {
      const kid = await createUser(old);
      for (const [i, status] of ['new', 'seen', 'actioned', 'dismissed'].entries()) {
        await old.query(
          `insert into public.student_report (user_id, kind, note, lesson_id, at, status) values ($1, 'wrong', 'n', 'L', now() - make_interval(secs => $2::int), $3)`,
          [kid, i, status],
        );
      }
      await applyAfter(old, '0066');
      const { rows } = await old.query<{ status: string }>(`select status from public.student_report order by at desc`);
      expect(rows.map((r) => r.status)).toEqual(['new', 'seen', 'triaged', 'closed']);
      await expect(
        old.query(`insert into public.student_report (user_id, kind, note, lesson_id, at, status) values ($1, 'wrong', 'n', 'L2', now(), 'actioned')`, [kid]),
      ).rejects.toThrow(/student_report_status_check/);
    } finally {
      await old.close();
    }
  });
});

describe('the report list', () => {
  it('the list orders unread reports oldest first, then the rest newest first, and filters by status, kind and school', async () => {
    const ord = await buildSchool(db, 'ORD');
    const a = await report(db, ord.kid8a, { kind: 'wrong', receivedMinutesAgo: 50 });
    const b = await report(db, ord.kid8b, { kind: 'unsafe', receivedMinutesAgo: 10 });
    const c = await report(db, ord.kid8a, { kind: 'rude', receivedMinutesAgo: 30 });
    const d = await report(db, ord.kid8b, { kind: 'other', receivedMinutesAgo: 5 });
    await setReport(db, c, `status = 'seen', seen_at = received_at + interval '12 minutes'`);
    await setReport(db, d, `status = 'closed', seen_at = received_at, closed_at = now()`);
    const all = await list(aal2(safety), { p_school: 'ORD' });
    expect(all.rows.map((r) => r.id)).toEqual([a, b, d, c]);
    expect(all.more).toBe(false);
    expect(Object.keys(all.rows[0]).sort()).toEqual(
      ['ageMinutes', 'firstLookMinutes', 'id', 'kind', 'lessonId', 'openCaseId', 'platform', 'receivedAt', 'school', 'seenAt', 'status'].sort(),
    );
    expect(all.rows[0]).toMatchObject({ kind: 'wrong', status: 'new', school: { code: 'ORD', name: 'ORD Public School' }, lessonId: 'L1', platform: 'web', openCaseId: null });
    expect(all.rows[0].ageMinutes).toBeGreaterThanOrEqual(49);
    expect(all.rows[3]).toMatchObject({ status: 'seen', firstLookMinutes: 12 });
    expect((await list(aal2(safety), { p_school: 'ORD', p_status: 'seen' })).rows.map((r) => r.id)).toEqual([c]);
    expect((await list(aal2(safety), { p_school: 'ORD', p_kind: 'unsafe' })).rows.map((r) => r.id)).toEqual([b]);
    const page = await list(aal2(owner), { p_school: 'ORD', p_limit: 1 });
    expect(page.rows.map((r) => r.id)).toEqual([a]);
    expect(page.more).toBe(true);
    const mine = await report(db, direct, { receivedMinutesAgo: 1 });
    const directOnly = await list(aal2(safety), { p_school: 'direct' });
    expect(directOnly.rows.map((r) => r.id)).toEqual([mine]);
    expect(directOnly.rows[0].school).toBeNull();
    await expect(list(aal2(safety), { p_status: 'actioned' })).rejects.toThrow(/a status is new, seen, triaged or closed/);
    await expect(list(aal2(safety), { p_kind: 'scary' })).rejects.toThrow(/a kind is wrong, rude, unsafe or other/);
    await expect(list(aal2(safety), { p_school: 'NOPE' })).rejects.toThrow(/there is no school with the code NOPE/);
  });

  it('ops, finance and a child cannot see the list', async () => {
    for (const claims of [aal2(ops), aal2(finance), { sub: child, aal: 'aal2' as const }]) {
      await expect(list(claims)).rejects.toThrow(/not allowed/);
      await expect(call(claims, 'safety_overview')).rejects.toThrow(/not allowed/);
      await expect(call(claims, 'cases', {})).rejects.toThrow(/not allowed/);
    }
  });
});

describe('marking a report', () => {
  it('a report only moves forward, and a report with an open case is closed through its case', async () => {
    const r = await report(db, school.kid8b, { receivedMinutesAgo: 20 });
    await mark(aal2(safety), r, 'seen');
    const seen = await one<{ status: string; seen_at: string | null }>(`select status, seen_at from public.student_report where id = $1`, [r]);
    expect(seen.status).toBe('seen');
    expect(seen.seen_at).not.toBeNull();
    await expect(mark(aal2(safety), r, 'seen')).rejects.toThrow(/a report only moves forward: unread, read, triaged, closed/);
    await expect(mark(aal2(safety), r, 'new')).rejects.toThrow(/a report is marked read, triaged or closed/);
    await mark(aal2(safety), r, 'triaged');
    const audit = await one<{ details: unknown }>(
      `select details from admin.audit_event where action = 'report-marked' order by id desc limit 1`,
    );
    expect(audit.details).toEqual({ reportId: r, from: 'seen', to: 'triaged' });
    const { caseId } = await open(fresh(safety2), r);
    await expect(mark(aal2(safety), r, 'closed')).rejects.toThrow(/this report has an open case; close the case instead/);
    await close(aal2(safety2), caseId, 'no-action');
    expect((await one<{ status: string }>(`select status from public.student_report where id = $1`, [r])).status).toBe('closed');
    await expect(mark(aal2(owner), crypto.randomUUID(), 'seen')).rejects.toThrow(/there is no such report/);
  });
});

describe('a case', () => {
  let caseId: string;

  it('opening a case needs a fresh code and a reason, marks the report triaged, and stamps the first look', async () => {
    await expect(open(aal2(safety), rSentinel)).rejects.toThrow(/confirm with your authenticator code first/);
    await expect(open(fresh(safety), rSentinel, '')).rejects.toThrow(/say why, in a few words/);
    await expect(open(fresh(ops), rSentinel)).rejects.toThrow(/not allowed/);
    caseId = (await open(fresh(safety), rSentinel, 'unsafe report, first look')).caseId;
    const r = await one<{ status: string; seen_at: string | null; actioned_at: string | null }>(
      `select status, seen_at, actioned_at from public.student_report where id = $1`,
      [rSentinel],
    );
    expect(r.status).toBe('triaged');
    expect(r.seen_at).not.toBeNull();
    expect(r.actioned_at).not.toBeNull();
    const audit = await one<{ target_id: string; details: unknown; reason: string }>(
      `select target_id, details, reason from admin.audit_event where action = 'case-opened' order by id desc limit 1`,
    );
    expect(audit).toEqual({ target_id: caseId, details: { reportId: rSentinel, kind: 'unsafe', school: 'SAF' }, reason: 'unsafe report, first look' });
    const listed = (await list(aal2(safety), { p_school: 'SAF' })).rows.find((x) => x.id === rSentinel)!;
    expect(listed.openCaseId).toBe(caseId);
  });

  it('one open case per report and one per person', async () => {
    await expect(open(fresh(safety2), rSentinel)).rejects.toThrow(/this report already has an open case/);
    const other = await report(db, school.kid8b, { receivedMinutesAgo: 3 });
    await expect(open(fresh(safety), other)).rejects.toThrow(/close your open case first: one report at a time/);
  });

  it("only the case's opener reads the report, inside the open case, and each read is logged", async () => {
    await expect(call(aal2(safety2), 'case_report', { p_case: caseId })).rejects.toThrow(/only the person who opened this case can read it/);
    await expect(call(aal2(owner), 'case_report', { p_case: caseId })).rejects.toThrow(/only the person who opened this case can read it/);
    const got = await call<{ caseId: string; readsLeftToday: number; report: Record<string, unknown> }>(aal2(safety), 'case_report', { p_case: caseId });
    expect(got.caseId).toBe(caseId);
    expect(got.readsLeftToday).toBe(29);
    expect(got.report).toMatchObject({
      id: rSentinel,
      kind: 'unsafe',
      status: 'triaged',
      note: SENTINEL,
      spokenLine: TUTOR_SENTINEL,
      lessonId: 'CLS-SAF',
      topicRef: 'sci/cells/topic',
      beatId: 'b3',
      platform: 'web',
      release: 'test-build',
      school: { code: 'SAF', name: 'SAF Public School' },
    });
    const { rows } = await db.query<{ what: string; reason: string; staff: string; staff_role: string; report_id: string }>(
      `select what, reason, staff, staff_role, report_id from admin.read_log where case_id = $1`,
      [caseId],
    );
    expect(rows).toEqual([{ what: 'report', reason: 'unsafe report, first look', staff: safety.id, staff_role: 'safety', report_id: rSentinel }]);
    await expect(call(aal2(safety), 'case_report', { p_case: crypto.randomUUID() })).rejects.toThrow(/there is no such case/);
  });

  it('the context read needs its own reason, is logged, and carries the class, the sitting and counts only', async () => {
    await expect(call(aal2(safety), 'case_context', { p_case: caseId, p_reason: '' })).rejects.toThrow(/say why, in a few words/);
    const ctx = await call<Record<string, unknown>>(aal2(safety), 'case_context', { p_case: caseId, p_reason: 'which class was it' });
    expect(Object.keys(ctx).sort()).toEqual(['caseId', 'class', 'readsLeftToday', 'sameLesson', 'sitting']);
    expect(ctx.class).toEqual({ id: 'CLS-SAF', title: 'Cells', status: 'published', version: 1 });
    expect(ctx.sitting).toMatchObject({ source: 'class', endedAt: null, activeMinutes: null });
    expect(ctx.sameLesson).toEqual({ reports: 1, unsafe: 1 });
    expect(ctx.readsLeftToday).toBe(28);
    const last = await one<{ what: string; reason: string }>(`select what, reason from admin.read_log order by id desc limit 1`);
    expect(last).toEqual({ what: 'context', reason: 'which class was it' });
    expect(JSON.stringify(ctx)).not.toContain('SENTINEL');
  });

  it('closing a case closes its report; only the opener or the owner closes it', async () => {
    await expect(close(aal2(safety2), caseId, 'no-action')).rejects.toThrow(/only the person who opened this case, or the owner, can close it/);
    await expect(close(aal2(safety), caseId, 'forgotten')).rejects.toThrow(/an outcome is no-action, content-fixed, disclosed, referred or other/);
    await close(aal2(safety), caseId, 'content-fixed', 'the line was rewritten');
    const c = await one<{ status: string; outcome: string; closed_by: string; close_reason: string }>(
      `select status, outcome, closed_by, close_reason from admin.case where id = $1`,
      [caseId],
    );
    expect(c).toEqual({ status: 'closed', outcome: 'content-fixed', closed_by: safety.id, close_reason: 'the line was rewritten' });
    const r = await one<{ status: string; closed_at: string | null }>(`select status, closed_at from public.student_report where id = $1`, [rSentinel]);
    expect(r.status).toBe('closed');
    expect(r.closed_at).not.toBeNull();
    await expect(call(aal2(safety), 'case_report', { p_case: caseId })).rejects.toThrow(/this case is closed/);
    await expect(close(aal2(safety), caseId, 'other')).rejects.toThrow(/this case is closed/);
    await expect(open(fresh(safety), rSentinel)).rejects.toThrow(/this report is closed/);
    const audit = await one<{ details: unknown }>(`select details from admin.audit_event where action = 'case-closed' order by id desc limit 1`);
    expect(audit.details).toEqual({ caseId, reportId: rSentinel, outcome: 'content-fixed' });
    // The owner may close another person's case.
    const r2 = await report(db, school.kid8b, { receivedMinutesAgo: 2 });
    const c2 = (await open(fresh(safety2), r2)).caseId;
    await close(aal2(owner), c2, 'no-action');
  });

  it('the thirty-first read of the day is refused, for the owner too', async () => {
    const r = await report(db, school.kid8a, { kind: 'rude', receivedMinutesAgo: 1 });
    const { caseId: mine } = await open(fresh(owner), r, 'reading the quota');
    const left: number[] = [];
    for (let i = 0; i < 30; i++) {
      const got =
        i % 2 === 0
          ? await call<{ readsLeftToday: number }>(aal2(owner), 'case_report', { p_case: mine })
          : await call<{ readsLeftToday: number }>(aal2(owner), 'case_context', { p_case: mine, p_reason: 'quota test' });
      left.push(got.readsLeftToday);
    }
    expect(left).toEqual(Array.from({ length: 30 }, (_, i) => 29 - i));
    await expect(call(aal2(owner), 'case_report', { p_case: mine })).rejects.toThrow(QUOTA);
    await expect(call(aal2(owner), 'case_context', { p_case: mine, p_reason: 'one more' })).rejects.toThrow(QUOTA);
    const o = await call<{ quota: { readsToday: number; perDay: number } }>(aal2(owner), 'safety_overview');
    expect(o.quota).toEqual({ readsToday: 30, perDay: 30 });
    await close(aal2(owner), mine, 'no-action');
  });

  it('the read log cannot be changed or emptied', async () => {
    await expect(db.query(`update admin.read_log set reason = 'changed'`)).rejects.toThrow(/the audit log is insert-only/);
    await expect(db.query(`delete from admin.read_log`)).rejects.toThrow(/the audit log is insert-only/);
    await expect(db.query(`truncate admin.read_log`)).rejects.toThrow(/the audit log is insert-only/);
  });

  it('closing with disclosed needs the school\'s recipient; a direct child cannot be disclosed', async () => {
    const r = await report(db, school.kid8b, { kind: 'unsafe', receivedMinutesAgo: 1 });
    const { caseId: c } = await open(fresh(safety), r);
    await expect(close(aal2(safety), c, 'disclosed')).rejects.toThrow(
      /who is told at this school is not decided yet; the owner records it on the Privacy page/,
    );
    await rpc(db, fresh(owner), 'school_privacy_set', {
      p_code: 'SAF', p_fiduciary: 'school', p_recipient: 'school', p_basis: "counsel's letter", p_reason: 'counsel answered', p_env: 'TEST',
    });
    await close(aal2(safety), c, 'disclosed', 'told the designated teacher');
    expect((await one<{ outcome: string }>(`select outcome from admin.case where id = $1`, [c])).outcome).toBe('disclosed');

    const d = await report(db, direct, { kind: 'unsafe', receivedMinutesAgo: 1 });
    const { caseId: dc } = await open(fresh(safety), d);
    await expect(close(aal2(safety), dc, 'disclosed')).rejects.toThrow(/this child came on their own; who is told about them is not decided yet/);
    await close(aal2(safety), dc, 'referred');
  });

  it("an erased child's report leaves its case standing with no report", async () => {
    const kid = await seat(db, school.org, 'student', 'SAF-900', 'Leaving child');
    const r = await report(db, kid, { kind: 'other', receivedMinutesAgo: 1 });
    const { caseId: c } = await open(fresh(safety2), r);
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(`delete from auth.users where id = $1`, [kid]);
    });
    expect((await one<{ report_id: string | null }>(`select report_id from admin.case where id = $1`, [c])).report_id).toBeNull();
    const detail = await call<{ id: string; reportId: string | null; kind: string | null; status: string }>(aal2(safety), 'case_detail', { p_case: c });
    expect(detail).toMatchObject({ id: c, reportId: null, kind: null, status: 'open' });
    await expect(call(aal2(safety2), 'case_report', { p_case: c })).rejects.toThrow(/this report no longer exists/);
    await close(aal2(safety2), c, 'other');
  });

  it('a child deleting their own account clears the case\'s report link without a "direct database change" row; a hand edit still writes one', async () => {
    const unmanaged = async () =>
      (await one<{ n: number }>(
        `select count(*)::int as n from admin.audit_event where action = 'unmanaged-change' and target_kind = 'case'`,
      )).n;
    const kid = await createUser(db);
    const r = await report(db, kid, { kind: 'unsafe', receivedMinutesAgo: 1 });
    const { caseId: c } = await open(fresh(safety2), r);
    const before = await unmanaged();
    await asClaims(db, { sub: kid }, (tx) => tx.query(`select public.delete_own_account()`));
    expect((await one<{ report_id: string | null }>(`select report_id from admin.case where id = $1`, [c])).report_id).toBeNull();
    expect(await unmanaged()).toBe(before);
    await db.query(`update admin.case set reason = 'changed by hand' where id = $1`, [c]);
    expect(await unmanaged()).toBe(before + 1);
    await close(aal2(safety2), c, 'other');
  });
});

describe('what the safety pages carry', () => {
  it('no list, overview, case list or case detail ever carries a note or a spoken line', async () => {
    const seen: string[] = [];
    for (const who of [owner, safety]) {
      seen.push(JSON.stringify(await call(aal2(who), 'safety_overview')));
      for (const args of [
        {},
        ...['new', 'seen', 'triaged', 'closed'].map((s) => ({ p_status: s })),
        ...['wrong', 'rude', 'unsafe', 'other'].map((k) => ({ p_kind: k })),
        { p_school: 'SAF' },
        { p_school: 'direct' },
      ]) {
        seen.push(JSON.stringify(await list(aal2(who), args)));
      }
      const cases = await call<{ id: string }[]>(aal2(who), 'cases', { p_open_only: false });
      expect(cases.length).toBeGreaterThan(3);
      seen.push(JSON.stringify(cases));
      for (const c of cases) seen.push(JSON.stringify(await call(aal2(who), 'case_detail', { p_case: c.id })));
    }
    seen.push(JSON.stringify(await call(aal2(owner), 'read_log_list', {})));
    await expect(call(aal2(safety), 'read_log_list', {})).rejects.toThrow(/not allowed/);
    const { rows } = await db.query<{ t: string }>(`select details::text || ' ' || reason as t from admin.audit_event`);
    seen.push(...rows.map((r) => r.t));
    const all = seen.join('\n');
    expect(all).toContain(rSentinel);
    // 'SENTINEL' has letters no uuid or timestamp holds, so a match can only be a note or a spoken line.
    expect(all).not.toContain('SENTINEL');
  });

  it('the overview counts reports by status, kind and age, the first look, cases and capture, and nothing else', async () => {
    const o = await call<Record<string, unknown>>(aal2(safety), 'safety_overview');
    expect(Object.keys(o).sort()).toEqual(['capture', 'cases', 'counts', 'firstLook', 'generatedAt', 'quota', 'unreadAges', 'unreadByKind'].sort());
    const { rows } = await db.query<{ status: string; n: number }>(`select status, count(*)::int as n from public.student_report group by status`);
    const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    expect(o.counts).toEqual({ unread: n('new'), read: n('seen'), triaged: n('triaged'), closed: n('closed') });
    expect(o.cases).toEqual({ open: 0, mineOpen: 0 });
    expect(o.capture).toEqual({ state: 'not-captured', since: null, last24h: null, last7d: null });
    const ages = o.unreadAges as Record<string, number>;
    expect(ages.underHour + ages.underDay + ages.underWeek + ages.older).toBe(n('new'));
    const look = o.firstLook as { reports30d: number; looked30d: number; medianMinutes: number | null; maxMinutes: number | null };
    expect(look.looked30d).toBeGreaterThan(0);
    expect(look.medianMinutes).not.toBeNull();
    expect(look.maxMinutes! >= look.medianMinutes!).toBe(true);
  });
});

describe('who may call the case functions', () => {
  it('a signed-in child and finance are refused every case function', async () => {
    for (const claims of [{ sub: child, aal: 'aal2' as const }, aal2(finance)]) {
      await expect(open({ ...claims, amr: fresh(owner).amr }, rSentinel)).rejects.toThrow(/not allowed/);
      await expect(call(claims, 'case_detail', { p_case: crypto.randomUUID() })).rejects.toThrow(/not allowed/);
      await expect(asClaims(db, claims, (tx) => tx.query(`select admin.read_log_list()`))).rejects.toThrow(/not allowed/);
    }
  });
});
