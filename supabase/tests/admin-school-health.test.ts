// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import {
  addStudents, ageStudents, bareSchool, fileReport, handIn, healthOf, ledgerEvent, markAttendance, publish, setLicence,
  signalOf, tutorSession,
} from './admin-school-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { asClaims, asService, createUser, freshDatabase } from './harness.ts';

/**
 * SCHOOLS AT A GLANCE (migration 0052). Written first.
 *
 * Pins the nine signals of a school's health card and their thresholds (spec
 * section 9), each boundary on both sides; the label, which is the worst
 * signal written out; the schools list and its index; seam S1 (the payment
 * signal plan 3 replaces); and that the card and the list carry counts only:
 * no child's name, login ID or report note.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
});
afterAll(async () => {
  await db.close();
});
const h = (code: string) => healthOf(db, aal2(ops), code);

/** Login IDs the way the fixtures make them: CODE-101, CODE-T1, CODE-200... (uuids are lower-case hex). */
const LOGIN_ID = /[A-Z][A-Z0-9]{2,11}-(\d{3}|T\d|A\d)/;

// The school every signal but payment reads green for; built once, by whichever test needs it first.
let healthy: Promise<School> | undefined;
const healthySchool = () =>
  (healthy ??= (async () => {
    const s = await buildSchool(db, 'HEALTHY');
    const added = await addStudents(db, s, 'HEALTHY', 2);
    await ageStudents(db, s.org, 30);
    await setLicence(db, 'HEALTHY', 100, 200);
    const hw = await publish(db, s, 2, 1);
    for (const kid of [s.kid8a, ...added]) await handIn(db, s.org, hw, kid);
    await ledgerEvent(db, s.org, s.kid8b);
    await markAttendance(db, s, s.kid8a, 0);
    await tutorSession(db, s.org, s.kid8a);
    return s;
  })());

describe('who may read', () => {
  it('is for active staff at aal2, the safety reviewer included; a child, a stranger and aal1 are refused', async () => {
    await buildSchool(db, 'WHO');
    await expect(healthOf(db, aal2(safety), 'WHO')).resolves.toMatchObject({ code: 'WHO' });
    const child = await anonymousChild(db);
    const stranger = await createUser(db);
    await expect(healthOf(db, { sub: child, aal: 'aal2' }, 'WHO')).rejects.toThrow(/not allowed/);
    await expect(healthOf(db, { sub: stranger, aal: 'aal2' }, 'WHO')).rejects.toThrow(/not allowed/);
    await expect(healthOf(db, { sub: ops.id, aal: 'aal1' }, 'WHO')).rejects.toThrow(/not allowed/);
    await expect(h('NOPE')).rejects.toThrow(/no school with the code NOPE/);
    await expect(healthOf(db, { sub: child, aal: 'aal2' }, 'NOPE')).rejects.toThrow(/not allowed/);
  });
});

describe('the payment signal (seam S1)', () => {
  it("is internal, takes (p_org uuid) and returns jsonb, and says grey 'No billing account yet.' for now", async () => {
    const { rows } = await db.query<{ args: string; result: string; definer: boolean; anon: boolean; signed_in: boolean }>(
      `select pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
              p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as signed_in
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'admin' and p.proname = 'school_payment_signal'`,
    );
    expect(rows).toEqual([{ args: 'p_org uuid', result: 'jsonb', definer: true, anon: false, signed_in: false }]);
    const org = (await db.query<{ org_id: string }>(`select org_id from lms.school where code = 'WHO'`)).rows[0].org_id;
    const { rows: pay } = await db.query<{ p: unknown }>(`select admin.school_payment_signal($1) as p`, [org]);
    expect(pay[0].p).toEqual({ level: 'grey', reason: 'No billing account yet.' });
    expect(signalOf(await h('WHO'), 'payment')).toEqual({ key: 'payment', level: 'grey', reason: 'No billing account yet.' });
  });
});

