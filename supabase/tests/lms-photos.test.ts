// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from './fixtures';
import { asUser, freshDatabase } from './harness';

/**
 * L3 of the LMS build, photo half: a photo of notebook work, marked by the
 * teacher (migration 0025).
 *
 * Photos live in a private bucket, `lms-work`, at
 *   <org id>/<assignment id>/<student id>/<file>
 * and the path is what every rule reads: a student may put a photo only in
 * their own folder, for published photo work in their own section; the
 * class's teacher and the school's admin may read it; nobody else can.
 * Written first and watched failing before 0025 existed.
 */

let db: PGlite;
let one: School;
let photoHw: string;
let mcqHw: string;
let draftHw: string;

const id = async (sql: string, params: unknown[] = []): Promise<string> =>
  (await db.query<{ id: string }>(sql, params)).rows[0].id;

async function assignment(types: string[], publish = true, section = one.s8a, subject = one.maths): Promise<string> {
  const hw = await id(
    `insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, answer_types)
     values ($1, $2, $3, $4, 'homework', 'Ex 3.2', now() + interval '2 days', $5) returning id`,
    [one.org, section, subject, one.teacherA, types],
  );
  if (publish) await db.query(`update lms.assignment set published_at = now() where id = $1`, [hw]);
  return hw;
}

const path = (hw: string, student: string, file = 'p1.jpg') => `${one.org}/${hw}/${student}/${file}`;

const upload = (user: string, name: string) =>
  asUser(db, user, (tx) =>
    tx.query(
      `insert into storage.objects (bucket_id, name, owner, metadata)
       values ('lms-work', $1, $2, '{"mimetype":"image/jpeg","size":120000}'::jsonb)`,
      [name, user],
    ),
  );

const canRead = (user: string, name: string) =>
  asUser(db, user, (tx) => tx.query(`select 1 from storage.objects where bucket_id = 'lms-work' and name = $1`, [name])).then(
    (r) => r.rows.length === 1,
  );

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'PHO');
  photoHw = await assignment(['photo']);
  mcqHw = await assignment(['mcq']);
  draftHw = await assignment(['photo'], false);
});
afterAll(async () => {
  await db.close();
});

describe('the lms-work bucket', () => {
  it('is private, and takes only images of up to 5 MB', async () => {
    const { rows } = await db.query(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'lms-work'`,
    );
    expect(rows).toEqual([
      { public: false, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] },
    ]);
  });
});

describe('uploading a photo', () => {
  it('works in your own folder, for photo work in your section', async () => {
    await upload(one.kid8a, path(photoHw, one.kid8a));
  });

  it("is refused in another student's folder", async () => {
    await expect(upload(one.kid8a, path(photoHw, one.kid8b, 'x.jpg'))).rejects.toThrow(/row-level security/);
  });

  it('is refused for work that takes no photos', async () => {
    await expect(upload(one.kid8a, path(mcqHw, one.kid8a))).rejects.toThrow(/row-level security/);
  });

  it('is refused for a draft', async () => {
    await expect(upload(one.kid8a, path(draftHw, one.kid8a))).rejects.toThrow(/row-level security/);
  });

  it("is refused for another section's work", async () => {
    await expect(upload(one.kid8b, path(photoHw, one.kid8b))).rejects.toThrow(/row-level security/);
  });

  it('is refused for a path that is not <org>/<assignment>/<you>/<file>', async () => {
    await expect(upload(one.kid8a, `${one.org}/not-a-uuid/${one.kid8a}/p.jpg`)).rejects.toThrow(/row-level security/);
    await expect(upload(one.kid8a, `p.jpg`)).rejects.toThrow(/row-level security/);
  });
});

describe('reading a photo', () => {
  const name = () => path(photoHw, one.kid8a);

  it('the student who took it', async () => {
    expect(await canRead(one.kid8a, name())).toBe(true);
  });

  it('the teacher of the class', async () => {
    expect(await canRead(one.teacherA, name())).toBe(true);
  });

  it("the school's admin", async () => {
    expect(await canRead(one.admin, name())).toBe(true);
  });

  it('not a teacher of another class', async () => {
    expect(await canRead(one.teacherB, name())).toBe(false);
  });

  it('not a classmate', async () => {
    const mate = await seat(db, one.org, 'student', 'PHO-103', 'Mate');
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id) values ($1, $2, $3, $4)`,
      [one.org, one.year, one.s8a, mate],
    );
    expect(await canRead(mate, name())).toBe(false);
  });
});

