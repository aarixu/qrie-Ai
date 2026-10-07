// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import {
  createLmsClient,
  pgliteTransport,
  type LmsClient,
  type NewNotice,
  type NoticeAttachmentMime,
} from '../src/index.ts';

/**
 * NOTICES (migration 0039). Written first.
 *
 * What the school's WhatsApp groups are used for today: a message to one
 * class, several at once, or — from the admin — the whole school, with one
 * file at most. Whoever it is for reads it in their app; opening it records
 * that they read it, and its writer and the admin see "read by N of M" and
 * who has not. The audience is whoever the notice is for now: a child who
 * joins the class is counted, a child who leaves or moves out is not.
 */

// The smallest real PNG: one transparent pixel.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// A JPEG's start (FF D8 FF E0 …) and end (FF D9) markers around a plausible body.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]).toString('base64');
// A small PDF: its header first, its end-of-file marker last.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);
const pdfOf = (bytes: number) =>
  Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes - 15, 0x20), Buffer.from('%%EOF\n')]);

let db: PGlite;
let one: School;
let other: School;
let admin: LmsClient;
let teacherA: LmsClient; // 8A Mathematics
let teacherB: LmsClient; // 8B Science
let teacherC: LmsClient; // 8A Mathematics too, and leaves
let riya: LmsClient; // 8A
let arjun: LmsClient; // 8B
let kabir: LmsClient; // 8A, and leaves
let kabirId: string;
let meera: LmsClient; // joins 8A after the first notice
let elsewhere: LmsClient; // the other school's teacher
let elsewhereAdmin: LmsClient;
let elsewhereKid: LmsClient;

