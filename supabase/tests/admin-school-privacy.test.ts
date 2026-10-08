// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { makeFinance, rpc } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { freshDatabase, type JwtClaims } from './harness.ts';

/**
 * WHO IS RESPONSIBLE FOR A SCHOOL'S CHILDREN'S DATA, AND WHO IS TOLD (0066).
 * Written first.
 *
 * Counsel decides both; the owner records the decision per school, with a
 * fresh code and what it rests on. While either is undecided, the import gate
 * (admin.privacy_import_refusal, called by plan 4's admin.import_refusal)
 * refuses to add people to that school, on HOSTED and STAGING databases only.
 */

const SENTENCE =
  "Qrie has not yet recorded who is responsible for this school's children's data and who is told if a child may be at risk. " +
  'The owner records both on the Privacy page; until then nobody can be added to this school.';
const BASIS = "counsel's letter of 2026-11-02";

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let pra: School;
let prb: School;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db, 'HOSTED');
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  finance = await makeFinance(db);
  pra = await buildSchool(db, 'PRA');
  prb = await buildSchool(db, 'PRB');
});
afterAll(async () => {
  await db.close();
});

const refusal = async (org: string, on: PGlite = db) =>
  (await on.query<{ r: string | null }>(`select admin.privacy_import_refusal($1) as r`, [org])).rows[0].r;
const decide = (claims: JwtClaims, code: string, fiduciary: string, recipient: string, basis: string | null = BASIS) =>
  rpc(db, claims, 'school_privacy_set', {
    p_code: code,
    p_fiduciary: fiduciary,
    p_recipient: recipient,
    p_basis: basis,
    p_reason: 'counsel answered',
    p_env: 'HOSTED',
  });

interface PrivacyRow {
  code: string;
  name: string;
  fiduciary: string;
  recipient: string;
  basis: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  importBlocked: boolean;
}

describe('the import gate (T2)', () => {
  it('a school with no decision is refused on HOSTED with the sentence the importer sees', async () => {
    expect(await refusal(pra.org)).toBe(SENTENCE);
  });

  it('a fiduciary without a recipient, or a recipient without a fiduciary, is still refused', async () => {
    await decide(fresh(owner), 'PRA', 'school', 'undecided');
    expect(await refusal(pra.org)).toBe(SENTENCE);
    await decide(fresh(owner), 'PRA', 'undecided', 'parent', BASIS);
    expect(await refusal(pra.org)).toBe(SENTENCE);
  });

  it('once both are decided the school may import', async () => {
    await decide(fresh(owner), 'PRA', 'school', 'school', BASIS);
    expect(await refusal(pra.org)).toBeNull();
  });

  it('on TEST, DEMO and UNSET databases the gate answers NULL', async () => {
    try {
      await db.query(`select admin.set_environment('TEST', true)`);
      expect(await refusal(prb.org)).toBeNull();
      await db.query(`select admin.set_environment('DEMO', true)`);
      expect(await refusal(prb.org)).toBeNull();
    } finally {
      await db.query(`select admin.set_environment('HOSTED', true)`);
    }
    expect(await refusal(prb.org)).toBe(SENTENCE);
    const unset = await freshDatabase();
    try {
      const s = await buildSchool(unset, 'PRU');
      expect((await unset.query<{ e: string }>(`select admin.environment() as e`)).rows[0].e).toBe('UNSET');
      expect(await refusal(s.org, unset)).toBeNull();
    } finally {
      await unset.close();
    }
  });

  it('the gate cannot be called from a browser or the service role', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'admin.privacy_import_refusal(uuid)', 'execute') as ok`,
        [role],
      );
      expect(rows[0].ok, role).toBe(false);
    }
  });
});

describe('recording a decision', () => {
  it('nobody but the owner with a fresh code records a decision', async () => {
    for (const who of [ops, safety, finance]) {
      await expect(decide(fresh(who), 'PRB', 'school', 'school')).rejects.toThrow(/not allowed/);
    }
    const child = await anonymousChild(db);
    await expect(decide({ sub: child, aal: 'aal2' }, 'PRB', 'school', 'school')).rejects.toThrow(/not allowed/);
    await expect(decide(aal2(owner), 'PRB', 'school', 'school')).rejects.toThrow(/confirm with your authenticator code first/);
  });

  it('a decision needs a basis and known values', async () => {
    await expect(decide(fresh(owner), 'PRB', 'the board', 'school')).rejects.toThrow(
      /the data fiduciary is school, qrie or undecided/,
    );
    await expect(decide(fresh(owner), 'PRB', 'school', 'everyone')).rejects.toThrow(
      /who is told is school, parent, school-and-parent or undecided/,
    );
    await expect(decide(fresh(owner), 'PRB', 'school', 'school', '  ')).rejects.toThrow(
      /say what the decision rests on, in a few words \(for example: counsel's letter of 2026-11-02\)/,
    );
    await expect(decide(fresh(owner), 'PRB', 'qrie', 'undecided', null)).rejects.toThrow(/say what the decision rests on/);
    await expect(decide(fresh(owner), 'NOPE', 'school', 'school')).rejects.toThrow(/there is no school with the code NOPE/);
  });

  it('the list shows every school, its decision and whether its import is blocked, to owner, ops and safety', async () => {
    for (const who of [owner, ops, safety]) {
      const rows = await rpc<PrivacyRow[]>(db, aal2(who), 'school_privacy_list', {});
      const a = rows.find((r) => r.code === 'PRA')!;
      const b = rows.find((r) => r.code === 'PRB')!;
      expect(a).toMatchObject({
        name: 'PRA Public School',
        fiduciary: 'school',
        recipient: 'school',
        basis: BASIS,
        decidedByName: 'Aarav',
        importBlocked: false,
      });
      expect(a.decidedAt).not.toBeNull();
      expect(b).toMatchObject({ fiduciary: 'undecided', recipient: 'undecided', basis: null, decidedAt: null, importBlocked: true });
      expect(rows.map((r) => r.code)).toEqual([...rows.map((r) => r.code)].sort());
    }
    await expect(rpc(db, aal2(finance), 'school_privacy_list', {})).rejects.toThrow(/not allowed/);
  });

  it('each decision is audited without its basis', async () => {
    const { rows } = await db.query<{ target_kind: string; target_id: string; details: unknown; reason: string }>(
      `select target_kind, target_id, details, reason from admin.audit_event where action = 'school-privacy-set' order by id`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ target_kind: 'school', target_id: 'PRA', reason: 'counsel answered' });
    expect(last.details).toEqual({ from: { fiduciary: 'undecided', recipient: 'parent' }, to: { fiduciary: 'school', recipient: 'school' } });
    for (const r of rows) expect(JSON.stringify(r)).not.toContain('counsel\'s letter');
  });
});
