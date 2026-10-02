// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * PHOTOS OF PEOPLE, AND THE SCHOOL'S TWO COLOURS (migration 0033). Written first.
 *
 * A photo is the school's to set — the admin's, never a child's or a
 * teacher's — and is seen only by those who may see the person: a student's
 * by the student, their teachers and the admin; a teacher's by their school.
 * Only a small JPEG (the portal shrinks every picture to one), refused
 * otherwise.
 */

const jpeg = (body = 200) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(body, 7), Buffer.from([0xff, 0xd9])]).toString('base64');

let db: PGlite;
let one: School;
let other: School;
let admin: LmsClient;
let teacherA: LmsClient;
let teacherB: LmsClient;
let riya: LmsClient;
let arjun: LmsClient;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'PIC');
  other = await buildSchool(db, 'OTH');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  teacherB = createLmsClient(pgliteTransport(db, one.teacherB));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  arjun = createLmsClient(pgliteTransport(db, one.kid8b));
});
afterAll(async () => {
  await db.close();
});

describe('photos of people', () => {
  it('are set by the admin, by school ID, and read back by those who may see the person', async () => {
    const riyaPhoto = jpeg();
    await admin.setAccountPhoto('PIC-101', riyaPhoto);
    await admin.setAccountPhoto('PIC-T1', jpeg(300));
    const seenBy = async (c: LmsClient) =>
      (await c.accountPhotos([one.kid8a, one.teacherA])).map((p) => p.userId).sort();
    // Riya sees herself and her school's teacher; her teacher and the admin see both.
    expect(await seenBy(riya)).toEqual([one.kid8a, one.teacherA].sort());
    expect(await seenBy(teacherA)).toEqual([one.kid8a, one.teacherA].sort());
    expect(await seenBy(admin)).toEqual([one.kid8a, one.teacherA].sort());
    expect((await riya.accountPhotos([one.kid8a]))[0]).toMatchObject({ userId: one.kid8a, base64: riyaPhoto });
  });

  it("are not seen by another child, a teacher who does not teach the child, or another school", async () => {
    expect((await arjun.accountPhotos([one.kid8a])).map((p) => p.userId)).toEqual([]);
    expect((await teacherB.accountPhotos([one.kid8a])).map((p) => p.userId)).toEqual([]);
    const elsewhere = createLmsClient(pgliteTransport(db, other.admin));
    expect(await elsewhere.accountPhotos([one.kid8a, one.teacherA])).toEqual([]);
  });

  it('are set by the admin only, for people in their own school', async () => {
    await expect(teacherA.setAccountPhoto('PIC-101', jpeg())).rejects.toThrow(/only the school admin/);
    await expect(riya.setAccountPhoto('PIC-101', jpeg())).rejects.toThrow(/only the school admin/);
    const elsewhere = createLmsClient(pgliteTransport(db, other.admin));
    await expect(elsewhere.setAccountPhoto('PIC-101', jpeg())).rejects.toThrow(/no one in your school/);
  });

  it('are only small JPEGs', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await expect(admin.setAccountPhoto('PIC-102', png)).rejects.toThrow(/not a JPEG/);
    const headOnly = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('rest')]).toString('base64');
    await expect(admin.setAccountPhoto('PIC-102', headOnly)).rejects.toThrow(/not a JPEG/);
    await expect(admin.setAccountPhoto('PIC-102', jpeg(70 * 1024))).rejects.toThrow(/64 KB/);
    await expect(admin.setAccountPhoto('PIC-102', '%%%')).rejects.toThrow(/not a picture/);
  });

  it('can be taken away', async () => {
    await admin.setAccountPhoto('PIC-101', null);
    expect(await admin.accountPhotos([one.kid8a])).toEqual([]);
  });

  it('are asked for a page at a time', async () => {
    const many = Array.from({ length: 301 }, () => crypto.randomUUID());
    await expect(admin.accountPhotos(many)).rejects.toThrow(/at most 300/);
  });
});

describe("the school's two colours", () => {
  it('keep a primary and an accent colour, each written #rrggbb', async () => {
    await admin.setSchoolBrand({ primary: '#0E7490', accent: '#f59e0b' });
    expect((await riya.me())?.brand).toEqual({ primary: '#0e7490', accent: '#f59e0b' });
    await expect(admin.setSchoolBrand({ primary: '#0e7490', accent: 'orange' })).rejects.toThrow(/#rrggbb/);
    await admin.setSchoolBrand({ primary: '#123456' });
    expect((await riya.me())?.brand).toEqual({ primary: '#123456' });
  });
});
