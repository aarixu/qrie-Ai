// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { setLicence } from '../../../supabase/tests/admin-school-fixtures.ts';
import { buildSchool } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { handleAdminApi } from '../../../tools/admin-api/src/handle.ts';
import { apiWorld, type ApiWorld } from '../../../tools/admin-api/tests/deps.ts';
import { AdminError, createSchoolsClient, pgliteAdminTransport, replyCaller, type AdminClaims } from '../src/index.ts';

/**
 * THE SCHOOLS CLIENT, END TO END. Written first.
 *
 * Database calls run as the member of staff would reach PostgREST; the calls
 * that need the service role go through the staff service's handler with that
 * member's token. Answers come back typed and camelCase; refusals as AdminError.
 */

let db: PGlite;
let world: ApiWorld;
let owner: Staff;
let ops: Staff;
let child: string;
const SHEET = 'grade,section,roll,name\n8,A,5,Asha Rao\n';
const NINE = ['licence', 'payment', 'seats', 'activation', 'teaching', 'learning', 'attendance', 'safety', 'lastActive'];

beforeAll(async () => {
  db = await freshDatabase();
  world = apiWorld(db);
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  child = await anonymousChild(db);
  await buildSchool(db, 'CLI');
  await setLicence(db, 'CLI', 100, 200);
  world.tokens['owner'] = () => aal2(owner);
  world.tokens['owner-fresh'] = () => fresh(owner);
  world.tokens['ops'] = () => aal2(ops);
  world.tokens['ops-fresh'] = () => fresh(ops);
  world.tokens['child'] = () => ({ sub: child, aal: 'aal2', is_anonymous: true });
});
afterAll(async () => {
  await db.close();
});

/** A schools client for one caller: their claims for the database, their token for the staff service. */
const as = (claims: AdminClaims, token: string) =>
  createSchoolsClient(
    pgliteAdminTransport(db, claims),
    replyCaller((route, body) =>
      handleAdminApi({ method: 'POST', path: `/x/${route}`, authorization: `Bearer ${token}`, body }, world.deps()),
    ),
  );
const opsClient = () => as(aal2(ops), 'ops');
const codeOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e instanceof AdminError ? e.code : `untyped: ${String(e)}`));

describe('reading', () => {
  it('list, index and health come back typed, with the payment signal', async () => {
    const c = opsClient();
    const [row] = await c.list();
    expect(row).toMatchObject({ code: 'CLI', paymentLevel: 'grey', paymentReason: 'No billing account yet.', seatsUsed: 2, offboarded: false });
    expect(row.seats).toBe(100);
    expect(row.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await c.index()).toEqual([{ code: 'CLI', name: 'CLI Public School' }]);
    const h = await c.health('cli');
    expect(h.code).toBe('CLI');
    expect(h.signals).toHaveLength(9);
    for (const sig of h.signals) expect(NINE).toContain(sig.key);
  });

  it('detail, people, person, activity, weekly and notes come back typed', async () => {
    const c = opsClient();
    const d = await c.detail('CLI');
    expect(d).toMatchObject({ code: 'CLI', name: 'CLI Public School', board: 'CBSE', quietUntil: null, offboardedAt: null });
    expect(d.licence).toMatchObject({ plan: 'pilot', seats: 100, seatsUsed: 2 });
    expect(d.health.signals).toHaveLength(9);
    const weeks = await c.weekly('CLI');
    expect(weeks).toHaveLength(8);
    for (const w of weeks) {
      expect(w.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof w.published).toBe('number');
      expect(typeof w.handedIn).toBe('number');
      expect(typeof w.attendanceMarked).toBe('number');
    }
    expect((await c.people('CLI', 'riya'))[0]).toEqual({
      loginId: 'CLI-101',
      kind: 'student',
      displayName: 'Riya',
      className: '8A',
      leftSchool: false,
    });
    expect((await c.person('CLI', 'CLI-101')).className).toBe('8A');
    const act = await c.activity('CLI');
    expect(Array.isArray(act)).toBe(true);
    expect(act.find((a) => a.action === 'licence-set')).toMatchObject({ source: 'school' });
    expect(await c.notes('CLI')).toEqual({ quietUntil: null, offboardedAt: null, contacts: [], notes: [] });
  });
});

