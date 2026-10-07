// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOutcomes } from '../../lms-brain/src/index.ts';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * LIKELY MISCONCEPTIONS IN A CLASS, AND PRACTICE FOR JUST THOSE CHILDREN
 * (migration 0040). Written first.
 *
 * Each wrong option of a library question was written to catch one mistake.
 * A class's page lists the mistakes the most of its children show now — on
 * the latest occasion each child met a question that can catch it, they
 * chose it, and they have chosen it on two questions or in two hand-ins
 * (0063: one wrong answer is a slip) — with who they are and the chapter.
 * Next to each, the teacher
 * sends practice on that chapter to those children only (adjusting the list
 * first): only they see it, only they can hand it in, and only they count in
 * its hand-in numbers.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const PQ = 'mixes up p and q';
const EVERY = 'thinks every fraction is rational';
const ZERO = 'forgets that q cannot be zero';
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const ymd = (n: number) => inDays(n).slice(0, 10);

let db: PGlite;
let one: School;
let other: School;
let admin: LmsClient;
let teacherA: LmsClient; // 8A Mathematics
let teacherB: LmsClient; // 8B Science
let riya: LmsClient; // 8A, roll 1
let arjun: LmsClient; // 8B
let elsewhereAdmin: LmsClient;
const kid: Record<string, string> = {};
const as: Record<string, LmsClient> = {};
const q: Record<string, string> = {};
let homework: string;
let practice: string;

async function item(ref: string, outcome: string, labels: string[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ($1, $2, 8, 'Mathematics', 'mcq', $1, '["right","wrong one","wrong two"]'::jsonb, 0, $3::jsonb) returning id`,
    [ref, [outcome], JSON.stringify(['', ...labels])],
  );
  return rows[0].id;
}

/** How many rows of lms.assignment `userId` reads straight from the table, as a browser would. */
async function rowsSeen(userId: string, assignmentId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    return (await tx.query(`select id from lms.assignment where id = $1`, [assignmentId])).rows.length;
  });
}

const names = (list: { displayName: string }[]) => list.map((c) => c.displayName);

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'LMC');
  other = await buildSchool(db, 'OTX');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  teacherB = createLmsClient(pgliteTransport(db, one.teacherB));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  arjun = createLmsClient(pgliteTransport(db, one.kid8b));
  elsewhereAdmin = createLmsClient(pgliteTransport(db, other.admin));
  kid.Riya = one.kid8a;
  as.Riya = riya;
  for (const [roll, name] of [['3', 'Kabir'], ['4', 'Meera'], ['5', 'Dev'], ['6', 'Isha'], ['7', 'Tara']]) {
    kid[name] = await seat(db, one.org, 'student', `LMC-10${roll}`, name);
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, $5)`,
      [one.org, one.year, one.s8a, kid[name], roll],
    );
    as[name] = createLmsClient(pgliteTransport(db, kid[name]));
  }

  // In the order written, which is not the order practice chooses them in.
  q.seen = await item('probe-lmc-seen', DEFINE, [PQ, ZERO]); // on closed work of the class: after those never set
  q.a = await item('probe-lmc-a', DEFINE, [PQ, EVERY]);
  q.b = await item('probe-lmc-b', CLOSURE, [PQ, EVERY]);
  q.zero = await item('probe-lmc-zero', DEFINE, [ZERO, '']);
  q.plain = await item('probe-lmc-plain', CLOSURE, ['', '']); // catches nothing: after those that catch PQ
  q.pq1 = await item('probe-lmc-pq1', DEFINE, [PQ, '']);
  q.pq2 = await item('probe-lmc-pq2', CLOSURE, [PQ, '']);
  q.test = await item('probe-lmc-test', DEFINE, [PQ, '']); // on a test: never practice
  q.unapproved = await item('probe-lmc-unapproved', CLOSURE, [PQ, '']); // never set at all
  for (const [name, id] of Object.entries(q)) if (name !== 'unapproved') await teacherA.approveItem(id);

  const old = await teacherA.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title: 'Old homework',
    dueAt: inDays(1), answerTypes: ['mcq'],
  });
  await teacherA.setAssignmentItems(old, [q.seen]);
  await teacherA.publishAssignment(old);
  // The first showing of the mistake each of them shows again below (0063: two or more).
  for (const name of ['Riya', 'Isha', 'Tara']) await as[name].submitMcq(old, { [q.seen]: 1 });
  await as.Kabir.submitMcq(old, { [q.seen]: 2 });
  await db.query(`update lms.assignment set due_at = now() - interval '3 days' where id = $1`, [old]);
  homework = await teacherA.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title: 'Rational numbers 1',
    dueAt: inDays(1), answerTypes: ['mcq'],
  });
  await teacherA.setAssignmentItems(homework, [q.a, q.b, q.zero]);
  await teacherA.publishAssignment(homework);
  const test = await teacherA.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'test', title: 'Unit test',
    dueAt: inDays(1), timeLimitMinutes: 10, answerTypes: ['mcq'],
  });
  await teacherA.setAssignmentItems(test, [q.test]);
  await teacherA.publishAssignment(test);
  // Over, and still never practice.
  await db.query(`update lms.assignment set due_at = now() - interval '2 days' where id = $1`, [test]);

  await as.Riya.submitMcq(homework, { [q.a]: 1, [q.b]: 0, [q.zero]: 0 });
  await as.Kabir.submitMcq(homework, { [q.a]: 1, [q.b]: 1, [q.zero]: 1 });
  await as.Meera.submitMcq(homework, { [q.a]: 2, [q.b]: 2, [q.zero]: 0 });
  await as.Dev.submitMcq(homework, { [q.a]: 0, [q.b]: 0, [q.zero]: 0 });
  await as.Isha.submitMcq(homework, { [q.a]: 1 });
  await as.Tara.submitMcq(homework, { [q.a]: 1 });
});
afterAll(async () => {
  await db.close();
});