let geometry: string; // Teacher A to 8A
let ptm: string; // the admin to 8A and 8B
let holiday: string; // the admin to the whole school
let circular: string; // the admin to 8B, with a PDF
let timetable: string; // Teacher A to 8A, with a PNG

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const ymd = (n: number) => inDays(n).slice(0, 10);
const find = async (who: LmsClient, id: string) => (await who.myNotices()).find((n) => n.noticeId === id);
const notice = (sectionIds: string[] | null, extra: Partial<NewNotice> = {}): NewNotice => ({
  title: 'A notice',
  body: 'Something to say.',
  sectionIds,
  ...extra,
});
const reads = async (id: string) =>
  (await db.query<{ n: number }>(`select count(*)::int n from lms.notice_read where notice_id = $1`, [id])).rows[0].n;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'NOT');
  other = await buildSchool(db, 'OTH');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  teacherB = createLmsClient(pgliteTransport(db, one.teacherB));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  arjun = createLmsClient(pgliteTransport(db, one.kid8b));
  elsewhere = createLmsClient(pgliteTransport(db, other.teacherA));
  elsewhereAdmin = createLmsClient(pgliteTransport(db, other.admin));
  elsewhereKid = createLmsClient(pgliteTransport(db, other.kid8a));

  kabirId = await seat(db, one.org, 'student', 'NOT-103', 'Kabir');
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '3')`,
    [one.org, one.year, one.s8a, kabirId],
  );
  kabir = createLmsClient(pgliteTransport(db, kabirId));
  const c = await seat(db, one.org, 'teacher', 'NOT-T3', 'Teacher C');
  await admin.setTeaching(one.s8a, one.maths, 'NOT-T3', true);
  teacherC = createLmsClient(pgliteTransport(db, c));
});
afterAll(async () => {
  await db.close();
});

describe('sending a notice', () => {
  it('goes from a teacher to a class they teach, and reaches that class only', async () => {
    geometry = await teacherA.sendNotice(
      notice([one.s8a], { title: '  Bring a geometry box  ', body: '  Tomorrow, for the chapter on constructions.  ' }),
    );
    const [seen] = await riya.myNotices();
    expect(seen).toEqual({
      noticeId: geometry,
      title: 'Bring a geometry box',
      body: 'Tomorrow, for the chapter on constructions.',
      wholeSchool: false,
      classNames: '8A',
      sentByName: 'Teacher A',
      sentAt: expect.any(String),
      attachmentName: null,
      attachmentMime: null,
      attachmentBytes: null,
      readAt: null,
      mine: false,
      canDelete: false,
      readers: null,
      audience: null,
    });
    expect((await kabir.myNotices()).map((n) => n.noticeId)).toEqual([geometry]);
    expect(await arjun.myNotices()).toEqual([]);
    expect(await teacherB.myNotices()).toEqual([]);
    expect(await elsewhereKid.myNotices()).toEqual([]);
    expect(await elsewhereAdmin.myNotices()).toEqual([]);
  });

  it('shows its writer and the admin how many of the class have read it, and nobody else', async () => {
    expect(await teacherA.myNotices()).toEqual([
      expect.objectContaining({ noticeId: geometry, mine: true, canDelete: true, readers: 0, audience: 2 }),
    ]);
    expect(await admin.myNotices()).toEqual([
      expect.objectContaining({ noticeId: geometry, mine: false, canDelete: true, readers: 0, audience: 2 }),
    ]);
    // Another teacher of the class reads it, but is not told who has.
    expect(await teacherC.myNotices()).toEqual([
      expect.objectContaining({ noticeId: geometry, mine: false, canDelete: false, readers: null, audience: null }),
    ]);
  });

  it('goes to several classes at once', async () => {
    ptm = await admin.sendNotice(
      notice([one.s8a, one.s8b, one.s8a], { title: 'PTM on Saturday', body: 'Parents of 8A and 8B, 10 am to 12.' }),
    );
    for (const who of [riya, arjun, kabir]) expect((await who.myNotices()).map((n) => n.noticeId)).toContain(ptm);
    expect(await find(riya, ptm)).toMatchObject({ classNames: '8A, 8B', sentByName: 'Admin', wholeSchool: false });
    // A teacher reads the notices for the classes they teach.
    expect((await teacherB.myNotices()).map((n) => n.noticeId)).toEqual([ptm]);
    expect(await find(admin, ptm)).toMatchObject({ mine: true, canDelete: true, readers: 0, audience: 3 });
    expect(await find(teacherA, ptm)).toMatchObject({ mine: false, canDelete: false, readers: null });
  });

  it('goes to the whole school from the admin only: every child and every teacher', async () => {
    holiday = await admin.sendNotice(notice(null, { title: 'School closed on Friday', body: 'For the local election.' }));
    for (const who of [riya, arjun, kabir, teacherA, teacherB, teacherC]) {
      expect(await find(who, holiday)).toMatchObject({ wholeSchool: true, classNames: null, readAt: null });
    }
    expect(await find(admin, holiday)).toMatchObject({ readers: 0, audience: 6 });
    await expect(teacherA.sendNotice(notice(null))).rejects.toThrow(/only the school admin can send a notice to the whole school/);
    await expect(teacherA.sendNotice(notice([]))).rejects.toThrow(/only the school admin can send a notice to the whole school/);
    expect(await elsewhereKid.myNotices()).toEqual([]);
    expect(await elsewhere.myNotices()).toEqual([]);
  });

  it('lists the newest first', async () => {
    expect((await riya.myNotices()).map((n) => n.noticeId)).toEqual([holiday, ptm, geometry]);
  });

  it('is refused for a class the teacher does not teach, to a student, and across schools — and nothing is sent', async () => {
    await expect(teacherA.sendNotice(notice([one.s8b]))).rejects.toThrow(/only to classes you teach/);
    await expect(teacherA.sendNotice(notice([one.s8a, one.s8b]))).rejects.toThrow(/only to classes you teach/);
    await expect(riya.sendNotice(notice([one.s8a]))).rejects.toThrow(/only a teacher or the school admin/);
    await expect(elsewhere.sendNotice(notice([one.s8a]))).rejects.toThrow(/not a class of this year in your school/);
    await expect(elsewhereAdmin.sendNotice(notice([one.s8a]))).rejects.toThrow(/not a class of this year in your school/);
    await expect(admin.sendNotice(notice([other.s8a]))).rejects.toThrow(/not a class of this year in your school/);
    expect(await riya.myNotices()).toHaveLength(3);
    expect(await arjun.myNotices()).toHaveLength(2);
    expect(await elsewhereKid.myNotices()).toEqual([]);
  });

  it('has a title of 1 to 120 characters and a message of 1 to 2000', async () => {
    await expect(teacherA.sendNotice(notice([one.s8a], { title: '   ' }))).rejects.toThrow(/title of 1 to 120 characters/);
    await expect(teacherA.sendNotice(notice([one.s8a], { title: '\n\t\u00a0\u200b\n' }))).rejects.toThrow(/title of 1 to 120 characters/);
    await expect(teacherA.sendNotice(notice([one.s8a], { body: '\n\r\n\t' }))).rejects.toThrow(/message of 1 to 2000 characters/);
    await expect(teacherA.sendNotice(notice([one.s8a], { title: 'x'.repeat(121) }))).rejects.toThrow(/title of 1 to 120 characters/);
    await expect(teacherA.sendNotice(notice([one.s8a], { body: '' }))).rejects.toThrow(/message of 1 to 2000 characters/);
    await expect(teacherA.sendNotice(notice([one.s8a], { body: 'y'.repeat(2001) }))).rejects.toThrow(/message of 1 to 2000 characters/);
    const longest = await teacherA.sendNotice(notice([one.s8a], { title: 'x'.repeat(120), body: 'y'.repeat(2000) }));
    expect(await find(riya, longest)).toMatchObject({ title: 'x'.repeat(120), body: 'y'.repeat(2000) });
    await teacherA.deleteNotice(longest);
  });
});

describe('an attachment', () => {
  const send = (mime: string, base64: string, name: string | undefined = 'file') =>
    admin.sendNotice(notice([one.s8b], { attachment: { name, mime: mime as NoticeAttachmentMime, base64 } }));

  it('is a PDF, a JPEG or a PNG, read back byte for byte by those the notice is for', async () => {
    circular = await admin.sendNotice(
      notice([one.s8b], {
        title: 'Fee circular',
        body: 'Read the attached circular.',
        attachment: { name: 'fees-2026.pdf', mime: 'application/pdf', base64: PDF.toString('base64') },
      }),
    );
    expect(await find(arjun, circular)).toMatchObject({
      attachmentName: 'fees-2026.pdf',
      attachmentMime: 'application/pdf',
      attachmentBytes: PDF.length,
    });
    expect(await arjun.noticeAttachment(circular)).toEqual({
      fileName: 'fees-2026.pdf',
      mime: 'application/pdf',
      base64: PDF.toString('base64'),
    });
    expect(await admin.noticeAttachment(circular)).toMatchObject({ mime: 'application/pdf' });

    timetable = await teacherA.sendNotice(
      notice([one.s8a], { title: 'New timetable', attachment: { name: 'timetable.png', mime: 'image/png', base64: PNG } }),
    );
    expect(await riya.noticeAttachment(timetable)).toEqual({ fileName: 'timetable.png', mime: 'image/png', base64: PNG });

    // No name given: one is made from its kind.
    const photo = await teacherA.sendNotice(notice([one.s8a], { attachment: { name: '', mime: 'image/jpeg', base64: JPEG } }));
    expect(await riya.noticeAttachment(photo)).toEqual({ fileName: 'attachment.jpg', mime: 'image/jpeg', base64: JPEG });
    await teacherA.deleteNotice(photo);

    expect(await riya.noticeAttachment(geometry)).toBeNull();
  });

  it('is given to nobody the notice is not for', async () => {
    await expect(riya.noticeAttachment(circular)).rejects.toThrow(/not for you/);
    await expect(teacherA.noticeAttachment(circular)).rejects.toThrow(/not for you/);
    await expect(elsewhereAdmin.noticeAttachment(circular)).rejects.toThrow(/not for you/);
    await expect(elsewhereKid.noticeAttachment(timetable)).rejects.toThrow(/not for you/);
  });

  it('is 512 KB at most', async () => {
    const edge = pdfOf(512 * 1024);
    const big = await send('application/pdf', edge.toString('base64'), 'big.pdf');
    expect((await find(arjun, big))?.attachmentBytes).toBe(512 * 1024);
    await admin.deleteNotice(big);
    await expect(send('application/pdf', pdfOf(512 * 1024 + 1).toString('base64'))).rejects.toThrow(/512 KB or smaller/);
  });

  it('is refused when only its first or last bytes look like the file it claims to be', async () => {
    await expect(send('application/pdf', Buffer.from('%PDF-1.4\n<script>alert(1)</script>').toString('base64'))).rejects.toThrow(
      /not a PDF/,
    );
    await expect(send('application/pdf', Buffer.from('<html><body>hello</body></html>\n%%EOF\n').toString('base64'))).rejects.toThrow(
      /not a PDF/,
    );
    // The end-of-file marker, but nowhere near the end.
    const early = Buffer.concat([Buffer.from('%PDF-1.4\n%%EOF\n'), Buffer.alloc(2000, 0x41)]);
    await expect(send('application/pdf', early.toString('base64'))).rejects.toThrow(/not a PDF/);
    const pngHead = Buffer.concat([Buffer.from(PNG, 'base64').subarray(0, 33), Buffer.alloc(40, 0x41)]);
    await expect(send('image/png', pngHead.toString('base64'))).rejects.toThrow(/not a PNG/);
    const jpegStart = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('not the rest of a picture')]);
    await expect(send('image/jpeg', jpegStart.toString('base64'))).rejects.toThrow(/not a JPEG/);
  });

  it('is refused unless it is a PDF, a JPEG or a PNG, named without slashes', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    await expect(send('image/svg+xml', svg)).rejects.toThrow(/a PDF, a JPEG or a PNG/);
    await expect(send('text/html', svg)).rejects.toThrow(/a PDF, a JPEG or a PNG/);
    await expect(send('application/pdf', PNG)).rejects.toThrow(/not a PDF/);
    await expect(send('image/png', PDF.toString('base64'))).rejects.toThrow(/not a PNG/);
    await expect(send('image/jpeg', PNG)).rejects.toThrow(/not a JPEG/);
    await expect(send('application/pdf', 'not base64 at all!')).rejects.toThrow(/could not be read/);
    await expect(send('application/pdf', PDF.toString('base64'), '../../etc/passwd')).rejects.toThrow(/file name/);
    await expect(send('application/pdf', PDF.toString('base64'), 'C:\\fees.pdf')).rejects.toThrow(/file name/);
    await expect(send('application/pdf', PDF.toString('base64'), `${'x'.repeat(97)}.pdf`)).rejects.toThrow(/file name/);
    expect((await arjun.myNotices()).map((n) => n.noticeId)).toEqual([circular, holiday, ptm]);
  });

  it('is saved under a name that ends as its own kind of file, with no hidden direction marks', async () => {
    const named = async (mime: string, base64: string, name: string) => {
      const id = await send(mime, base64, name);
      const fileName = (await arjun.noticeAttachment(id))?.fileName;
      await admin.deleteNotice(id);
      return fileName;
    };
    const pdf = PDF.toString('base64');
    expect(await named('application/pdf', pdf, 'fees.html')).toBe('fees.pdf');
    expect(await named('application/pdf', pdf, 'circular')).toBe('circular.pdf');
    expect(await named('application/pdf', pdf, 'term.1.notice.PDF')).toBe('term.1.notice.pdf');
    expect(await named('image/png', PNG, 'timetable.apk')).toBe('timetable.png');
    expect(await named('image/jpeg', JPEG, 'photo.jpeg')).toBe('photo.jpg');
    // "fees" + RIGHT-TO-LEFT OVERRIDE + "fdp.exe" shows on a phone as "feesexe.pdf".
    expect(await named('application/pdf', pdf, 'fees\u202efdp.exe')).toBe('feesfdp.pdf');
    expect(await named('application/pdf', pdf, '\u2066\u200f.pdf')).toBe('attachment.pdf');
  });
});

describe('read receipts', () => {
  it('record the first time someone opens a notice, once', async () => {
    await riya.readNotice(geometry);
    const first = (await find(riya, geometry))?.readAt;
    expect(first).toEqual(expect.any(String));
    await riya.readNotice(geometry);
    expect((await find(riya, geometry))?.readAt).toBe(first);
    expect(await reads(geometry)).toBe(1);
  });

  it('show the writer and the admin "read by N of M", and who has not read it', async () => {
    expect(await find(teacherA, geometry)).toMatchObject({ readers: 1, audience: 2 });
    const readers = await teacherA.noticeReaders(geometry);
    expect(readers).toEqual([
      { userId: one.kid8a, displayName: 'Riya', loginId: 'NOT-101', kind: 'student', className: '8A', rollNumber: '1', readAt: expect.any(String) },
      { userId: kabirId, displayName: 'Kabir', loginId: 'NOT-103', kind: 'student', className: '8A', rollNumber: '3', readAt: null },
    ]);
    expect(await admin.noticeReaders(geometry)).toEqual(readers);
  });

  it("show a writer taken off a class none of that class's children any more; the admin still sees them all", async () => {
    await admin.setTeaching(one.s8a, one.maths, 'NOT-T1', false);
    expect(await find(teacherA, geometry)).toMatchObject({ mine: true, readers: 0, audience: 0 });
    expect(await teacherA.noticeReaders(geometry)).toEqual([]);
    expect(await find(admin, geometry)).toMatchObject({ readers: 1, audience: 2 });
    expect(await admin.noticeReaders(geometry)).toHaveLength(2);
    await admin.setTeaching(one.s8a, one.maths, 'NOT-T1', true);
    expect(await find(teacherA, geometry)).toMatchObject({ readers: 1, audience: 2 });
  });

  it('count the teachers too on a notice to the whole school', async () => {
    await teacherB.readNotice(holiday);
    await arjun.readNotice(holiday);
    expect(await find(admin, holiday)).toMatchObject({ readers: 2, audience: 6 });
    const who = await admin.noticeReaders(holiday);
    expect(who.filter((r) => r.readAt).map((r) => r.displayName)).toEqual(['Arjun', 'Teacher B']);
    expect(who.filter((r) => !r.readAt).map((r) => r.displayName)).toEqual(['Riya', 'Kabir', 'Teacher A', 'Teacher C']);
    expect(who.find((r) => r.displayName === 'Teacher B')).toMatchObject({ kind: 'teacher', className: null, rollNumber: null });
  });

  it('are shown to nobody but the writer and the admin', async () => {
    for (const who of [teacherC, teacherB, riya, elsewhereAdmin, elsewhere]) {
      await expect(who.noticeReaders(geometry)).rejects.toThrow(/only whoever sent it, or the school admin/);
    }
    await expect(teacherA.noticeReaders(holiday)).rejects.toThrow(/only whoever sent it, or the school admin/);
  });

  it('are never recorded for someone the notice is not for', async () => {
    await expect(arjun.readNotice(geometry)).rejects.toThrow(/not for you/);
    await expect(elsewhereKid.readNotice(geometry)).rejects.toThrow(/not for you/);
    await expect(elsewhereAdmin.readNotice(holiday)).rejects.toThrow(/not for you/);
    expect(await reads(geometry)).toBe(1);
    expect(await reads(holiday)).toBe(2);
  });

  it('count whoever is in the audience now: a child who joins is counted, a child who leaves is not', async () => {
    await kabir.readNotice(geometry);
    expect(await find(teacherA, geometry)).toMatchObject({ readers: 2, audience: 2 });

    const meeraId = await seat(db, one.org, 'student', 'NOT-104', 'Meera');
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '4')`,
      [one.org, one.year, one.s8a, meeraId],
    );
    meera = createLmsClient(pgliteTransport(db, meeraId));
    expect(await find(meera, geometry)).toMatchObject({ readAt: null });
    expect(await find(teacherA, geometry)).toMatchObject({ readers: 2, audience: 3 });

    await admin.markLeft('NOT-103');
    expect(await find(teacherA, geometry)).toMatchObject({ readers: 1, audience: 2 });
    expect((await teacherA.noticeReaders(geometry)).map((r) => r.displayName)).toEqual(['Riya', 'Meera']);
    expect(await kabir.myNotices()).toEqual([]);
    await expect(kabir.readNotice(holiday)).rejects.toThrow(/not for you/);
    await expect(kabir.noticeAttachment(timetable)).rejects.toThrow(/not for you/);
  });

  it('follow a child moved to another class', async () => {
    await admin.moveStudent('NOT-101', one.s8b, '5');
    const seen = (await riya.myNotices()).map((n) => n.noticeId);
    expect(seen).not.toContain(geometry);
    expect(seen).toContain(circular);
    expect(await find(teacherA, geometry)).toMatchObject({ readers: 0, audience: 1 });
    await admin.moveStudent('NOT-101', one.s8a, '1');
    expect(await find(teacherA, geometry)).toMatchObject({ readers: 1, audience: 2 });
  });
});

