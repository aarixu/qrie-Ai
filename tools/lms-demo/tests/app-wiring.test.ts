// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLicence } from '../../../supabase/tests/admin-school-fixtures.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { openDemoDatabase } from '../src/database.ts';
import { ImportRefused, importForAdmin } from '../src/import.ts';

/**
 * THE DEMO SERVER OBEYS QRIE CONTROL (plan 4). Written first.
 *
 * The demo school's admin import asks lms.import_refusal (0063) before it
 * reads anything.
 */

// The sentence of migration 0063 (admin.import_refusal).
const LAPSED =
  "This school's licence has ended and its grace period is over, so no new people can be added until it is renewed.";
const SHEET = 'grade,section,roll,name\n8,A,5,Asha Rao\n';

let db: PGlite;
let school: School;

beforeAll(async () => {
  db = await openDemoDatabase();
  school = await buildSchool(db, 'DSU');
  await setLicence(db, 'DSU', 100, -20);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe('the demo import', () => {
  it('the demo admin of a suspended school is refused before anything is read', async () => {
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from lms.account where org_id = $1`, [school.org]))
      .rows[0].n;
    const refused = await importForAdmin(db, school.admin, { students: SHEET }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ImportRefused);
    expect(refused).toMatchObject({ status: 409, message: LAPSED });
    const commit = await importForAdmin(db, school.admin, { students: SHEET, commit: true, acceptWarnings: true }).catch(
      (e: unknown) => e,
    );
    expect(commit).toMatchObject({ status: 409, message: LAPSED });
    const after = (await db.query<{ n: number }>(`select count(*)::int as n from lms.account where org_id = $1`, [school.org]))
      .rows[0].n;
    expect(after).toBe(before);
  });
});
