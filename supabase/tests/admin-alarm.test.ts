// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { asClaims, asService, freshDatabase } from './harness.ts';

/**
 * THE ALARM'S SNAPSHOT (migration 0051). Written first.
 *
 * An outside checker holds the anon key and one token. The snapshot is a fixed
 * list of counts and booleans, a wrong token is answered (so it can be counted)
 * and a burst of them is refused, and every good call is visible on the home
 * page as "the alarm last checked N minutes ago".
 */

const TOKEN = 'a'.repeat(40);
const SIGNALS = [
  'at', 'halted', 'ceilingUnits', 'unitsToday', 'newReports', 'unsafeNewReports',
  'oldestNewReportMinutes', 'pendingClasses', 'relayEvents5m', 'relayFailures5m',
];

let db: PGlite;
let ops: Staff;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  ops = await makeStaff(db, 'ops');
  await asService(db, (tx) => tx.query(`select admin.alert_token_set($1)`, [TOKEN]));
});
afterAll(async () => {
  await db.close();
});

type Snapshot = Record<string, unknown>;
const snapshot = (token: string | null) =>
  db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    return (await tx.query<{ s: Snapshot }>(`select public.alert_snapshot($1) as s`, [token])).rows[0].s;
  });

describe('the snapshot', () => {
  it('returns exactly the whitelisted signals for the right token, and nothing free-text', async () => {
    const s = await snapshot(TOKEN);
    expect(Object.keys(s).sort()).toEqual([...SIGNALS].sort());
    expect(s.halted).toBe(false);
  });

  it('answers a wrong token with an error instead of raising', async () => {
    expect(await snapshot('b'.repeat(40))).toEqual({ error: 'not-allowed' });
    expect(await snapshot(null)).toEqual({ error: 'not-allowed' });
  });

  it('never lets a burst of wrong tokens block the right one, and still counts the wrong ones', async () => {
    await db.query(`delete from admin.alert_miss`);
    for (let i = 0; i < 25; i++) expect(await snapshot('c'.repeat(40))).toEqual({ error: 'not-allowed' });
    expect((await snapshot(TOKEN)).halted).toBe(false);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from admin.alert_miss`);
    expect(rows[0].n).toBe(25);
  });

  it('stores the token only as a hash, and wants at least 32 characters', async () => {
    const { rows } = await db.query<{ token_hash: string }>(`select token_hash from admin.alert_token`);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toContain(TOKEN);
    await expect(asService(db, (tx) => tx.query(`select admin.alert_token_set('short')`))).rejects.toThrow(/at least 32/);
  });
});

describe('the checker being alive', () => {
  it('shows on the home page how long ago it last asked', async () => {
    await snapshot(TOKEN);
    const t = await asClaims(db, aal2(ops), async (tx) => (await tx.query<{ t: { alarm: { lastCheckMinutesAgo: number } } }>(`select admin.today() as t`)).rows[0].t);
    expect(t.alarm.lastCheckMinutesAgo).toBe(0);
  });
});