describe('deleting a notice', () => {
  it('is for its writer and the admin only, and takes its reads with it', async () => {
    for (const who of [teacherB, teacherC, riya, elsewhereAdmin]) {
      await expect(who.deleteNotice(geometry)).rejects.toThrow(/only whoever sent it, or the school admin/);
    }
    await expect(teacherA.deleteNotice(ptm)).rejects.toThrow(/only whoever sent it, or the school admin/);
    await teacherA.deleteNotice(geometry);
    expect((await riya.myNotices()).map((n) => n.noticeId)).not.toContain(geometry);
    expect(await reads(geometry)).toBe(0);
    // A teacher's notice, deleted by the admin.
    await admin.deleteNotice(timetable);
    expect((await teacherA.myNotices()).map((n) => n.noticeId)).not.toContain(timetable);
  });

  it('stops for a teacher who has left: they send, read and delete nothing', async () => {
    const goodbye = await teacherC.sendNotice(notice([one.s8a], { title: 'Goodbye', body: 'It was lovely teaching you.' }));
    await admin.markLeft('NOT-T3');
    expect(await teacherC.myNotices()).toEqual([]);
    await expect(teacherC.deleteNotice(goodbye)).rejects.toThrow(/only whoever sent it, or the school admin/);
    await expect(teacherC.noticeReaders(goodbye)).rejects.toThrow(/only whoever sent it, or the school admin/);
    await expect(teacherC.readNotice(holiday)).rejects.toThrow(/not for you/);
    await expect(teacherC.sendNotice(notice([one.s8a]))).rejects.toThrow(/only a teacher or the school admin/);
    expect(await find(riya, goodbye)).toMatchObject({ sentByName: 'Teacher C' });
    // Riya, Arjun, Meera, Teacher A and Teacher B: the two who left are not counted.
    expect(await find(admin, holiday)).toMatchObject({ audience: 5 });
    await admin.deleteNotice(goodbye);
  });

  it('and sending are in the activity log', async () => {
    const seen = (await admin.auditLog()).map((e) => `${e.action} ${e.target} ${e.actorName}`);
    expect(seen).toContain('notice-sent Bring a geometry box Teacher A');
    expect(seen).toContain('notice-sent School closed on Friday Admin');
    expect(seen).toContain('notice-deleted Bring a geometry box Teacher A');
    expect(seen).toContain('notice-deleted Goodbye Admin');
  });
});

