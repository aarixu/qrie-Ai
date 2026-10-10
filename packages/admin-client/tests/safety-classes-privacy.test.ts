// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { rpc } from '../../../supabase/tests/billing-fixtures.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { classRow, populateChild, report } from '../../../supabase/tests/safety-fixtures.ts';
import { handleAdminApi } from '../../../tools/admin-api/src/handle.ts';
import { apiWorld, type ApiWorld } from '../../../tools/admin-api/tests/deps.ts';
import {
  AdminError,
  createClassesClient,
  createPrivacyClient,
  createSafetyClient,
  pgliteAdminTransport,
  replyCaller,
  type AdminClaims,
} from '../src/index.ts';

/**
 * THE SAFETY, CLASSES AND PRIVACY CLIENTS, END TO END (plan 5). Written first.
 *
 * Database calls run as the member of staff would reach PostgREST; removing a
 * class and erasing a child go through admin-api's handler with that member's
 * token. Answers come back typed; refusals as AdminError.
 */

let db: PGlite;
let world: ApiWorld;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let school: School;
let kid: { login: string; parent: string; assignment: string; photo: string };
let today: string;
let tomorrow: string;
const WORDS = 'SENTINEL-WORDS someone at home hurts me';

const api = (token: string) =>
  replyCaller((route, body) =>
    handleAdminApi({ method: 'POST', path: `/x/${route}`, authorization: `Bearer ${token}`, body }, world.deps()),
  );
const safetyAs = (claims: AdminClaims) => createSafetyClient(pgliteAdminTransport(db, claims));
const classesAs = (claims: AdminClaims, token: string) => createClassesClient(pgliteAdminTransport(db, claims), api(token));
const privacyAs = (claims: AdminClaims, token: string) => createPrivacyClient(pgliteAdminTransport(db, claims), api(token));
const codeOf = (p: Promise<unknown>) =>
  p.then(() => 'resolved', (e: unknown) => (e instanceof AdminError ? e.code : `untyped: ${String(e)}`));

beforeAll(async () => {
  db = await freshDatabase();
  world = apiWorld(db);
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  school = await buildSchool(db, 'CSP');
  kid = await populateChild(db, school, school.kid8a);
  world.tokens['owner'] = () => aal2(owner);
  world.tokens['owner-fresh'] = () => fresh(owner);
  world.tokens['ops'] = () => aal2(ops);
  world.tokens['ops-fresh'] = () => fresh(ops);
  const d = (await db.query<{ t: string; m: string }>(`select lms.india_today()::text as t, (lms.india_today() + 1)::text as m`)).rows[0];
  today = d.t;
  tomorrow = d.m;
});
afterAll(async () => {
  await db.close();
});

