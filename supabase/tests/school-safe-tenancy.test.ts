// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAfter,
  asService,
  asUser,
  createSchool,
  createUser,
  enrol,
  freshDatabase,
} from './harness';

/**
 * L0 of the LMS build: what must be true before the first school org exists.
 *
 * Each describe block is one behaviour the audit found deployed and wrong for a
 * school (final plan, Part 1 item 8). Every test here was written first and
 * watched failing against 0001-0020, except those marked GUARD, which pin a
 * behaviour that is right today and must stay right.
 */

const SCHOOL_CREATED = { provisioned_by: 'school' };

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

async function orgsOf(userId: string): Promise<{ kind: string }[]> {
  const { rows } = await db.query<{ kind: string }>(
    `select o.kind from public.membership m join public.organization o on o.id = m.org_id
      where m.user_id = $1`,
    [userId],
  );
  return rows;
}

describe('where a student belongs (A1)', () => {
  it('gives an account the school created no private solo org', async () => {
    const student = await createUser(db, { appMeta: SCHOOL_CREATED });
    expect(await orgsOf(student)).toEqual([]);
  });

  it('GUARD: still gives a student who signed themselves up a private solo org', async () => {
    const student = await createUser(db);
    expect(await orgsOf(student)).toEqual([{ kind: 'solo' }]);
  });

  it("files a student's new work under their school, not their older solo org", async () => {
    const student = await createUser(db);
    const school = await createSchool(db);
    await enrol(db, school, student);
    await asUser(db, student, (tx) =>
      tx.query(
        `insert into public.student_state (user_id, key, value, updated_at) values ($1, 'k', '{}'::jsonb, 1)`,
        [student],
      ),
    );
    const { rows } = await db.query<{ org_id: string }>(
      `select org_id from public.student_state where user_id = $1`,
      [student],
    );
    expect(rows[0].org_id).toBe(school);
  });

  it('answers current_org_id() with the school, for the student asking', async () => {
    const student = await createUser(db);
    const school = await createSchool(db);
    await enrol(db, school, student);
    const { rows } = await asUser(db, student, (tx) =>
      tx.query<{ org: string }>(`select public.current_org_id() as org`),
    );
    expect(rows[0].org).toBe(school);
  });

  it("refuses to tell a student which org another student belongs to", async () => {
    const asking = await createUser(db);
    const other = await createUser(db);
    await expect(
      asUser(db, asking, (tx) => tx.query(`select public.org_of($1)`, [other])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("who can read a school's roster (A2)", () => {
  it("shows a student no other student's membership row", async () => {
    const school = await createSchool(db);
    const a = await createUser(db, { appMeta: SCHOOL_CREATED });
    const b = await createUser(db, { appMeta: SCHOOL_CREATED });
    await enrol(db, school, a);
    await enrol(db, school, b);
    const { rows } = await asUser(db, a, (tx) =>
      tx.query<{ user_id: string }>(`select user_id from public.membership`),
    );
    expect(rows.map((r) => r.user_id)).toEqual([a]);
  });
});

describe('the nightly purge (A3)', () => {
  async function oldEvent(userId: string, daysAgo: number): Promise<string> {
    const { rows: orgRows } = await db.query<{ org_id: string }>(
      `select org_id from public.membership where user_id = $1 limit 1`,
      [userId],
    );
    const org = orgRows[0].org_id;
    const session = crypto.randomUUID();
    const received = `now() - interval '${daysAgo} days'`;
    await db.query(
      `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
       values ($1, $2, $3, 'quiz', ${received}, ${received})`,
      [session, org, userId],
    );
    const id = crypto.randomUUID();
    await db.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface)
       values ($1, $2, $3, $4, 0, ${received}, ${received}, 'answered', 'quiz', 'tap')`,
      [id, org, userId, session],
    );
    return id;
  }

  async function stillThere(eventId: string): Promise<boolean> {
    const { rows } = await db.query(`select 1 from public.ledger_event where id = $1`, [eventId]);
    return rows.length === 1;
  }

  // 0021 made this purge delete only what a server fold had covered, and no
  // fold wrote that mark, so it deleted nothing. 0102 restores Aarav's choice
  // (a): every answer older than the window goes, by age alone, whatever
  // learner_model says; the server's snapshot (0101) keeps what the fold
  // learned from them (lam-one-brain Task 2b).
  it('deletes an old event that no fold has covered (0102)', async () => {
    const student = await createUser(db);
    const event = await oldEvent(student, 200);
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect(await stillThere(event)).toBe(false);
  });

  it('deletes an old event the fold has covered', async () => {
    const student = await createUser(db);
    const event = await oldEvent(student, 200);
    await db.query(
      `insert into public.learner_model (user_id, org_id, folded_through_received_at)
       select $1, org_id, now() - interval '100 days' from public.membership where user_id = $1`,
      [student],
    );
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect(await stillThere(event)).toBe(false);
  });

  it('GUARD: keeps an event younger than the retention window even when folded', async () => {
    const student = await createUser(db);
    const event = await oldEvent(student, 10);
    await db.query(
      `insert into public.learner_model (user_id, org_id, folded_through_received_at)
       select $1, org_id, now() from public.membership where user_id = $1`,
      [student],
    );
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect(await stillThere(event)).toBe(true);
  });
});

describe('deleting an account (A4)', () => {
  it('refuses when the student belongs to a school', async () => {
    const school = await createSchool(db);
    const student = await createUser(db, { appMeta: SCHOOL_CREATED });
    await enrol(db, school, student);
    await expect(
      asUser(db, student, (tx) => tx.query(`select public.delete_own_account()`)),
    ).rejects.toThrow(/school/i);
    const { rows } = await db.query(`select 1 from auth.users where id = $1`, [student]);
    expect(rows).toHaveLength(1);
  });

  it('GUARD: still lets a student who signed themselves up delete their account', async () => {
    const student = await createUser(db);
    await asUser(db, student, (tx) => tx.query(`select public.delete_own_account()`));
    const { rows } = await db.query(`select 1 from auth.users where id = $1`, [student]);
    expect(rows).toHaveLength(0);
  });
});

describe('the learner entity', () => {
  it('gives every new account exactly one learner', async () => {
    const student = await createUser(db);
    const { rows } = await db.query(`select 1 from public.learner where auth_user_id = $1`, [student]);
    expect(rows).toHaveLength(1);
  });

  it('allows a learner with no login, known only by an org and its own id', async () => {
    const partner = await createSchool(db, 'An external org');
    await db.query(`insert into public.learner (org_id, external_id) values ($1, 'roll-42')`, [partner]);
    const { rows } = await db.query(
      `select 1 from public.learner where org_id = $1 and external_id = 'roll-42'`,
      [partner],
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a second learner with the same external id in the same org', async () => {
    const org = await createSchool(db, 'Another org');
    await db.query(`insert into public.learner (org_id, external_id) values ($1, 'dup')`, [org]);
    await expect(
      db.query(`insert into public.learner (org_id, external_id) values ($1, 'dup')`, [org]),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('refuses a learner that is neither a login nor an org-scoped external id', async () => {
    await expect(db.query(`insert into public.learner default values`)).rejects.toThrow(/check/i);
  });

  it("shows a student their own learner row and nobody else's", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const { rows } = await asUser(db, a, (tx) =>
      tx.query<{ auth_user_id: string }>(`select auth_user_id from public.learner`),
    );
    expect(rows.map((r) => r.auth_user_id)).toEqual([a]);
    expect(rows.map((r) => r.auth_user_id)).not.toContain(b);
  });
});

describe('the backfill, against accounts that predate the migration', () => {
  it('gives every existing account one learner, and moves nobody', async () => {
    const before = await freshDatabase({ through: '0020' });
    const u1 = await createUser(before);
    const u2 = await createUser(before);
    const { rows: orgsBefore } = await before.query(`select user_id, org_id from public.membership order by user_id`);
    await applyAfter(before, '0020');
    const { rows } = await before.query<{ auth_user_id: string }>(
      `select auth_user_id from public.learner order by auth_user_id`,
    );
    expect(rows.map((r) => r.auth_user_id).sort()).toEqual([u1, u2].sort());
    const { rows: orgsAfter } = await before.query(`select user_id, org_id from public.membership order by user_id`);
    expect(orgsAfter).toEqual(orgsBefore);
    await before.close();
  });
});

describe('what the ledger accepts', () => {
  // The constraint takes every LMS source; since 0034 a phone could write only
  // the tutor's own (and 'api'), and since 0110 a phone writes nothing directly:
  // its evidence comes in through public.record_evidence (0107), which takes
  // the tutor's sources only. Homework, test and practice evidence comes from
  // the school's functions alone (packages/lms-client/tests/safety.test.ts).
  const phoneSession = (student: string, source: string) =>
    asUser(db, student, (tx) =>
      tx.query(
        `insert into public.learning_session (id, org_id, user_id, source, started_at)
         select $1, org_id, $2, $3, now() from public.membership where user_id = $2`,
        [crypto.randomUUID(), student, source],
      ),
    );

  const throughRecordEvidence = async (student: string, source: string): Promise<{ status: string; reason: string | null }> => {
    const session = crypto.randomUUID();
    const at = new Date().toISOString();
    const { rows } = await asUser(db, student, (tx) =>
      tx.query<{ status: string; reason: string | null }>(
        `select status, reason from public.record_evidence($1::jsonb, $2::jsonb)`,
        [
          JSON.stringify([{ id: session, source, startedAt: at }]),
          JSON.stringify([{ id: crypto.randomUUID(), sessionId: session, seq: 0, at, kind: 'answered', source, surface: 'tap' }]),
        ],
      ),
    );
    return rows[0];
  };

  it.each(['homework', 'test', 'practice'])('accepts a %s session from the school’s own functions, not a phone', async (source) => {
    const student = await createUser(db);
    await expect(phoneSession(student, source)).rejects.toThrow(/permission denied/);
    expect(await throughRecordEvidence(student, source)).toEqual({ status: 'refused', reason: 'source' });
    await db.query(
      `insert into public.learning_session (id, org_id, user_id, source, started_at)
       select $1, org_id, $2, $3, now() from public.membership where user_id = $2`,
      [crypto.randomUUID(), student, source],
    );
  });

  // Until 0107/0110 a phone could write 'api' evidence itself. Nothing in the
  // tutor sends it, so it is refused from a phone now; the constraint still
  // takes it from the service role.
  it.each(['api'])('accepts a %s session and its events from the service role, not a phone', async (source) => {
    const student = await createUser(db);
    await expect(phoneSession(student, source)).rejects.toThrow(/permission denied/);
    expect(await throughRecordEvidence(student, source)).toEqual({ status: 'refused', reason: 'source' });
    const session = crypto.randomUUID();
    await asService(db, async (tx) => {
      await tx.query(
        `insert into public.learning_session (id, org_id, user_id, source, started_at)
         select $1, org_id, $2, $3, now() from public.membership where user_id = $2`,
        [session, student, source],
      );
      await tx.query(
        `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface)
         select $1, org_id, $2, $3, 0, now(), 'answered', $4, 'tap' from public.membership where user_id = $2`,
        [crypto.randomUUID(), student, session, source],
      );
    });
  });

  it('GUARD: still rejects a source nobody defined', async () => {
    const student = await createUser(db);
    await expect(
      asService(db, (tx) =>
        tx.query(
          `insert into public.learning_session (id, org_id, user_id, source, started_at)
           select $1, org_id, $2, 'made-up', now() from public.membership where user_id = $2`,
          [crypto.randomUUID(), student],
        ),
      ),
    ).rejects.toThrow(/check/i);
    expect(await throughRecordEvidence(student, 'made-up')).toEqual({ status: 'refused', reason: 'source' });
  });
});

describe('membership roles', () => {
  it('accepts parent as a role, reserved for later', async () => {
    const school = await createSchool(db);
    const adult = await createUser(db, { appMeta: SCHOOL_CREATED });
    await enrol(db, school, adult, 'parent');
    const { rows } = await db.query(`select role from public.membership where user_id = $1`, [adult]);
    expect(rows).toEqual([{ role: 'parent' }]);
  });
});
