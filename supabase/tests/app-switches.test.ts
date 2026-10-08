// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { asClaims, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * SWITCHES YOU CAN TRUST (migration 0062). Written first.
 *
 * A minimum build is three whole numbers, so a typo cannot lock an app out
 * (M13); the contest's daily limit is a guarded count; the old kinds behave as
 * before; the validator stays internal.
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

type Config = Record<string, unknown>;
const config = async () => (await db.query<{ c: Config }>(`select public.app_config(null) as c`)).rows[0].c;
const setFlag = (claims: JwtClaims, key: string, value: unknown) =>
  asClaims(db, claims, (tx) =>
    tx.query(`select admin.flag_set($1, 'global', '', $2::jsonb, 'a reason', 'TEST')`, [key, JSON.stringify(value)]),
  );

describe('the switch kinds', () => {
  it('the minimum builds are versions, and only a well-formed one can be set (M13)', async () => {
    const { rows } = await db.query<{ key: string; kind: string }>(
      `select key, kind from admin.flag_def where key like 'app.min_version.%' order by 1`,
    );
    expect(rows).toEqual([
      { key: 'app.min_version.classroom', kind: 'version' },
      { key: 'app.min_version.lms', kind: 'version' },
      { key: 'app.min_version.student', kind: 'version' },
    ]);
    for (const good of ['0.1.0', '2.3.0', '10.0.12']) {
      await setFlag(aal2(ops), 'app.min_version.student', good);
      expect((await config())['app.min_version.student']).toBe(good);
    }
    for (const bad of ['0.1', '1.0.0-beta', ' 0.1.0', 'v1.2.3', '1.2.3.4', '12345.0.0', '', 1]) {
      await expect(setFlag(aal2(ops), 'app.min_version.student', bad)).rejects.toThrow(
        /does not suit this switch \(version\)/,
      );
    }
    await setFlag(aal2(ops), 'app.min_version.student', '0.0.0');
  });

  it('the contest\'s daily limit is a guarded count, 2000 until someone sets it', async () => {
    expect((await config())['contest.daily_limit']).toBe(2000);
    const { rows } = await db.query<{ kind: string; guarded: boolean; school_scoped: boolean }>(
      `select kind, guarded, school_scoped from admin.flag_def where key = 'contest.daily_limit'`,
    );
    expect(rows).toEqual([{ kind: 'count', guarded: true, school_scoped: false }]);
    await expect(setFlag(aal2(ops), 'contest.daily_limit', 500)).rejects.toThrow(/authenticator code/);
    await setFlag(fresh(ops), 'contest.daily_limit', 500);
    expect((await config())['contest.daily_limit']).toBe(500);
    for (const bad of [0, 100001, 2.5, '500']) {
      await expect(setFlag(fresh(ops), 'contest.daily_limit', bad)).rejects.toThrow(
        /does not suit this switch \(count\)/,
      );
    }
    await setFlag(fresh(ops), 'contest.daily_limit', 2000);
  });

  it('the other kinds still behave as before', async () => {
    await expect(setFlag(aal2(ops), 'banner.tone', 'loud')).rejects.toThrow(/does not suit/);
    await expect(setFlag(aal2(ops), 'banner.message', 42)).rejects.toThrow(/does not suit/);
    await setFlag(fresh(owner), 'tutor.only_prepared', true);
    expect((await config())['tutor.only_prepared']).toBe(true);
    await setFlag(fresh(owner), 'tutor.only_prepared', false);
  });

  it('flag_valid stays internal', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'admin.flag_valid(text, jsonb)', 'execute') as ok`,
        [role],
      );
      expect(rows[0].ok).toBe(false);
    }
  });
});
