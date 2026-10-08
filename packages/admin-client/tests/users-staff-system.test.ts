// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { handleAdminApi } from '../../../tools/admin-api/src/handle.ts';
import { apiWorld, type ApiWorld } from '../../../tools/admin-api/tests/deps.ts';
import {
  AdminError,
  createAdminClient,
  createStaffClient,
  createSystemClient,
  createUsersClient,
  pgliteAdminTransport,
  replyCaller,
  type AdminClaims,
} from '../src/index.ts';

/**
 * THE USERS, STAFF AND SYSTEM CLIENTS, END TO END. Written first.
 *
 * As schools.test.ts: database calls as the member of staff, service calls
 * through the staff service's handler with their token. Also M2: staffSet
 * sends the environment the console was built for.
 */

let db: PGlite;
let world: ApiWorld;
let owner: Staff;
let ops: Staff;
let child: string;

beforeAll(async () => {
  db = await freshDatabase();
  world = apiWorld(db);
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  child = await anonymousChild(db);
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at)
     values (gen_random_uuid(), public.org_of($1), $1, 'class', now())`,
    [child],
  );
  world.tokens['owner'] = () => aal2(owner);
  world.tokens['owner-fresh'] = () => fresh(owner);
  world.tokens['ops'] = () => aal2(ops);
});
afterAll(async () => {
  await db.close();
});

const api = (token: string) =>
  replyCaller((route, body) => handleAdminApi({ method: 'POST', path: `/x/${route}`, authorization: `Bearer ${token}`, body }, world.deps()));
const codeOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e instanceof AdminError ? e.code : `untyped: ${String(e)}`));
const usersAs = (claims: AdminClaims, token: string) => createUsersClient(pgliteAdminTransport(db, claims), api(token));
const staffAs = (claims: AdminClaims, token: string) => createStaffClient(pgliteAdminTransport(db, claims), api(token));

describe('users', () => {
  it('summary, find and user come back typed', async () => {
    const u = usersAs(aal2(ops), 'ops');
    expect((await u.summary()).total).toBe(1);
    const found = await u.find(child.slice(0, 8));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ userId: child, ref: child.slice(0, 8), anonymous: true, blocked: false });
    const card = await u.user(child);
    expect(card.sessions).toBe(1);
    expect(card.createdOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('setBlocked goes through admin-api, and the card then says blocked', async () => {
    const u = usersAs(aal2(ops), 'ops');
    expect(await u.setBlocked({ userId: child, blocked: true, reason: 'scripted abuse', env: 'TEST' })).toEqual({ userId: child, blocked: true });
    expect(world.bans.get(child)).toBe(true);
    expect((await u.user(child)).blocked).toBe(true);
    await u.setBlocked({ userId: child, blocked: false, reason: 'appeal upheld', env: 'TEST' });
    expect((await u.user(child)).blocked).toBe(false);
  });
});

describe('staff', () => {
  it('roster and auditList come back typed, ids as numbers; invite goes through admin-api and returns the temporary password', async () => {
    const boss = staffAs(fresh(owner), 'owner-fresh');
    const log = await boss.auditList({});
    expect(log.length).toBeGreaterThan(0);
    expect(typeof log[0].id).toBe('number');
    expect(log.map((r) => r.action)).toContain('user-blocked');
    expect((await boss.auditList({ action: 'user-', limit: 1 }))).toHaveLength(1);

    const invitation = await boss.invite({ email: 'Helper@Example.com', displayName: 'Helper', role: 'ops', reason: 'hire', env: 'TEST' });
    expect(invitation.email).toBe('helper@example.com');
    expect(invitation.temporaryPassword).toHaveLength(20);
    const roster = await boss.roster();
    expect(roster.find((r) => r.userId === invitation.userId)).toMatchObject({ status: 'invited', role: 'ops', displayName: 'Helper' });
    expect(roster.find((r) => r.userId === owner.id)).toMatchObject({ status: 'active', role: 'owner', factor: 'not-captured' });

    const madeOnly = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    expect((await boss.roster()).find((r) => r.userId === madeOnly)).toMatchObject({ status: 'account-only', role: null });
    await boss.addExisting({ userId: madeOnly, role: 'safety', displayName: 'Reviewer', reason: 'backup reviewer', env: 'TEST' });
    expect((await boss.roster()).find((r) => r.userId === madeOnly)).toMatchObject({ status: 'invited', role: 'safety' });
    expect(await codeOf(staffAs(aal2(ops), 'ops').roster())).toBe('not-allowed');
  });

  it('staffSet sends the environment (M2)', async () => {
    const hire = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    const c = createAdminClient(pgliteAdminTransport(db, fresh(owner)));
    const input = { userId: hire, role: 'ops' as const, displayName: 'X', active: true, reason: 'new ops person' };
    expect(await codeOf(c.staffSet({ ...input, env: 'HOSTED' }))).toBe('wrong-environment');
    expect(await codeOf(c.staffSet({ ...input, env: 'TEST' }))).toBe('resolved');
  });
});

describe('system', () => {
  it('health comes back typed and setRestoreDrill records a date', async () => {
    const sys = createSystemClient(pgliteAdminTransport(db, aal2(ops)));
    const h = await sys.health();
    expect(Array.isArray(h.jobs)).toBe(true);
    expect(h.environment).toBe('TEST');
    // Billing's log (plan 3's 0057) is in this database since the wave-1 merge, so the Cashfree row is captured.
    expect(h.cashfree).toEqual({
      captured: true,
      lastWebhookMinutesAgo: null,
      signatureFailures24h: 0,
      unprocessed: 0,
      reconciledMinutesAgo: null,
    });
    const yesterday = (await db.query<{ d: string }>(`select to_char(lms.india_today() - 1, 'YYYY-MM-DD') as d`)).rows[0].d;
    await sys.setRestoreDrill({ on: yesterday, reason: 'restored into a scratch project', env: 'TEST' });
    expect((await sys.health()).restoreDrill).toEqual({ on: yesterday, daysAgo: 1 });
  });
});