describe('safety', () => {
  it('safety: the overview, the list without notes, a case opened, read once and closed', async () => {
    const reportId = await report(db, school.kid8b, { kind: 'unsafe', note: WORDS, spokenLine: 'SENTINEL-LINE' });
    const reviewer = safetyAs(fresh(safety));
    const o = await reviewer.overview();
    expect(o.counts.unread).toBeGreaterThanOrEqual(1);
    expect(o.unreadByKind.unsafe).toBe(1);
    expect(o.capture).toEqual({ state: 'not-captured', since: null, last24h: null, last7d: null });
    expect(o.quota).toEqual({ readsToday: 0, perDay: 30 });
    expect(typeof o.firstLook.reports30d).toBe('number');
    const list = await reviewer.reports({ kind: 'unsafe' });
    expect(list.more).toBe(false);
    expect(list.rows.map((r) => r.id)).toEqual([reportId]);
    expect(list.rows[0]).toMatchObject({ kind: 'unsafe', status: 'new', school: { code: 'CSP' }, openCaseId: null });
    expect(typeof list.rows[0].ageMinutes).toBe('number');
    expect(JSON.stringify(list)).not.toContain('SENTINEL');

    const { caseId } = await reviewer.openCase({ reportId, reason: 'an unsafe report', env: 'TEST' });
    expect(caseId).toMatch(/^[0-9a-f-]{36}$/);
    const read = await reviewer.caseReport(caseId);
    expect(read.report.note).toBe(WORDS);
    expect(read.report.spokenLine).toBe('SENTINEL-LINE');
    expect(read.readsLeftToday).toBe(29);
    const ctx = await reviewer.caseContext(caseId, 'which class it was');
    expect(ctx).toMatchObject({ caseId, sameLesson: { reports: expect.any(Number), unsafe: 1 }, readsLeftToday: 28 });
    const detail = await reviewer.caseDetail(caseId);
    expect(detail).toMatchObject({ id: caseId, reportId, status: 'open', reason: 'an unsafe report', reportStatus: 'triaged' });
    expect(detail.reads.map((r) => r.what)).toEqual(['report', 'context']);
    expect(JSON.stringify(detail)).not.toContain('SENTINEL');
    const cases = await reviewer.cases();
    expect(cases.map((c) => c.id)).toEqual([caseId]);
    expect(JSON.stringify(cases)).not.toContain('SENTINEL');
    await reviewer.closeCase({ caseId, outcome: 'no-action', reason: 'nothing to do', env: 'TEST' });
    expect(await reviewer.cases()).toEqual([]);
    expect((await reviewer.cases(false))[0]).toMatchObject({ id: caseId, status: 'closed', outcome: 'no-action' });

    const log = await safetyAs(aal2(owner)).readLog();
    expect(log.map((r) => r.what)).toEqual(['context', 'report']);
    expect(log[0]).toMatchObject({ staffName: 'Safety person', staffRole: 'safety', caseId, reportId });

    const other = await report(db, school.kid8b, { kind: 'wrong' });
    await reviewer.mark({ reportId: other, status: 'seen', reason: 'read the kind', env: 'TEST' });
    expect((await reviewer.reports({ status: 'seen' })).rows.map((r) => r.id)).toEqual([other]);

    await safetyAs(aal2(owner)).setCaptureSince({ on: today, reason: 'the relay is live', env: 'TEST' });
    expect((await reviewer.overview()).capture).toMatchObject({ state: 'captured', since: today, last24h: 0, last7d: 0 });
  });

  it('a refusal is a typed AdminError: a stale owner opening a case is needs-mfa; ops reading the list is not-allowed', async () => {
    const reportId = await report(db, school.kid8b, { kind: 'rude' });
    expect(await codeOf(safetyAs(aal2(owner)).openCase({ reportId, reason: 'look', env: 'TEST' }))).toBe('needs-mfa');
    expect(await codeOf(safetyAs(aal2(ops)).reports())).toBe('not-allowed');
    expect(await codeOf(safetyAs(aal2(ops)).overview())).toBe('not-allowed');
  });
});

describe('classes', () => {
  it('classes: list, publish, retract through admin-api', async () => {
    await classRow(db, 'cls-wait', { status: 'pending', files: ['manifest.json'] });
    await classRow(db, 'cls-live', { files: ['manifest.json', 'beats/1.json'] });
    const asOps = classesAs(fresh(ops), 'ops-fresh');
    const pending = await asOps.list('pending');
    expect(pending.map((c) => c.id)).toEqual(['cls-wait']);
    expect(pending[0]).toMatchObject({
      topicRef: 'topic/cls-wait', title: 'Title of cls-wait', klass: 8, subject: 'science', status: 'pending',
      publishedAt: null, reports: { total: 0, open: 0, unsafe: 0 },
      cost: { inr: 0, liveInr: 0, warmInr: 0, unpriced: false, calls: 0, sittings: 0 }, lastAction: null,
    });
    expect(await codeOf(asOps.publish({ classId: 'cls-wait', reason: 'reviewed', env: 'TEST' }))).toBe('not-allowed');
    await classesAs(fresh(owner), 'owner-fresh').publish({ classId: 'cls-wait', reason: 'reviewed it', env: 'TEST' });
    const published = await asOps.list('published');
    expect(published.find((c) => c.id === 'cls-wait')).toMatchObject({ status: 'published', lastAction: { action: 'published', byName: 'Aarav' } });
    expect(await codeOf(classesAs(aal2(ops), 'ops').remove({ classId: 'cls-live', action: 'retract', reason: 'wrong', env: 'TEST' }))).toBe(
      'needs-mfa',
    );
    expect(await asOps.remove({ classId: 'cls-live', action: 'retract', reason: 'a wrong answer', env: 'TEST' })).toEqual({
      classId: 'cls-live', removed: 2,
    });
    const removed = await asOps.removed();
    expect(removed.map((r) => r.id)).toEqual(['cls-live']);
    expect(removed[0]).toMatchObject({ byName: 'Ops person', reason: 'a wrong answer', reports: { total: 0 } });
    const d = await asOps.detail('cls-live');
    expect(d.live).toBeNull();
    expect(d.removed?.id).toBe('cls-live');
    expect(d.filesInStorage).toBe(0);
    expect(d.history.map((h) => h.action)).toEqual(['retracted', 'files-removed']);
    expect(d.history[1].files).toBe(2);
    expect(d.reportsByKind).toEqual({ wrong: 0, rude: 0, unsafe: 0, other: 0 });
  });
});