describe('likely misconceptions in a class', () => {
  it('lists the mistakes the most children show, each with who and the chapter, most children first', async () => {
    const list = await teacherA.classLikelyMisconceptions(one.s8a, one.maths);
    expect(list.map((m) => [m.label, m.chapter, m.students])).toEqual([
      [PQ, 'rational-numbers', 4],
      [ZERO, 'rational-numbers', 1],
      [EVERY, 'rational-numbers', 1],
    ]);
    // By roll number.
    expect(list[0].children).toEqual([
      { studentUserId: kid.Riya, displayName: 'Riya', rollNumber: '1' },
      { studentUserId: kid.Kabir, displayName: 'Kabir', rollNumber: '3' },
      { studentUserId: kid.Isha, displayName: 'Isha', rollNumber: '6' },
      { studentUserId: kid.Tara, displayName: 'Tara', rollNumber: '7' },
    ]);
    // Approved, on the chapter, on no open work and no test of the class: plain, pq1, pq2 and seen.
    expect(list[0].questions).toBe(4);
    expect(list.flatMap((m) => names(m.children))).not.toContain('Dev');
  });

  it('leaves out a child who has left the school, or moved to another section', async () => {
    await admin.markLeft('LMC-106');
    await admin.moveStudent('LMC-107', one.s8b, '9');
    const list = await teacherA.classLikelyMisconceptions(one.s8a, one.maths);
    expect(names(list[0].children)).toEqual(['Riya', 'Kabir']);
    expect(list[0].students).toBe(2);
  });

  it("is for a teacher of the class and the school's admin, and nobody else", async () => {
    expect((await admin.classLikelyMisconceptions(one.s8a, one.maths)).map((m) => m.students)).toEqual([2, 1, 1]);
    await expect(teacherB.classLikelyMisconceptions(one.s8a, one.maths)).rejects.toThrow(/not your class/);
    await expect(riya.classLikelyMisconceptions(one.s8a, one.maths)).rejects.toThrow(/not your class/);
    await expect(elsewhereAdmin.classLikelyMisconceptions(one.s8a, one.maths)).rejects.toThrow(/not your class/);
    // A section of the school, with a subject of another school, is no class.
    await expect(admin.classLikelyMisconceptions(one.s8a, other.maths)).rejects.toThrow(/not your class/);
  });
});

