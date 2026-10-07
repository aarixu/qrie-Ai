// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * HANDED IN ONCE, HOWEVER OFTEN THE PHONE SENDS IT (migration 0044). Written first.
 *
 * On patchy data a hand-in can reach the school while its answer never
 * reaches the phone, which then sends it again. Each hand-in carries a key
 * the phone made for it; the same key from the same child for the same work
 * is the same hand-in, answered as the first time — never a second attempt,
 * and never "no attempts left".
 */

let db: PGlite;
let one: School;
let teacher: LmsClient;
let riya: LmsClient;
let kabir: LmsClient;
let once: string; // one attempt allowed
let twice: string; // two attempts allowed
let test: string;
let photos: string;
let q1: string;
let q2: string;

const key = () => crypto.randomUUID();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const attempts = async (assignment: string, student: string, kind = 'mcq') =>
  Number(
    (
      await db.query<{ n: number }>(
        `select count(*)::int n from lms.submission where assignment_id = $1 and student_user_id = $2 and kind = $3`,
        [assignment, student, kind],
      )
    ).rows[0].n,
  );

async function mcqWork(kind: 'homework' | 'test', attemptsAllowed = 1): Promise<string> {
  const id = await teacher.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind,
    title: `${kind} ${attemptsAllowed}`,
    dueAt: inDays(2),
    answerTypes: ['mcq'],
    attemptsAllowed,
    ...(kind === 'test' ? { timeLimitMinutes: 30 } : {}),
  });
  await teacher.setAssignmentItems(id, [q1, q2]);
  await teacher.publishAssignment(id);
  return id;
}

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'ONC');
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  const kabirId = await seat(db, one.org, 'student', 'ONC-109', 'Kabir');
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '9')`,
    [one.org, one.year, one.s8a, kabirId],
  );
  kabir = createLmsClient(pgliteTransport(db, kabirId));
  q1 = await teacher.writeItem({ grade: 8, subject: 'Mathematics', stem: '1 + 1?', options: ['1', '2', '3'], correctIndex: 1 });
  q2 = await teacher.writeItem({ grade: 8, subject: 'Mathematics', stem: '2 + 2?', options: ['4', '5', '6'], correctIndex: 0 });
  once = await mcqWork('homework', 1);
  twice = await mcqWork('homework', 2);
  test = await mcqWork('test', 1);
  photos = await teacher.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'homework',
    title: 'Notebook page',
    dueAt: inDays(2),
    answerTypes: ['photo'],
  });
  await teacher.publishAssignment(photos);
});
afterAll(async () => {
  await db.close();
});

describe('multiple-choice work sent twice with one key', () => {
  it('is one hand-in, answered the same both times', async () => {
    const k = key();
    const first = await riya.submitMcq(once, { [q1]: 1, [q2]: 2 }, k);
    expect(first).toMatchObject({ correct: 1, total: 2 });
    expect(await riya.submitMcq(once, { [q1]: 1, [q2]: 2 }, k)).toEqual(first);
    expect(await attempts(once, one.kid8a)).toBe(1);
  });

  it('keeps the first hand-in’s answers even if the second sends different ones', async () => {
    const k = key();
    const first = await kabir.submitMcq(once, { [q1]: 1, [q2]: 0 }, k);
    expect(await kabir.submitMcq(once, { [q1]: 0 }, k)).toEqual(first);
    expect(first).toMatchObject({ correct: 2, total: 2 });
  });

  it('is a new attempt with a new key, where attempts are left', async () => {
    const a = await riya.submitMcq(twice, { [q1]: 0 }, key());
    const b = await riya.submitMcq(twice, { [q1]: 1 }, key());
    expect(b.submissionId).not.toBe(a.submissionId);
    expect(await attempts(twice, one.kid8a)).toBe(2);
    await expect(riya.submitMcq(twice, { [q1]: 1 }, key())).rejects.toThrow(/no attempts left/);
  });

  it("keeps a test's score from the child, the second time too", async () => {
    await riya.startTest(test);
    const k = key();
    const first = await riya.submitMcq(test, { [q1]: 1 }, k);
    expect(first).toMatchObject({ correct: null, total: null });
    expect(await riya.submitMcq(test, { [q1]: 1 }, k)).toEqual(first);
    expect(await attempts(test, one.kid8a)).toBe(1);
  });

  it("is never another child's hand-in, nor another piece of work's", async () => {
    const k = key();
    const mine = await riya.submitMcq(await mcqWork('homework', 1), { [q1]: 1 }, k);
    // The same key from another child is their own first hand-in, not Riya's.
    const fresh = await mcqWork('homework', 1);
    const theirs = await kabir.submitMcq(fresh, { [q1]: 1 }, k);
    expect(theirs.submissionId).not.toBe(mine.submissionId);
    // The same key from Riya on other work is refused, not taken as that work's hand-in.
    await expect(riya.submitMcq(fresh, { [q1]: 1 }, k)).rejects.toThrow(/that hand-in was for other work/);
    expect(await attempts(fresh, one.kid8a)).toBe(0);
  });

  it('still hands in without a key, as before', async () => {
    const fresh = await mcqWork('homework', 1);
    expect(await riya.submitMcq(fresh, { [q1]: 1 })).toMatchObject({ correct: 1, total: 2 });
  });
});

describe('photos sent twice with one key', () => {
  it('are one hand-in', async () => {
    const name = `${one.org}/${photos}/${one.kid8a}/p1.jpg`;
    await asUser(db, one.kid8a, (tx) =>
      tx.query(
        `insert into storage.objects (bucket_id, name, owner, metadata)
         values ('lms-work', $1, $2, '{"mimetype":"image/jpeg","size":120000}'::jsonb)`,
        [name, one.kid8a],
      ),
    );
    const k = key();
    const first = await riya.submitPhotos(photos, [name], k);
    expect(await riya.submitPhotos(photos, [name], k)).toBe(first);
    expect(await attempts(photos, one.kid8a, 'photo')).toBe(1);
    await expect(riya.submitPhotos(once, [name], k)).rejects.toThrow(/that hand-in was for other work/);
  });
});