describe('the database', () => {
  it('keeps the notices and their checks away from browsers', async () => {
    const asAdmin = pgliteTransport(db, one.admin);
    await expect(asAdmin.rows('notice_audience', { p_notice: holiday })).rejects.toThrow(/permission denied/);
    await expect(asAdmin.value('may_see_notice', { p_notice: holiday })).rejects.toThrow(/permission denied/);
    await expect(asAdmin.value('may_manage_notice', { p_notice: holiday })).rejects.toThrow(/permission denied/);
    for (const table of ['notice', 'notice_section', 'notice_read']) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec('set local role authenticated');
          await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [one.admin]);
          return tx.query(`select * from lms.${table}`);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('a new school year', () => {
  it("leaves last year's notices with last year", async () => {
    await admin.startNewYear('2027-28', ymd(3), ymd(367));
    for (const who of [riya, arjun, meera, teacherA, teacherB, admin]) expect(await who.myNotices()).toEqual([]);
    await expect(riya.readNotice(holiday)).rejects.toThrow(/not for you/);
    await expect(admin.noticeReaders(holiday)).rejects.toThrow(/only whoever sent it, or the school admin/);
    await expect(teacherA.sendNotice(notice([one.s8a]))).rejects.toThrow(/not a class of this year in your school/);

    const s9a = (await admin.schoolSections()).find((s) => s.className === '9A')!;
    const welcome = await admin.sendNotice(notice([s9a.sectionId], { title: 'Welcome to Class 9' }));
    expect((await riya.myNotices()).map((n) => n.noticeId)).toEqual([welcome]);
    expect(await arjun.myNotices()).toEqual([]);
    // Riya and Meera moved up into 9A.
    expect(await find(admin, welcome)).toMatchObject({ classNames: '9A', readers: 0, audience: 2 });
  });
});
