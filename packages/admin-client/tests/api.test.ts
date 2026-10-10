// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, staleAmr, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { makeFinance } from '../../../supabase/tests/billing-fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { AdminError, createAdminClient, pgliteAdminTransport, type AdminClaims } from '../src/index.ts';

/**
 * THE PANEL'S CLIENT, END TO END ON THE REAL MIGRATIONS. Written first.
 *
 * Each call runs as a member of staff would reach the database, so every
 * refusal here is the one production gives: a typed error the screens branch on.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let finance: { id: string; role: 'finance' };
let child: string;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  finance = await makeFinance(db, 'Accounts');
  child = await anonymousChild(db);
});
afterAll(async () => {
  await db.close();
});

const as = (claims: AdminClaims) => createAdminClient(pgliteAdminTransport(db, claims));

describe('reading', () => {
  it('me() says who and which environment', async () => {
    expect(await as(aal2(owner)).me()).toEqual({ userId: owner.id, role: 'owner', displayName: 'Aarav', environment: 'TEST' });
  });

  it('today() and relayStatus() come back typed', async () => {
    const c = as(aal2(ops));
    const today = await c.today();
    expect(today.environment).toBe('TEST');
    expect(today.capture.distress).toBe('not-captured');
    const relay = await c.relayStatus();
    expect(relay).toMatchObject({ halted: false, capOverride: null });
    expect(typeof relay.ceilingUnits).toBe('number');
  });

  it('flagList() returns camelCase rows with the safe default', async () => {
    const flags = await as(aal2(ops)).flagList();
    const tutor = flags.find((f) => f.key === 'tutor.enabled');
    expect(tutor).toMatchObject({ kind: 'bool', guarded: true, schoolScoped: true, safeDefault: true, scope: null, value: null });
  });

  it('stopStatus() answers every staff role, finance included', async () => {
    expect(await as(aal2(finance)).stopStatus()).toEqual({ halted: false, haltedReason: null, haltedAt: null });
    const err = await as({ sub: child, aal: 'aal2', is_anonymous: true }).stopStatus().catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.code).toBe('not-allowed');
  });

  it('today() carries whether contest entries are open', async () => {
    expect((await as(aal2(ops)).today()).contest).toEqual({ entriesToday: 0, dailyCap: 2000, entriesOpen: true });
  });

  it('flagList() reads the minimum builds as versions and the contest limit as a count', async () => {
    const flags = await as(aal2(ops)).flagList();
    expect(flags.find((f) => f.key === 'app.min_version.lms')?.kind).toBe('version');
    expect(flags.find((f) => f.key === 'contest.daily_limit')).toMatchObject({ kind: 'count', safeDefault: 2000 });
  });
});

describe('refusals are typed', () => {
  it('a child gets not-allowed', async () => {
    const err = await as({ sub: child, aal: 'aal2', is_anonymous: true }).me().catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.code).toBe('not-allowed');
  });

  it('a guarded action with an old authenticator code gets needs-mfa', async () => {
    const err = await as(aal2(owner, { amr: staleAmr() })).setCaps(80000, 'launch day', 'TEST').catch((e) => e);
    expect(err.code).toBe('needs-mfa');
  });

  it('the wrong environment gets wrong-environment', async () => {
    const err = await as(aal2(ops)).setHalt(true, 'testing', 'HOSTED').catch((e) => e);
    expect(err.code).toBe('wrong-environment');
  });

  it('a missing reason comes back as its own plain message', async () => {
    const err = await as(aal2(ops)).setHalt(true, 'x', 'TEST').catch((e) => e);
    expect(err.code).toBe('other');
    expect(err.message).toMatch(/say why/);
  });
});

describe('writing', () => {
  it('stop and resume round-trip through the panel client', async () => {
    await as(aal2(ops)).setHalt(true, 'vendor outage', 'TEST');
    expect((await as(aal2(ops)).relayStatus()).halted).toBe(true);
    await as(fresh(owner)).setHalt(false, 'all clear', 'TEST');
    expect((await as(aal2(ops)).relayStatus()).halted).toBe(false);
  });

  it('flagSet() sends the value as a document: booleans stay booleans, text stays text', async () => {
    await as(fresh(owner)).flagSet({ key: 'tutor.enabled', scope: 'global', value: false, reason: 'pause', env: 'TEST' });
    await as(aal2(ops)).flagSet({ key: 'banner.message', scope: 'global', value: 'Back at 7 pm', reason: 'maintenance', env: 'TEST' });
    const config = (await db.query<{ c: Record<string, unknown> }>(`select public.app_config(null) as c`)).rows[0].c;
    expect(config['tutor.enabled']).toBe(false);
    expect(config['banner.message']).toBe('Back at 7 pm');
  });

  it('staffList() and staffSet() work for an owner and are refused for ops', async () => {
    const list = await as(aal2(owner)).staffList();
    expect(list.map((s) => s.displayName)).toEqual(expect.arrayContaining(['Aarav', 'Ops person']));
    const err = await as(aal2(ops)).staffList().catch((e) => e);
    expect(err.code).toBe('not-allowed');
  });
});