describe('licence', () => {
  it('grey with no licence; green with 31 days left; amber at 30 and at 8; red at 7; red once ended', async () => {
    const cases: [string, number | null][] = [['LIC0', null], ['LIC31', 31], ['LIC30', 30], ['LIC8', 8], ['LIC7', 7], ['LICX', -1]];
    for (const [code, days] of cases) {
      await buildSchool(db, code);
      if (days !== null) await setLicence(db, code, 100, days);
    }
    const got = [];
    for (const [code] of cases) got.push(signalOf(await h(code), 'licence'));
    expect(got.map((s) => s.level)).toEqual(['grey', 'green', 'amber', 'amber', 'red', 'red']);
    expect(got.slice(0, 5).map((s) => s.reason)).toEqual([
      'No licence is set.',
      '31 days of licence left.',
      'The licence ends in 30 days.',
      'The licence ends in 8 days.',
      'The licence ends in 7 days.',
    ]);
    expect(got[5].reason).toMatch(/^The licence ended on \d{4}-\d{2}-\d{2}\.$/);
  });
});

describe('seats', () => {
  it('grey without a licence; green under 90%; amber at 90% or more; red above what was bought', async () => {
    for (const code of ['SEAT0', 'SEAT3', 'SEAT2', 'SEAT1']) await buildSchool(db, code);
    await setLicence(db, 'SEAT3', 3, 100);
    await setLicence(db, 'SEAT2', 2, 100);
    await setLicence(db, 'SEAT1', 1, 100);
    expect(signalOf(await h('SEAT0'), 'seats')).toMatchObject({ level: 'grey', reason: 'No licence, so no seats are counted.' });
    expect(signalOf(await h('SEAT3'), 'seats')).toMatchObject({ level: 'green', reason: '2 of 3 seats used.' });
    expect(signalOf(await h('SEAT2'), 'seats')).toMatchObject({ level: 'amber', reason: '2 of 2 seats used.' });
    expect(signalOf(await h('SEAT1'), 'seats')).toMatchObject({ level: 'red', reason: '2 of 1 seats used: more than bought.' });
  });
});

describe('activation', () => {
  it('grey with no students, and for 14 days after the first students are added', async () => {
    await bareSchool(db, 'ACT0');
    await buildSchool(db, 'ACTNEW');
    expect(signalOf(await h('ACT0'), 'activation')).toMatchObject({ level: 'grey', reason: 'No students yet.' });
    expect(signalOf(await h('ACTNEW'), 'activation')).toMatchObject({
      level: 'grey',
      reason: 'Fewer than 14 days since the first students were added.',
    });
  });

  it('then green at 60% of students having done something, amber at 30%, red under 30%', async () => {
    const cases: [string, number, string, string][] = [
      ['ACTG', 6, 'green', '60%'],
      ['ACTA', 3, 'amber', '30%'],
      ['ACTR', 2, 'red', '20%'],
    ];
    for (const [code, handing, level, pct] of cases) {
      const s = await buildSchool(db, code);
      const added = await addStudents(db, s, code, 8);
      await ageStudents(db, s.org, 20);
      const hw = await publish(db, s, 2, 1);
      for (const kid of [s.kid8a, ...added].slice(0, handing)) await handIn(db, s.org, hw, kid);
      expect(signalOf(await h(code), 'activation')).toMatchObject({ level, reason: `${pct} of students have done something.` });
    }
  });

  it('a ledger event counts as doing something', async () => {
    const s = await buildSchool(db, 'ACTL');
    await ageStudents(db, s.org, 20);
    await ledgerEvent(db, s.org, s.kid8a);
    await ledgerEvent(db, s.org, s.kid8b);
    expect(signalOf(await h('ACTL'), 'activation')).toMatchObject({ level: 'green', reason: '100% of students have done something.' });
  });
});

