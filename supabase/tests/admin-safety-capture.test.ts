// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { asClaims, asService, createUser, freshDatabase, type JwtClaims } from './harness.ts';
import { keepFlag } from './safety-fixtures.ts';

/**
 * DISTRESS FLAGS, CAPTURED ON THE SERVER (migration 0065). Written first.
 *
 * A flag says that the tutor's screen recognised distress, whose words matched,
 * at which school, and when. It holds no user id, no session, no lesson and no
 * words. The console reads "not captured" until the first flag arrives or the
 * owner records the day capture went live, and the alarm counts the flags
 * received since its previous check (at least 15 minutes, at most a day).
 */

const TOKEN = 'f'.repeat(40);
const REFUSED = /a flag needs a user, an id, a time, the category distress and a direction/;

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let school: School;
let direct: string;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops');
  safety = await makeStaff(db, 'safety');
  school = await buildSchool(db, 'CAP');
  direct = await createUser(db);
  await asService(db, (tx) => tx.query(`select admin.alert_token_set($1)`, [TOKEN]));
});
afterAll(async () => {
  await db.close();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const call = (claims: JwtClaims, sql: string, params: unknown[] = []) => asClaims(db, claims, (tx) => tx.query(sql, params));
const keepRaw = (args: { user?: string | null; id?: string | null; category?: string | null; direction?: string | null; at?: string | null }) =>
  asService(db, (tx) =>
    tx.query(`select public.keep_safety_event($1, $2, $3, $4, 'web', 'b', $5::timestamptz)`, [
      args.user === undefined ? school.kid8a : args.user,
      args.id === undefined ? crypto.randomUUID() : args.id,
      args.category === undefined ? 'distress' : args.category,
      args.direction === undefined ? 'from-student' : args.direction,
      args.at === undefined ? new Date().toISOString() : args.at,
    ]),
  );

describe('keeping a flag', () => {
  it('a flag is kept with its category, direction, school and two times, and with nothing that names the child', async () => {
    const id = crypto.randomUUID();
    expect(await keepFlag(db, school.kid8a, { id })).toBe(true);
    const row = await one<{ org_id: string; category: string; direction: string }>(
      `select org_id, category, direction from admin.safety_event where id = $1`,
      [id],
    );
    expect(row).toEqual({ org_id: school.org, category: 'distress', direction: 'from-student' });
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'admin' and table_name = 'safety_event' order by 1`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(['at', 'category', 'direction', 'id', 'org_id', 'platform', 'received_at', 'release']);
  });

  it('a retry with the same id keeps one row and answers false', async () => {
    const id = crypto.randomUUID();
    expect(await keepFlag(db, school.kid8b, { id, direction: 'to-student' })).toBe(true);
    expect(await keepFlag(db, school.kid8b, { id, direction: 'to-student' })).toBe(false);
    expect((await one<{ n: number }>(`select count(*)::int as n from admin.safety_event where id = $1`, [id])).n).toBe(1);
  });

  it("a direct user's flag has no school", async () => {
    const id = crypto.randomUUID();
    expect(await keepFlag(db, direct, { id })).toBe(true);
    expect((await one<{ org_id: string | null }>(`select org_id from admin.safety_event where id = $1`, [id])).org_id).toBeNull();
  });

  it('a flag that is not distress, has no id, user, time or direction is refused', async () => {
    await expect(keepRaw({ category: 'redirect' })).rejects.toThrow(REFUSED);
    await expect(keepRaw({ id: null })).rejects.toThrow(REFUSED);
    await expect(keepRaw({ user: null })).rejects.toThrow(REFUSED);
    await expect(keepRaw({ at: null })).rejects.toThrow(REFUSED);
    await expect(keepRaw({ direction: null })).rejects.toThrow(REFUSED);
    await expect(keepRaw({ direction: 'sideways' })).rejects.toThrow(REFUSED);
  });

  it('only the service role may keep a flag, and no API role can read the table', async () => {
    const fn = 'public.keep_safety_event(uuid, uuid, text, text, text, text, timestamptz)';
    for (const [role, may] of [['anon', false], ['authenticated', false], ['service_role', true]] as const) {
      const { ok } = await one<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]);
      expect(ok, role).toBe(may);
      const t = await one<{ ok: boolean }>(
        `select has_table_privilege($1, 'admin.safety_event', 'select,insert,update,delete') as ok`,
        [role],
      );
      expect(t.ok, role).toBe(false);
    }
  });

  it('the thousand-and-first flag in an hour is refused with null and not kept', async () => {
    const before = (await one<{ n: number }>(`select count(*)::int as n from admin.safety_event`)).n;
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(
        `insert into admin.safety_event (id, category, direction, at, received_at)
         select gen_random_uuid(), 'distress', 'from-student', now(), now() from generate_series(1, $1::int)`,
        [1000 - before],
      );
    });
    expect(await keepFlag(db, school.kid8a)).toBeNull();
    expect((await one<{ n: number }>(`select count(*)::int as n from admin.safety_event`)).n).toBe(1000);
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(`delete from admin.safety_event`);
    });
  });
});

describe('what the console says about capture', () => {
  it('capture reads not captured until the first flag arrives, then captured since that India day', async () => {
    const other = await freshDatabase();
    try {
      const capture = async () =>
        (await other.query<{ c: Record<string, unknown> }>(`select admin.distress_capture() as c`)).rows[0].c;
      expect(await capture()).toEqual({ state: 'not-captured', since: null, last24h: null, last7d: null });
      const kid = await createUser(other);
      expect(await keepFlag(other, kid)).toBe(true);
      const today = (await other.query<{ d: string }>(`select lms.india_today()::text as d`)).rows[0].d;
      expect(await capture()).toEqual({ state: 'captured', since: today, last24h: 1, last7d: 1 });
    } finally {
      await other.close();
    }
  });

  it('the owner records the day capture went live; ops and safety cannot; a future or older-than-a-year day is refused', async () => {
    const set = (claims: JwtClaims, offset: number) =>
      call(claims, `select admin.safety_capture_set(lms.india_today() + $1::int, 'capture went live with the relay', 'TEST')`, [offset]);
    await set(aal2(owner), -3);
    const s = await one<{ v: string; expected: string }>(
      `select value #>> '{}' as v, to_char(lms.india_today() - 3, 'YYYY-MM-DD') as expected
         from admin.setting where key = 'distress_capture_since'`,
    );
    expect(s.v).toBe(s.expected);
    const audit = await one<{ action: string; details: { on: string } }>(
      `select action, details from admin.audit_event where action = 'distress-capture-since-set' order by id desc limit 1`,
    );
    expect(audit).toEqual({ action: 'distress-capture-since-set', details: { on: s.expected } });
    await expect(set(aal2(ops), -3)).rejects.toThrow(/not allowed/);
    await expect(set(aal2(safety), -3)).rejects.toThrow(/not allowed/);
    await expect(set(aal2(owner), 1)).rejects.toThrow(/the day capture went live is in the last year, not in the future/);
    await expect(set(aal2(owner), -400)).rejects.toThrow(/the day capture went live is in the last year, not in the future/);
    const child = await anonymousChild(db);
    await expect(set({ sub: child, aal: 'aal2' }, -3)).rejects.toThrow(/not allowed/);
  });
});

describe('the alarm', () => {
  const owner_ = async (sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(sql, params);
    });
  const flagAged = async (minutes: number) => {
    const id = crypto.randomUUID();
    expect(await keepFlag(db, school.kid8a, { id })).toBe(true);
    await owner_(`update admin.safety_event set received_at = now() - make_interval(mins => $2::int) where id = $1`, [id, minutes]);
  };
  /** The previous check was `minutes` ago, or never (null). */
  const lastCheck = (minutes: number | null) =>
    minutes === null
      ? owner_(`delete from admin.setting where key = 'alert_last_seen'`)
      : owner_(
          `insert into admin.setting (key, value) values ('alert_last_seen', to_jsonb((now() - make_interval(mins => $1::int))::text))
           on conflict (key) do update set value = excluded.value`,
          [minutes],
        );
  const snapshot = () =>
    db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      return (await tx.query<{ s: Record<string, unknown> }>(`select public.alert_snapshot($1) as s`, [TOKEN])).rows[0].s;
    });

  it('the alarm counts distress flags of the last 15 minutes when it checked more recently or never, and nothing else about them', async () => {
    await owner_(`delete from admin.safety_event`);
    await flagAged(0);
    await flagAged(20);
    await lastCheck(null);
    expect(await snapshot()).toMatchObject({ distressFlags: 1, distressWindowMinutes: 15 });
    await lastCheck(5);
    expect(await snapshot()).toMatchObject({ distressFlags: 1, distressWindowMinutes: 15 });
  });

  it('a flag that arrived after a check is counted at the next check however late it runs, up to a day back', async () => {
    await owner_(`delete from admin.safety_event`);
    await flagAged(18);
    await lastCheck(20);
    expect(await snapshot()).toMatchObject({ distressFlags: 1, distressWindowMinutes: 20 });
    await owner_(`delete from admin.safety_event`);
    await flagAged(25 * 60);
    await flagAged(23 * 60);
    await lastCheck(30 * 60);
    expect(await snapshot()).toMatchObject({ distressFlags: 1, distressWindowMinutes: 24 * 60 });
  });
});