describe('privacy', () => {
  it("privacy: a school's decision, an intake, a verify and an erasure through admin-api", async () => {
    const asOwner = privacyAs(fresh(owner), 'owner-fresh');
    const asOps = privacyAs(aal2(ops), 'ops');
    expect((await asOps.schools()).find((s) => s.code === 'CSP')).toEqual({
      code: 'CSP', name: 'CSP Public School', fiduciary: 'undecided', recipient: 'undecided', basis: null,
      decidedAt: null, decidedByName: null, importBlocked: false,
    });
    await asOwner.setSchool({ code: 'CSP', fiduciary: 'school', recipient: 'school', basis: 'counsel letter of 2026-11-02', reason: 'counsel answered', env: 'TEST' });
    expect((await asOps.schools()).find((s) => s.code === 'CSP')).toMatchObject({ fiduciary: 'school', recipient: 'school', decidedByName: 'Aarav' });

    await rpc(db, aal2(ops), 'school_person_disable', { p_code: 'CSP', p_login: kid.login, p_reason: 'left the school', p_env: 'TEST' });
    const { requestId } = await asOps.intake({
      channel: 'email', requester: 'parent', reference: 'MAIL 2026/11 #1', receivedOn: today, code: 'CSP', loginId: kid.login,
      reason: 'a parent asked', env: 'TEST',
    });
    const rows = await asOps.requests();
    expect(rows[0]).toMatchObject({
      id: requestId, receivedOn: today, daysLeft: 30, channel: 'email', requester: 'parent', subjectKind: 'school-student',
      school: { code: 'CSP' }, loginId: kid.login, status: 'received',
    });
    expect(rows[0].dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const before = await asOps.request(requestId);
    expect(before).toMatchObject({ displayName: 'Riya', left: true, verifiedHow: null, tallies: null });
    expect(before.preview?.photos).toBe(1);
    expect(before.preview?.rows['lms.account.user_id']).toBe(1);
    await asOps.verify({ requestId, how: 'parent-callback', reason: 'rang the parent back', env: 'TEST' });
    expect(await codeOf(privacyAs(aal2(owner), 'owner').erase({ requestId, reason: 'verified', env: 'TEST' }))).toBe('needs-mfa');
    const erased = await asOwner.erase({ requestId, reason: 'verified', env: 'TEST' });
    expect(erased).toMatchObject({ requestId, photos: 1 });
    expect(erased.rows['lms.account.user_id']).toBe(1);
    expect(typeof erased.activityLogLines).toBe('number');
    const after = await asOps.request(requestId);
    expect(after).toMatchObject({ status: 'erased', loginId: null, preview: null, verifiedHow: 'parent-callback', verifiedByName: 'Ops person' });
    expect(after.tallies).not.toBeNull();
    expect(await asOps.requests()).toEqual([]);
    expect((await asOps.requests(false)).map((r) => r.id)).toEqual([requestId]);

    const second = await asOps.intake({
      channel: 'in-app', requester: 'student', reference: 'APP 2', receivedOn: today, code: 'CSP', loginId: 'CSP-102',
      reason: 'the student asked', env: 'TEST',
    });
    await asOwner.refuse({ requestId: second.requestId, reason: 'could not verify the caller', env: 'TEST' });
    expect(await asOps.request(second.requestId)).toMatchObject({ status: 'refused', refusedReason: 'could not verify the caller' });
  });

  it('the retention truth is typed and its jobs are named', async () => {
    const t = await privacyAs(aal2(safety), 'safety').retention();
    expect(t.rows.length).toBeGreaterThan(5);
    for (const row of t.rows) {
      expect(Array.isArray(row.tables)).toBe(true);
      if (row.enforcedBy.startsWith('job ')) {
        expect(row.job?.name).toBeTruthy();
        expect(typeof row.job?.schedule).toBe('string');
        expect(typeof row.job?.lastStatus).toBe('string');
      } else {
        expect(row.job).toBeNull();
      }
    }
    expect(t.rows.flatMap((r) => r.tables)).toContain('admin.safety_event');
    expect(t.contest).toEqual({ purgeOn: null, purgedAt: null });
    expect(['captured', 'not-captured']).toContain(t.distressCapture.state);
    await privacyAs(fresh(owner), 'owner-fresh').setContestPurge({ on: tomorrow, reason: 'prizes are posted', env: 'TEST' });
    expect((await privacyAs(aal2(ops), 'ops').retention()).contest.purgeOn).toBe(tomorrow);
    expect(await codeOf(privacyAs(aal2(owner), 'owner').setContestPurge({ on: tomorrow, reason: 'again', env: 'TEST' }))).toBe('needs-mfa');
  });
});