describe('practice for just those children', () => {
  it('sets practice on the chapter for them alone, choosing questions that catch the mistake first', async () => {
    practice = await teacherA.sendPractice({
      sectionId: one.s8a, subjectId: one.maths, chapter: 'rational-numbers', misconception: PQ,
      studentUserIds: [kid.Riya, kid.Kabir], dueAt: inDays(2), questions: 2,
    });
    const set = await teacherA.assignmentItems(practice);
    expect(set.map((x) => x.itemId)).toEqual([q.pq1, q.pq2]);
    const work = await teacherA.classAssignments(one.s8a, one.maths);
    expect(work.find((a) => a.id === practice)).toMatchObject({
      title: 'Practice: Rational numbers', kind: 'homework', published: true, targeted: true, students: 2, submitted: 0,
    });
    // Work for the whole class is as it was.
    expect(work.find((a) => a.id === homework)).toMatchObject({ targeted: false, students: 4, submitted: 4 });
    expect(await teacherA.assignmentOverview(practice)).toMatchObject({ targeted: true, students: 2 });
  });

  it('reaches only those children: in their Work tab, its questions and the table itself', async () => {
    const titles = async (c: LmsClient) => (await c.myAssignments()).map((a) => a.id);
    expect(await titles(riya)).toContain(practice);
    expect(await titles(as.Kabir)).toContain(practice);
    expect(await titles(as.Meera)).not.toContain(practice);
    expect(await titles(as.Dev)).not.toContain(practice);
    expect(await titles(arjun)).not.toContain(practice);
    expect(await titles(as.Meera)).toContain(homework);
    expect(await riya.assignmentQuestions(practice)).toHaveLength(2);
    expect(await as.Meera.assignmentQuestions(practice)).toEqual([]);
    expect(await rowsSeen(kid.Riya, practice)).toBe(1);
    expect(await rowsSeen(kid.Meera, practice)).toBe(0);
    expect(await rowsSeen(one.teacherA, practice)).toBe(1);
  });

  it('takes a hand-in, a mark or a comment only for those children', async () => {
    await expect(as.Meera.submitMcq(practice, {})).rejects.toThrow(/not set for/);
    await expect(teacherA.setWorkStatus(practice, [kid.Meera], 'checked')).rejects.toThrow(/not set for/);
    await expect(teacherA.setWorkComment(practice, kid.Meera, 'Well done')).rejects.toThrow(/not set for/);
    const r = await riya.submitMcq(practice, { [q.pq1]: 0, [q.pq2]: 0 });
    expect(r).toMatchObject({ correct: 2, total: 2 });
    await teacherA.setWorkComment(practice, kid.Riya, 'Much better.');
    expect(await riya.myWorkComment(practice)).toMatchObject({ text: 'Much better.' });
  });

  it('counts only those children in its results and hand-in numbers', async () => {
    const results = await teacherA.assignmentResults(practice);
    expect(results.map((r) => [r.displayName, r.submitted])).toEqual([
      ['Riya', true],
      ['Kabir', false],
    ]);
    expect((await teacherA.classAssignments(one.s8a, one.maths)).find((a) => a.id === practice)).toMatchObject({
      students: 2,
      submitted: 1,
    });
    await db.query(`update lms.assignment set due_at = now() - interval '1 hour' where id = $1`, [practice]);
    const trend = await teacherA.classTrend(one.s8a, one.maths);
    expect(trend.find((t) => t.assignmentId === practice)).toMatchObject({ students: 2, handedIn: 1 });
    expect((await teacherA.studentTimeline(kid.Meera)).map((t) => t.assignmentId)).not.toContain(practice);
    expect((await teacherA.studentTimeline(kid.Kabir)).find((t) => t.assignmentId === practice)).toMatchObject({
      handedIn: false,
    });
    const workDue = async (id: string) =>
      (await admin.studentSubjects(id)).find((s) => s.subjectName === 'Mathematics')?.workDue;
    // The old homework and the test, for everyone; the practice, for Riya.
    expect(await workDue(kid.Riya)).toBe(3);
    expect(await workDue(kid.Meera)).toBe(2);
    await db.query(`update lms.assignment set due_at = now() + interval '2 days' where id = $1`, [practice]);
  });

  it('drops a child from the list once they meet the mistake again and get it right', async () => {
    const list = await teacherA.classLikelyMisconceptions(one.s8a, one.maths);
    const pq = list.find((m) => m.label === PQ)!;
    expect(names(pq.children)).toEqual(['Kabir']);
    // pq1 and pq2 are on open practice now; plain and seen are free.
    expect(pq.questions).toBe(2);
  });

  it('refuses anyone but a teacher of the class or the admin, and any child not in the class', async () => {
    const send = (c: LmsClient, students: string[], over: Partial<Parameters<LmsClient['sendPractice']>[0]> = {}) =>
      c.sendPractice({
        sectionId: one.s8a, subjectId: one.maths, chapter: 'rational-numbers', studentUserIds: students,
        dueAt: inDays(2), ...over,
      });
    await expect(send(teacherB, [kid.Kabir])).rejects.toThrow(/not your class/);
    await expect(send(riya, [kid.Riya])).rejects.toThrow(/not your class/);
    await expect(send(elsewhereAdmin, [kid.Kabir])).rejects.toThrow(/not your class/);
    await expect(send(teacherA, [kid.Kabir, one.kid8b])).rejects.toThrow(/not in this class/);
    await expect(send(teacherA, [kid.Isha])).rejects.toThrow(/not in this class/);
    await expect(send(teacherA, [kid.Tara])).rejects.toThrow(/not in this class/);
    await expect(send(teacherA, [])).rejects.toThrow(/at least one child/);
    await expect(send(teacherA, [kid.Kabir], { dueAt: inDays(-1) })).rejects.toThrow(/still to come/);
    await expect(send(teacherA, [kid.Kabir], { questions: 21 })).rejects.toThrow(/1 to 20 questions/);
    await expect(send(teacherA, [kid.Kabir], { chapter: 'photosynthesis' })).rejects.toThrow(/not a chapter/);
    const { rows } = await db.query<{ chapter: string }>(
      `select chapter from lms.outcome where grade = 8 and subject = 'Mathematics' and chapter <> 'rational-numbers' limit 1`,
    );
    await expect(send(teacherA, [kid.Kabir], { chapter: rows[0].chapter })).rejects.toThrow(/approve some/);
    // Nothing was set by any of it.
    expect((await teacherA.classAssignments(one.s8a, one.maths)).filter((a) => a.targeted)).toHaveLength(1);
  });

  it('lets the admin send it too, and logs every send', async () => {
    const id = await admin.sendPractice({
      sectionId: one.s8a, subjectId: one.maths, chapter: 'rational-numbers', misconception: EVERY,
      studentUserIds: [kid.Meera], dueAt: inDays(3), title: 'Fractions again', questions: 5,
    });
    // Neither catches it; the one never set to the class comes first.
    expect((await teacherA.assignmentItems(id)).map((x) => x.itemId)).toEqual([q.plain, q.seen]);
    expect((await as.Meera.myAssignments()).find((a) => a.id === id)).toMatchObject({ title: 'Fractions again', questions: 2 });
    expect((await riya.myAssignments()).map((a) => a.id)).not.toContain(id);
    const log = (await admin.auditLog()).filter((e) => e.action === 'practice-sent');
    expect(log.map((e) => [e.actorName, e.target])).toEqual([
      ['Admin', '8A Mathematics rational-numbers'],
      ['Teacher A', '8A Mathematics rational-numbers'],
    ]);
    expect(log[1].details).toMatchObject({ misconception: PQ, students: 2, questions: 2 });
  });

  it('keeps who it is for out of reach of a browser', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [one.teacherA]);
        return tx.query(`select * from lms.assignment_student`);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('last year', () => {
  it("shows nobody of last year's class and sends nothing to it", async () => {
    await admin.startNewYear('2027-28', ymd(3), ymd(367));
    await expect(teacherA.classLikelyMisconceptions(one.s8a, one.maths)).rejects.toThrow(/not your class/);
    expect(await admin.classLikelyMisconceptions(one.s8a, one.maths)).toEqual([]);
    const send = (c: LmsClient) =>
      c.sendPractice({
        sectionId: one.s8a, subjectId: one.maths, chapter: 'rational-numbers', studentUserIds: [kid.Kabir],
        dueAt: inDays(2),
      });
    await expect(send(teacherA)).rejects.toThrow(/not your class/);
    await expect(send(admin)).rejects.toThrow(/not a class of this year/);
    // Last year's practice has left the children's Work tab with last year's class.
    expect((await as.Kabir.myAssignments()).map((a) => a.id)).not.toContain(practice);
  });
});
