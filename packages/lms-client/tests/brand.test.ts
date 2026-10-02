// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * THE SCHOOL'S LOGO (migration 0032). Written first.
 *
 * The admin sets it; everyone in the school reads it; nobody else does. Only
 * a PNG or a JPEG that begins and ends as one does, and small: a logo is
 * shown in every app and on every report card, so it is refused, not resized.
 */

// The smallest real PNG: one transparent pixel.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// A JPEG's start (FF D8 FF E0 …) and end (FF D9) markers around a plausible body.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]).toString('base64');

let db: PGlite;
let one: School;
let other: School;
let admin: LmsClient;
let teacher: LmsClient;
let riya: LmsClient;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'LOGO');
  other = await buildSchool(db, 'ELSE');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
});
afterAll(async () => {
  await db.close();
});

describe("the school's logo", () => {
  it('is set by the admin and read back, byte for byte, by everyone in the school', async () => {
    expect(await riya.schoolLogo()).toBeNull();
    await admin.setSchoolLogo('image/png', PNG);
    for (const who of [riya, teacher, admin]) {
      expect(await who.schoolLogo()).toMatchObject({ mime: 'image/png', base64: PNG });
    }
  });

  it('is not seen by another school', async () => {
    const elsewhere = createLmsClient(pgliteTransport(db, other.kid8a));
    expect(await elsewhere.schoolLogo()).toBeNull();
  });

  it('accepts a JPEG, and can be taken away', async () => {
    await admin.setSchoolLogo('image/jpeg', JPEG);
    expect((await riya.schoolLogo())?.mime).toBe('image/jpeg');
    await admin.setSchoolLogo(null, null);
    expect(await riya.schoolLogo()).toBeNull();
  });

  it('is refused when only its first bytes look like a picture', async () => {
    const pngStart = Buffer.concat([Buffer.from(PNG, 'base64').subarray(0, 8), Buffer.from('<script>alert(1)</script>')]);
    await expect(admin.setSchoolLogo('image/png', pngStart.toString('base64'))).rejects.toThrow(/not a PNG/);
    // Signature and IHDR chunk, then something that is not the rest of a PNG.
    const pngHead = Buffer.concat([Buffer.from(PNG, 'base64').subarray(0, 33), Buffer.alloc(40, 0x41)]);
    await expect(admin.setSchoolLogo('image/png', pngHead.toString('base64'))).rejects.toThrow(/not a PNG/);
    const jpegStart = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('not the rest of a picture')]);
    await expect(admin.setSchoolLogo('image/jpeg', jpegStart.toString('base64'))).rejects.toThrow(/not a JPEG/);
  });

  it('is refused unless it is a small PNG or JPEG', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    await expect(admin.setSchoolLogo('image/svg+xml', svg)).rejects.toThrow(/PNG or a JPEG/);
    await expect(admin.setSchoolLogo('image/png', svg)).rejects.toThrow(/not a PNG/);
    await expect(admin.setSchoolLogo('image/png', JPEG)).rejects.toThrow(/not a PNG/);
    await expect(admin.setSchoolLogo('image/jpeg', PNG)).rejects.toThrow(/not a JPEG/);
    await expect(admin.setSchoolLogo('image/png', 'not base64 at all!')).rejects.toThrow(/not a picture/);
    const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(300 * 1024)]).toString('base64');
    await expect(admin.setSchoolLogo('image/png', big)).rejects.toThrow(/256 KB/);
  });

  it('is shown on the sign-in screen by school code, before anyone signs in: name, colours and logo only', async () => {
    await admin.setSchoolLogo('image/png', PNG);
    await admin.setSchoolBrand({ primary: '#0e7490', accent: '#fb923c' });
    const asAnon = async (code: string) =>
      db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        return (await tx.query(`select * from lms.school_brand($1)`, [code])).rows;
      });
    expect(await asAnon('LOGO')).toEqual([
      { school_name: 'LOGO Public School', brand: { primary: '#0e7490', accent: '#fb923c' }, logo_mime: 'image/png', logo_base64: PNG },
    ]);
    expect(await asAnon('NOPE')).toEqual([]);
    expect(await asAnon("LOGO'; --")).toEqual([]);
  });

  it('is set by the admin only', async () => {
    await expect(teacher.setSchoolLogo('image/png', PNG)).rejects.toThrow(/only the school admin/);
    await expect(riya.setSchoolLogo('image/png', PNG)).rejects.toThrow(/only the school admin/);
  });
});
