// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { asClaims, asService, createUser, freshDatabase } from './harness.ts';

/**
 * THE HOME PAGE (migration 0049). Written first.
 *
 * One function returns counts, ages and booleans: what needs a person today.
 * It never carries a child's name, note or words, and what is not captured yet
 * says so instead of reading as zero.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let child: string;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner');
  ops = await makeStaff(db, 'ops');
  child = await anonymousChild(db);
});
afterAll(async () => {
  await db.close();
});

interface Today {
  environment: string;
  relay: { halted: boolean; ceilingUnits: number; unitsToday: number; studentsNow: number };
  reports: { newCount: number; unsafeNew: number; oldestNewMinutes: number };
  classes: { pendingCount: number; oldestPendingHours: number };
  contest: { entriesToday: number; dailyCap: number; entriesOpen: boolean };
  schools: { code: string; seats: number; seatsUsed: number; daysLeft: number }[];
  prices: { modelPriceRows: number };
  alarm: { lastCheckMinutesAgo: number | null };
  capture: { distress: string; lastPurge: string };
}
const today = () =>
  asClaims(db, aal2(ops), async (tx) => (await tx.query<{ t: Today }>(`select admin.today() as t`)).rows[0].t);

describe('the home page', () => {
  it('is for staff only', async () => {
    const stranger = await createUser(db);
    await expect(asClaims(db, { sub: stranger, aal: 'aal2' }, (tx) => tx.query(`select admin.today()`))).rejects.toThrow(
      /not allowed/,
    );
  });

  it('on an empty platform reads zeros for what is counted and "not-captured" for what is not', async () => {
    const t = await today();
    expect(t.environment).toBe('TEST');
    expect(t.relay).toMatchObject({ halted: false, unitsToday: 0, studentsNow: 0 });
    expect(t.reports).toMatchObject({ newCount: 0, unsafeNew: 0, oldestNewMinutes: 0 });
    expect(t.classes.pendingCount).toBe(0);
    expect(t.schools).toEqual([]);
    expect(t.alarm.lastCheckMinutesAgo).toBeNull();
    expect(t.capture).toEqual({ distress: 'not-captured', lastPurge: 'not-captured' });
  });

  it('counts a waiting unsafe report and a class waiting for review, and carries no child words', async () => {
    await db.query(
      `insert into public.student_report (user_id, kind, note, lesson_id, at, received_at)
       values ($1, 'unsafe', 'a private note', 'L1', now(), now() - interval '90 minutes')`,
      [child],
    );
    await db.query(
      `insert into public.prepared_class (id, topic_ref, title, klass, subject, review_status)
       values ('c1', 't1', 'A title', 8, 'science', 'pending')`,
    );
    const t = await today();
    expect(t.reports).toMatchObject({ newCount: 1, unsafeNew: 1 });
    expect(t.reports.oldestNewMinutes).toBeGreaterThanOrEqual(89);
    expect(t.classes.pendingCount).toBe(1);
    expect(JSON.stringify(t)).not.toContain('a private note');
  });

  it("lists a school whose licence ends within 30 days, and one that is nearly full", async () => {
    await buildSchool(db, 'SUN');
    await asService(db, (tx) => tx.query(`select lms.set_licence('SUN', 'pilot', 10, (now() at time zone 'utc')::date + 9)`));
    const t = await today();
    expect(t.schools).toHaveLength(1);
    expect(t.schools[0]).toMatchObject({ code: 'SUN', seats: 10 });
    expect(t.schools[0].daysLeft).toBeGreaterThanOrEqual(8);
    expect(t.schools[0].daysLeft).toBeLessThanOrEqual(9);
  });

  it("reads the contest's limit and whether entries are open from the switches the signup obeys", async () => {
    const setLimit = (n: number) =>
      asClaims(db, fresh(owner), (tx) =>
        tx.query(`select admin.flag_set('contest.daily_limit', 'global', '', $1::jsonb, 'a reason', 'TEST')`, [
          JSON.stringify(n),
        ]),
      );
    await setLimit(750);
    expect((await today()).contest).toEqual({ entriesToday: 0, dailyCap: 750, entriesOpen: true });
    await setLimit(2000);
  });

  it('reports the contest ceiling and today\'s entries', async () => {
    const t = await today();
    expect(t.contest).toEqual({ entriesToday: 0, dailyCap: 2000, entriesOpen: true });
  });
});