describe('teaching', () => {
  it('grey with no classes this year; red when nothing was ever published', async () => {
    await bareSchool(db, 'TCH0');
    await buildSchool(db, 'TCHN');
    expect(signalOf(await h('TCH0'), 'teaching')).toMatchObject({ level: 'grey', reason: 'No classes are set up yet.' });
    expect(signalOf(await h('TCHN'), 'teaching')).toMatchObject({ level: 'red', reason: 'No homework has been published yet.' });
  });

  it('green when published in the last 7 days, amber after 7, red after 14', async () => {
    for (const [code, days] of [['TCH6', 6], ['TCH8', 8], ['TCH15', 15]] as const) {
      await publish(db, await buildSchool(db, code), days);
    }
    expect(signalOf(await h('TCH6'), 'teaching')).toMatchObject({ level: 'green', reason: 'Homework was published in the last 7 days.' });
    expect(signalOf(await h('TCH8'), 'teaching')).toMatchObject({ level: 'amber', reason: 'No homework published in 7 days.' });
    expect(signalOf(await h('TCH15'), 'teaching')).toMatchObject({ level: 'red', reason: 'No homework published in 14 days.' });
  });
});

describe('learning', () => {
  it('grey when nothing was due in the last 7 days', async () => {
    await publish(db, await buildSchool(db, 'LRN0'), 20, 10);
    expect(signalOf(await h('LRN0'), 'learning')).toMatchObject({ level: 'grey', reason: 'Nothing was due in the last 7 days.' });
  });

  it('green at 30% of students handing in, amber at 10%, red under 10%', async () => {
    const cases: [string, number, string, string][] = [
      ['LRNG', 3, 'green', '30%'],
      ['LRNA', 1, 'amber', '10%'],
      ['LRNR', 0, 'red', '0%'],
    ];
    for (const [code, handing, level, pct] of cases) {
      const s = await buildSchool(db, code);
      const added = await addStudents(db, s, code, 8);
      const hw = await publish(db, s, 3, 1);
      for (const kid of [s.kid8a, ...added].slice(0, handing)) await handIn(db, s.org, hw, kid, 1);
      expect(signalOf(await h(code), 'learning')).toMatchObject({
        level,
        reason: `${pct} of students handed in work in the last 7 days.`,
      });
    }
  });
});

describe('attendance', () => {
  it('grey when never used; green within 2 days; amber from 3; red from 7', async () => {
    await buildSchool(db, 'ATT0');
    for (const [code, days] of [['ATT2', 2], ['ATT3', 3], ['ATT6', 6], ['ATT7', 7]] as const) {
      const s = await buildSchool(db, code);
      await markAttendance(db, s, s.kid8a, days);
    }
    expect(signalOf(await h('ATT0'), 'attendance')).toMatchObject({ level: 'grey', reason: 'Attendance is not used at this school.' });
    const two = signalOf(await h('ATT2'), 'attendance');
    expect(two.level).toBe('green');
    expect(two.reason).toMatch(/^Attendance was marked on \d{4}-\d{2}-\d{2}\.$/);
    expect(signalOf(await h('ATT3'), 'attendance')).toMatchObject({ level: 'amber', reason: 'Attendance not marked in 3 days.' });
    expect(signalOf(await h('ATT6'), 'attendance')).toMatchObject({ level: 'amber', reason: 'Attendance not marked in 6 days.' });
    expect(signalOf(await h('ATT7'), 'attendance')).toMatchObject({ level: 'red', reason: 'Attendance not marked in 7 days.' });
  });
});

