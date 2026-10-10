// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { setLicence } from '../../../supabase/tests/admin-school-fixtures.ts';
import { rpc } from '../../../supabase/tests/billing-fixtures.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { addParentForAdmin, ImportRefused, importForAdmin } from '../src/import.ts';

/**
 * WAVE 2 TOGETHER, THE SCHOOL ADMIN'S PATH. Written with the merge.
 *
 * Plan 4's school-admin import code (here the demo server's, which asks
 * lms.import_refusal as lms-admin does) meets plan 5's privacy gate (0066) on
 * a HOSTED database, where the gate answers (plan 5's ruling R13): an
 * undecided school is refused with the privacy sentence, a suspended one with
 * the licence sentence, and nothing is made.
 */

const PRIVACY =
  "Qrie has not yet recorded who is responsible for this school's children's data and who is told if a child may be at risk. " +
  'The owner records both on the Privacy page; until then nobody can be added to this school.';
const LAPSED =
  "This school's licence has ended and its grace period is over, so no new people can be added until it is renewed.";
const SHEET = 'grade,section,roll,name\n8,A,5,Asha Rao\n';

let db: PGlite;
let owner: Staff;
let undecided: School;
let suspended: School;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db, 'HOSTED');
  owner = await makeStaff(db, 'owner', 'Aarav');
  undecided = await buildSchool(db, 'WDU');
  suspended = await buildSchool(db, 'WDS');
  await setLicence(db, 'WDS', 100, -20);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const people = async (org: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from lms.account where org_id = $1`, [org])).rows[0].n;

describe("the school admin's import and Add a parent on HOSTED", () => {
  it('an undecided school is refused with the privacy sentence, and nobody is added', async () => {
    const before = await people(undecided.org);
    for (const attempt of [
      importForAdmin(db, undecided.admin, { students: SHEET }),
      importForAdmin(db, undecided.admin, { students: SHEET, commit: true, acceptWarnings: true }),
      addParentForAdmin(db, undecided.admin, { studentLoginId: 'WDU-101', displayName: 'Sunita Sharma' }),
    ]) {
      const refused = await attempt.catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(ImportRefused);
      expect(refused).toMatchObject({ status: 409, message: PRIVACY });
    }
    expect(await people(undecided.org)).toBe(before);
  });

  it('a suspended school is refused with the licence sentence even once its privacy is decided', async () => {
    await rpc(db, fresh(owner), 'school_privacy_set', {
      p_code: 'WDS',
      p_fiduciary: 'school',
      p_recipient: 'school',
      p_basis: "counsel's letter of 2026-11-02",
      p_reason: 'counsel answered',
      p_env: 'HOSTED',
    });
    const before = await people(suspended.org);
    const refused = await importForAdmin(db, suspended.admin, { students: SHEET }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 409, message: LAPSED });
    expect(await people(suspended.org)).toBe(before);
  });
});