describe('writing', () => {
  it('the writes send the environment and the reason; a wrong environment is a typed wrong-environment', async () => {
    const c = opsClient();
    const org = await c.create({
      code: 'cli2',
      name: 'Client Two School',
      board: 'CBSE',
      yearLabel: '2026-27',
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
      reason: 'pilot',
      env: 'TEST',
    });
    expect(org).toMatch(/^[0-9a-f-]{36}$/);
    expect(await codeOf(c.setQuiet({ code: 'CLI', until: null, reason: 'r', env: 'HOSTED' }))).toBe('wrong-environment');
    const note = await c.addNote({ code: 'CLI', kind: 'call', body: 'Called the principal', reason: 'call log', env: 'TEST' });
    expect(note).toMatch(/^[0-9a-f-]{36}$/);
    const contact = await c.setContact({ code: 'CLI', name: 'Mrs Rao', role: 'Principal', phone: '+919876543210', reason: 'new principal', env: 'TEST' });
    expect(contact).toMatch(/^[0-9a-f-]{36}$/);
    const notes = await c.notes('CLI');
    expect(notes.notes[0]).toMatchObject({ id: note, kind: 'call', authorName: 'Ops person' });
    expect(notes.contacts[0]).toMatchObject({ id: contact, phone: '+919876543210', email: null });
  });

  it('a guarded write with an old code is a typed needs-mfa', async () => {
    const licence = { code: 'CLI', plan: 'standard', seats: 120, validUntil: '2027-03-31', reason: 'signed for a year', env: 'TEST' };
    expect(await codeOf(as(aal2(owner), 'owner').setLicence(licence))).toBe('needs-mfa');
    expect(await codeOf(as(fresh(owner), 'owner-fresh').setLicence(licence))).toBe('resolved');
    expect((await opsClient().detail('CLI')).licence).toMatchObject({ plan: 'standard', seats: 120, validUntil: '2027-03-31' });
  });

  it('importPeople and resetPin go through admin-api', async () => {
    const c = opsClient();
    const preview = await c.importPeople({ code: 'CLI', students: SHEET, commit: false });
    expect(preview.committed).toBe(false);
    const commit = { code: 'CLI', students: SHEET, commit: true, acceptWarnings: true, reason: 'term starts', env: 'TEST' };
    expect(await codeOf(c.importPeople(commit))).toBe('needs-mfa');
    const done = await as(fresh(ops), 'ops-fresh').importPeople(commit);
    expect(done.committed).toBe(true);
    expect(done.created[0].pin).toMatch(/^\d{6}$/);
    const reset = { code: 'CLI', loginId: 'CLI-8A-5', reason: 'parent called', env: 'TEST' };
    const fresher = await as(fresh(ops), 'ops-fresh').resetPin(reset);
    expect(fresher).toMatchObject({ loginId: 'CLI-8A-5', displayName: 'Asha Rao' });
    expect(fresher.pin).toMatch(/^\d{6}$/);
    expect(fresher.pin).toBe(world.passwords.get('CLI-8A-5'));
    expect(await codeOf(c.resetPin(reset))).toBe('needs-mfa');
  });

  it('a child is a typed not-allowed everywhere', async () => {
    const c = as({ sub: child, aal: 'aal2', is_anonymous: true }, 'child');
    expect(await codeOf(c.list())).toBe('not-allowed');
    expect(await codeOf(c.detail('CLI'))).toBe('not-allowed');
    expect(await codeOf(c.people('CLI', 'riya'))).toBe('not-allowed');
    expect(await codeOf(c.importPeople({ code: 'CLI', students: SHEET, commit: false }))).toBe('not-allowed');
  });
});
