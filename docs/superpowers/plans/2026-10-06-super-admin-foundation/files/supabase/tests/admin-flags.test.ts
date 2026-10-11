// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, staleAmr, type Staff } from './admin-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { asClaims, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * REMOTE SWITCHES FOR EVERY APP (migration 0050). Written first.
 *
 * A flag is registered with a type and a safe default; the apps read them only
 * through public.app_config(); setting one is audited with its before and
 * after, and a guarded one needs the authenticator code verified just now.
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
  await buildSchool(db, 'SUN');
});
afterAll(async () => {
  await db.close();
});

type Config = Record<string, unknown>;
const config = async (school?: string) =>
  (await db.query<{ c: Config }>(`select public.app_config($1) as c`, [school ?? null])).rows[0].c;
const setFlag = (claims: JwtClaims, key: string, scope: string, scopeId: string, value: unknown, reason = 'a reason') =>
  asClaims(db, claims, (tx) =>
    tx.query(`select admin.flag_set($1, $2, $3, $4::jsonb, $5, 'TEST')`, [key, scope, scopeId, JSON.stringify(value), reason]),
  );

describe('what the apps read', () => {
  it('is the safe default for every switch nothing has set', async () => {
    const c = await config();
    expect(c['tutor.enabled']).toBe(true);
    expect(c['tutor.only_prepared']).toBe(false);
    expect(c['tutor.compose_live_classes']).toBe(false);
    expect(c['contest.entries_open']).toBe(true);
    expect(c['banner.message']).toBe('');
    expect(c['app.min_version.classroom']).toBe('0.0.0');
  });

  it('is readable with no sign-in at all, and the tables behind it are not', async () => {
    await db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      expect((await tx.query<{ c: Config }>(`select public.app_config(null) as c`)).rows[0].c['tutor.enabled']).toBe(true);
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query(`select * from admin.app_flag`);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('setting a switch', () => {
  it('ops can set an ordinary one, and the apps see it', async () => {
    await setFlag(aal2(ops), 'banner.message', 'global', '', 'Classes pause 6 to 7 pm', 'maintenance');
    expect((await config())['banner.message']).toBe('Classes pause 6 to 7 pm');
  });

  it('refuses an unknown key and a value of the wrong type', async () => {
    await expect(setFlag(aal2(ops), 'nope.x', 'global', '', true)).rejects.toThrow(/no switch called/);
    await expect(setFlag(aal2(ops), 'banner.tone', 'global', '', 'loud')).rejects.toThrow(/does not suit/);
    await expect(setFlag(aal2(ops), 'banner.message', 'global', '', 42)).rejects.toThrow(/does not suit/);
  });

  it('a guarded switch needs the code verified a moment ago', async () => {
    await expect(setFlag(aal2(owner, { amr: staleAmr() }), 'tutor.enabled', 'global', '', false, 'pause')).rejects.toThrow(
      /authenticator code/,
    );
    await setFlag(fresh(owner), 'tutor.enabled', 'global', '', false, 'pause');
    expect((await config())['tutor.enabled']).toBe(false);
  });

  it('a safety reviewer cannot set switches', async () => {
    await expect(setFlag(aal2(safety), 'banner.message', 'global', '', 'hi')).rejects.toThrow(/not allowed/);
  });

  it("a school's value overrides the global one for that school only", async () => {
    await setFlag(fresh(owner), 'tutor.enabled', 'school', 'sun', true, 'this school on');
    expect((await config('SUN'))['tutor.enabled']).toBe(true);
    expect((await config('sun'))['tutor.enabled']).toBe(true);
    expect((await config('ZZZ'))['tutor.enabled']).toBe(false);
    expect((await config())['tutor.enabled']).toBe(false);
  });

  it('refuses a school scope for a global-only switch, and for a school that does not exist', async () => {
    await expect(setFlag(aal2(ops), 'banner.message', 'school', 'SUN', 'hi')).rejects.toThrow(/cannot be set for school/);
    await expect(setFlag(fresh(owner), 'tutor.enabled', 'school', 'NOPE', true)).rejects.toThrow(/no school with the code/);
  });

  it('keeps the value before and after in the audit log', async () => {
    const { rows } = await db.query<{ details: { before: unknown; after: unknown } }>(
      `select details from admin.audit_event where action = 'flag-set' and target_id = 'banner.message' order by id desc limit 1`,
    );
    expect(rows[0].details).toHaveProperty('before');
    expect(rows[0].details.after).toBe('Classes pause 6 to 7 pm');
  });

  it('lists every registered switch for the panel', async () => {
    const rows = await asClaims(db, aal2(ops), async (tx) => (await tx.query<{ key: string }>(`select * from admin.flag_list()`)).rows);
    expect(new Set(rows.map((r) => r.key)).size).toBeGreaterThanOrEqual(9);
  });
});
