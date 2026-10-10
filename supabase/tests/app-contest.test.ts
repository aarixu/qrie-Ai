// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { asClaims, freshDatabase } from './harness.ts';

/**
 * THE CONTEST OBEYS ITS SWITCHES (migration 0062). Written first.
 *
 * record_contest_signup reads contest.entries_open and contest.daily_limit
 * from one internal function (admin.contest_rules) and counts the day as
 * India's day; a correction to an entry already made is never refused.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
});
afterAll(async () => {
  await db.close();
});

const setFlag = (who: Staff, key: string, value: unknown) =>
  asClaims(db, fresh(who), (tx) =>
    tx.query(`select admin.flag_set($1, 'global', '', $2::jsonb, 'a reason', 'TEST')`, [key, JSON.stringify(value)]),
  );

const entrant = () => anonymousChild(db);
const sign = (user: string, name = 'A child') =>
  asClaims(db, { sub: user, is_anonymous: true }, (tx) =>
    tx.query(
      `select public.record_contest_signup($1, 8, null, '12 Road', true, 'A parent', '+919876543210', 'test')`,
      [name],
    ),
  );
const count = async () =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.contest_signup`)).rows[0].n;

beforeEach(async () => {
  await db.query(`delete from public.contest_signup`);
  await setFlag(owner, 'contest.daily_limit', 2000);
  await setFlag(owner, 'contest.entries_open', true);
});

describe('the contest signup', () => {
  it("takes entries up to the day's limit read from the switch, and refuses the next new one with 53400", async () => {
    await setFlag(ops, 'contest.daily_limit', 3);
    for (let i = 0; i < 3; i += 1) await sign(await entrant());
    await expect(sign(await entrant())).rejects.toMatchObject({
      code: '53400',
      message: expect.stringMatching(/entries are closed for today/),
    });
    expect(await count()).toBe(3);
  });

  it('an entrant already in can still correct their entry when the day is full', async () => {
    await setFlag(ops, 'contest.daily_limit', 3);
    const first = await entrant();
    await sign(first);
    await sign(await entrant());
    await sign(await entrant());
    await sign(first, 'A corrected name');
    const { rows } = await db.query<{ student_name: string }>(
      `select student_name from public.contest_signup where user_id = $1`,
      [first],
    );
    expect(rows[0].student_name).toBe('A corrected name');
    expect(await count()).toBe(3);
  });

  it("counts the day as India's day", async () => {
    const yesterday = await entrant();
    await db.query(
      `insert into public.contest_signup (user_id, student_name, klass, created_at)
       values ($1, 'Yesterday', 8, (lms.india_today())::timestamp at time zone 'Asia/Kolkata' - interval '1 minute')`,
      [yesterday],
    );
    await setFlag(ops, 'contest.daily_limit', 1);
    await sign(await entrant());
    await expect(sign(await entrant())).rejects.toMatchObject({ code: '53400' });
  });

  it('refuses every new entry while entries are closed, with 55000, and still lets an entrant correct theirs', async () => {
    const existing = await entrant();
    await sign(existing);
    await setFlag(ops, 'contest.entries_open', false);
    await expect(sign(await entrant())).rejects.toMatchObject({
      code: '55000',
      message: expect.stringMatching(/the contest is not taking entries/),
    });
    await expect(sign(existing, 'Fixed a typo')).resolves.toBeDefined();
    await setFlag(owner, 'contest.entries_open', true);
  });

  it('still refuses a caller with no session', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query(
          `select public.record_contest_signup('A child', 8, null, '12 Road', true, 'A parent', '+919876543210', 'test')`,
        );
      }),
    ).rejects.toMatchObject({ code: '28000' });
  });

  it('the signup is still for signed-in callers only', async () => {
    const can = async (role: string) =>
      (
        await db.query<{ ok: boolean }>(
          `select has_function_privilege($1, 'public.record_contest_signup(text, integer, text, text, boolean, text, text, text)', 'execute') as ok`,
          [role],
        )
      ).rows[0].ok;
    expect(await can('anon')).toBe(false);
    expect(await can('authenticated')).toBe(true);
  });

  it('admin.contest_rules is internal', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'admin.contest_rules()', 'execute') as ok`,
        [role],
      );
      expect(rows[0].ok).toBe(false);
    }
  });
});