describe('safety', () => {
  it('grey when nobody at the school has used the tutor; green with no unread report', async () => {
    await buildSchool(db, 'SAF0');
    const s = await buildSchool(db, 'SAFG');
    await tutorSession(db, s.org, s.kid8a);
    expect(signalOf(await h('SAF0'), 'safety')).toMatchObject({
      level: 'grey',
      reason: 'No unread reports, and nobody at this school has used the tutor yet.',
    });
    expect(signalOf(await h('SAFG'), 'safety')).toMatchObject({ level: 'green', reason: 'No unread reports.' });
  });

  it('amber for an unread report, red for an unread unsafe one, and never the note', async () => {
    const a = await buildSchool(db, 'SAFA');
    await tutorSession(db, a.org, a.kid8a);
    await fileReport(db, a.kid8a, 'wrong');
    const r = await buildSchool(db, 'SAFR');
    await tutorSession(db, r.org, r.kid8a);
    await fileReport(db, r.kid8a, 'unsafe');
    await fileReport(db, r.kid8b, 'wrong');
    const ha = await h('SAFA');
    const hr = await h('SAFR');
    expect(signalOf(ha, 'safety')).toMatchObject({ level: 'amber', reason: '1 unread report.' });
    expect(signalOf(hr, 'safety')).toMatchObject({ level: 'red', reason: '1 unread unsafe report.' });
    expect(JSON.stringify(ha)).not.toContain('a private note');
    expect(JSON.stringify(hr)).not.toContain('a private note');
    await db.query(`update public.student_report set status = 'seen' where org_id = $1`, [a.org]);
    expect(signalOf(await h('SAFA'), 'safety')).toMatchObject({ level: 'green', reason: 'No unread reports.' });
  });
});

describe('last active', () => {
  it('grey with no activity; green within 3 days; amber up to 14; red after 14', async () => {
    await buildSchool(db, 'LAST0');
    for (const [code, days] of [['LAST3', 3], ['LAST4', 4], ['LAST14', 14], ['LAST15', 15]] as const) {
      const s = await buildSchool(db, code);
      await markAttendance(db, s, s.kid8a, days);
    }
    expect(signalOf(await h('LAST0'), 'lastActive')).toMatchObject({ level: 'grey', reason: 'No activity yet.' });
    const three = signalOf(await h('LAST3'), 'lastActive');
    expect(three.level).toBe('green');
    expect(three.reason).toMatch(/^Last active on /);
    expect(signalOf(await h('LAST4'), 'lastActive')).toMatchObject({ level: 'amber', reason: 'Last active 4 days ago.' });
    expect(signalOf(await h('LAST14'), 'lastActive')).toMatchObject({ level: 'amber', reason: 'Last active 14 days ago.' });
    expect(signalOf(await h('LAST15'), 'lastActive')).toMatchObject({ level: 'red', reason: 'Not active for 15 days.' });
  });

  it('matches lms.founder_schools for the same school', async () => {
    const founder = await asService(db, async (tx) =>
      (await tx.query<{ code: string; last_active: string | null }>(`select code, last_active from lms.founder_schools()`)).rows,
    );
    for (const code of ['LAST4', 'LAST15']) {
      const mine = (await h(code)).lastActiveOn;
      expect(mine).not.toBeNull();
      expect(mine).toBe(founder.find((f) => f.code === code)?.last_active);
    }
  });
});

describe('on holiday', () => {
  it('teaching, learning, attendance and last active read grey with the date; licence, seats and safety do not', async () => {
    const s = await buildSchool(db, 'QUIET');
    await setLicence(db, 'QUIET', 1, 5);
    await publish(db, s, 15, 3);
    await markAttendance(db, s, s.kid8a, 9);
    await tutorSession(db, s.org, s.kid8a);
    await fileReport(db, s.kid8a, 'unsafe');
    await db.query(`insert into admin.school_profile (org_id, quiet_until) values ($1, lms.india_today() + 10)`, [s.org]);
    const until = (await db.query<{ d: string }>(`select to_char(lms.india_today() + 10, 'YYYY-MM-DD') as d`)).rows[0].d;
    const q = await h('QUIET');
    for (const key of ['teaching', 'learning', 'attendance', 'lastActive']) {
      expect(signalOf(q, key)).toMatchObject({ level: 'grey', reason: `On holiday until ${until}; not counted.` });
      expect(signalOf(q, key).reason).toMatch(/^On holiday until \d{4}-\d{2}-\d{2}; not counted\.$/);
    }
    expect(signalOf(q, 'licence').level).toBe('red');
    expect(signalOf(q, 'seats').level).toBe('red');
    expect(signalOf(q, 'safety').level).toBe('red');
    expect(q.quietUntil).toBe(until);

    await db.query(`update admin.school_profile set quiet_until = lms.india_today() - 1 where org_id = $1`, [s.org]);
    const after = await h('QUIET');
    for (const key of ['teaching', 'learning', 'attendance', 'lastActive']) {
      expect(signalOf(after, key).level).not.toBe('grey');
    }
    expect(after.quietUntil).toBeNull();
  });
});