describe('handing the photos in', () => {
  const submit = (student: string, hw: string, paths: string[]) =>
    asUser(db, student, (tx) => tx.query<{ id: string }>(`select lms.submit_photos($1, $2) as id`, [hw, paths])).then(
      (r) => r.rows[0].id,
    );

  it('makes a photo submission from photos you uploaded', async () => {
    await upload(one.kid8a, path(photoHw, one.kid8a, 'p2.jpg'));
    const sub = await submit(one.kid8a, photoHw, [path(photoHw, one.kid8a), path(photoHw, one.kid8a, 'p2.jpg')]);
    const { rows } = await db.query<{ kind: string; n: number }>(
      `select s.kind, (select count(*)::int from lms.submission_photo p where p.submission_id = s.id) as n
         from lms.submission s where s.id = $1`,
      [sub],
    );
    expect(rows[0]).toEqual({ kind: 'photo', n: 2 });
  });

  it('accepts a photo whose uploader is recorded only in owner_id, as newer Storage does', async () => {
    const hw = await assignment(['photo']);
    const name = path(hw, one.kid8a, 'o.jpg');
    await db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('lms-work', $1, $2)`, [
      name,
      one.kid8a,
    ]);
    expect(await submit(one.kid8a, hw, [name])).toMatch(/[0-9a-f-]{36}/);
  });

  it('refuses a photo that was never uploaded', async () => {
    await expect(submit(one.kid8a, photoHw, [path(photoHw, one.kid8a, 'ghost.jpg')])).rejects.toThrow(/not uploaded/);
  });

  it("refuses somebody else's photo", async () => {
    await expect(submit(one.kid8b, photoHw, [path(photoHw, one.kid8a)])).rejects.toThrow(/not your homework|not uploaded/);
  });

  it('refuses no photos at all, and more than ten', async () => {
    await expect(submit(one.kid8a, photoHw, [])).rejects.toThrow(/1 to 10 photos/);
    const many = Array.from({ length: 11 }, (_, i) => path(photoHw, one.kid8a, `m${i}.jpg`));
    await expect(submit(one.kid8a, photoHw, many)).rejects.toThrow(/1 to 10 photos/);
  });

  it('is marked by the class teacher, like any submission', async () => {
    const second = await assignment(['photo']);
    await upload(one.kid8a, path(second, one.kid8a, 'q.jpg'));
    const sub = await submit(one.kid8a, second, [path(second, one.kid8a, 'q.jpg')]);
    await asUser(db, one.teacherA, (tx) => tx.query(`select lms.set_teacher_mark($1, 8, 10)`, [sub]));
    const { rows } = await db.query<{ s: number }>(`select teacher_score::float8 as s from lms.mark where submission_id = $1`, [sub]);
    expect(rows[0].s).toBe(8);
  });

  it('does not use up an MCQ attempt of the same assignment', async () => {
    const mixed = await assignment(['mcq', 'photo']);
    await upload(one.kid8a, path(mixed, one.kid8a, 'mix.jpg'));
    await submit(one.kid8a, mixed, [path(mixed, one.kid8a, 'mix.jpg')]);
    const r = await asUser(db, one.kid8a, (tx) => tx.query(`select * from lms.submit_mcq($1, '{}'::jsonb)`, [mixed]));
    expect(r.rows).toHaveLength(1);
  });
});