describe('the label', () => {
  it('is the worst signal written out', async () => {
    const s = await buildSchool(db, 'LBL');
    await publish(db, s, 15, 14);
    const l = await h('LBL');
    expect(l.level).toBe('red');
    expect(l.label).toBe('Needs attention: no homework published in 14 days');
  });

  it('an unread unsafe report outranks other reds; all green reads Healthy; all grey reads Not enough to tell yet', async () => {
    const s = await buildSchool(db, 'LBLS');
    await publish(db, s, 15, 14);
    await tutorSession(db, s.org, s.kid8a);
    await fileReport(db, s.kid8a, 'unsafe');
    expect((await h('LBLS')).label).toBe('Needs attention: 1 unread unsafe report');

    await healthySchool();
    const good = await h('HEALTHY');
    for (const sig of good.signals) {
      if (sig.key !== 'payment') expect(sig, sig.key).toMatchObject({ level: 'green' });
    }
    expect(good.level).toBe('green');
    expect(good.label).toBe('Healthy');

    await bareSchool(db, 'ALLGREY');
    const grey = await h('ALLGREY');
    expect(grey.level).toBe('grey');
    expect(grey.label).toBe('Not enough to tell yet');
  });
});

interface ListRow {
  org_id: string;
  code: string;
  name: string;
  valid_until: string | null;
  last_active: string | null;
  [k: string]: unknown;
}
const list = (claims = aal2(ops)) =>
  asClaims(db, claims, async (tx) => (await tx.query<ListRow>(`select * from admin.school_list()`)).rows);

describe('the schools list', () => {
  it('lists every school with plan, seats, licence end, payment, health, last active, students and teachers', async () => {
    const s = await healthySchool();
    const rows = await list();
    const row = rows.find((r) => r.code === 'HEALTHY');
    expect(row).toMatchObject({
      code: 'HEALTHY',
      name: 'HEALTHY Public School',
      plan: 'pilot',
      seats: 100,
      seats_used: 4,
      days_left: 200,
      payment_level: 'grey',
      payment_reason: 'No billing account yet.',
      health_level: 'green',
      health_label: 'Healthy',
      students: 4,
      teachers: 2,
      offboarded: false,
    });
    expect(row!.org_id).toBe(s.org);
    expect(row!.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row!.last_active).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const codes = rows.map((r) => r.code);
    expect(codes).toEqual([...codes].sort());
  });

  it('the index gives code and name only', async () => {
    await healthySchool();
    const rows = await asClaims(db, aal2(ops), async (tx) => (await tx.query(`select * from admin.school_index()`)).rows);
    for (const r of rows) expect(Object.keys(r as object).sort()).toEqual(['code', 'name']);
    expect(rows).toContainEqual({ code: 'HEALTHY', name: 'HEALTHY Public School' });
  });

  it("carries counts only: no child's name, login ID or report note", async () => {
    await healthySchool();
    const text = JSON.stringify(await list()) + JSON.stringify(await h('SAFR'));
    for (const word of ['Riya', 'Arjun', 'Child 0', 'a private note']) expect(text).not.toContain(word);
    expect(text).not.toMatch(LOGIN_ID);
  });

  it('is readable by the safety reviewer; a child is refused', async () => {
    expect((await list(aal2(safety))).length).toBeGreaterThan(0);
    const child = await anonymousChild(db);
    await expect(list({ sub: child, aal: 'aal2' })).rejects.toThrow(/not allowed/);
    await expect(list(aal2(owner))).resolves.toBeDefined();
  });
});
