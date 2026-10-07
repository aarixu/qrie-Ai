// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient, type QuestionDraft } from '../src/index.ts';

/**
 * AI-DRAFTED QUESTIONS WAIT FOR THEIR TEACHER (migration 0043). Written first.
 *
 * An AI's questions are only drafts: they wait in the queue of the teacher
 * who asked for them, and nobody else sees them. The teacher edits and adds
 * a draft — then, and only then, it is that teacher's own question, approved
 * for the school (0023) and able to be set — or discards it. A draft is
 * checked as a question is (four options at most six, one right, no two the
 * same) before it is kept.
 */

let db: PGlite;
let one: School;
let other: School;
let admin: LmsClient;
let teacherA: LmsClient;
let teacherB: LmsClient;
let riya: LmsClient;
let elsewhere: LmsClient;

const TOPIC = 'test-m8-rational-closure';
const draft = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
  stem: 'Is the set of rational numbers closed under subtraction?',
  options: ['Yes, always', 'No, never', 'Only for positive numbers', 'Only for integers'],
  correctIndex: 0,
  misconceptions: ['', 'Thinks subtraction can leave the set', 'Thinks negatives are not rational', 'Confuses rationals with integers'],
  ...over,
});
const save = (who: LmsClient, drafts: QuestionDraft[], over: { grade?: number; subject?: string; outcomeId?: string | null } = {}) =>
  who.saveItemDrafts({ grade: 8, subject: 'Mathematics', outcomeId: TOPIC, model: 'google/gemini-3.7-flash', drafts, ...over });

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'DRF');
  other = await buildSchool(db, 'OTH');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  teacherB = createLmsClient(pgliteTransport(db, one.teacherB));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  elsewhere = createLmsClient(pgliteTransport(db, other.teacherA));
  await db.query(
    `insert into lms.outcome (id, grade, subject, chapter, title) values
       ($1, 8, 'Mathematics', 'Rational numbers', 'Closure'),
       ('test-s7-plants', 7, 'Science', 'Nutrition in plants', 'Photosynthesis')`,
    [TOPIC],
  );
});
afterAll(async () => {
  await db.close();
});

describe('a draft', () => {
  it("waits in the queue of the teacher who asked for it, and nobody else's", async () => {
    expect(await save(teacherA, [draft(), draft({ stem: 'Which of these is not rational?', options: ['1/2', '0', 'pi', '-3'], correctIndex: 2 })])).toBe(2);
    const mine = await teacherA.myItemDrafts();
    expect(mine.map((d) => d.stem)).toEqual(['Which of these is not rational?', 'Is the set of rational numbers closed under subtraction?']);
    expect(mine[1]).toMatchObject({
      grade: 8,
      subject: 'Mathematics',
      outcomeId: TOPIC,
      chapter: 'Rational numbers',
      topic: 'Closure',
      options: ['Yes, always', 'No, never', 'Only for positive numbers', 'Only for integers'],
      correctIndex: 0,
      misconceptions: ['', 'Thinks subtraction can leave the set', 'Thinks negatives are not rational', 'Confuses rationals with integers'],
      model: 'google/gemini-3.7-flash',
    });
    expect(await teacherB.myItemDrafts()).toEqual([]);
    expect(await admin.myItemDrafts()).toEqual([]);
    expect(await elsewhere.myItemDrafts()).toEqual([]);
  });

  it('is not in the bank, and cannot be set, until its teacher adds it', async () => {
    const bank = await teacherA.library({ grade: 8, subject: 'Mathematics' });
    expect(bank.map((i) => i.stem)).not.toContain('Is the set of rational numbers closed under subtraction?');
  });

  it('is kept only by a teacher or the admin of a school, and never by a child', async () => {
    expect(await save(admin, [draft()], { outcomeId: null })).toBe(1);
    await expect(save(riya, [draft()])).rejects.toThrow(/only a teacher or the school admin/);
  });

  it('is checked as a question is, and the whole batch is refused if one is not usable', async () => {
    const before = (await teacherA.myItemDrafts()).length;
    for (const bad of [
      draft({ stem: '  \n ' }),
      draft({ options: ['Only one'], correctIndex: 0, misconceptions: [''] }),
      draft({ correctIndex: 4 }),
      draft({ options: ['Yes', ' yes', 'No', 'Maybe'] }),
      draft({ options: ['Yes', '', 'No', 'Maybe'] }),
      draft({ options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], misconceptions: [] }),
      draft({ stem: 'x'.repeat(2001) }),
      draft({ misconceptions: ['', 'y'.repeat(121), '', ''] }),
    ]) {
      await expect(save(teacherA, [draft({ stem: 'A good one?' }), bad])).rejects.toThrow(/draft 2 is not a usable question/);
    }
    await expect(save(teacherA, [])).rejects.toThrow(/1 to 10 drafts at a time/);
    await expect(save(teacherA, Array.from({ length: 11 }, (_, i) => draft({ stem: `Q${i}?` })))).rejects.toThrow(/1 to 10 drafts at a time/);
    await expect(save(teacherA, [draft()], { outcomeId: 'test-s7-plants' })).rejects.toThrow(/not a Class 8 Mathematics topic/);
    await expect(save(teacherA, [draft()], { grade: 13 })).rejects.toThrow(/Class 1 to 12/);
    expect((await teacherA.myItemDrafts()).length).toBe(before);
  });

  it('waits 100 to a teacher at most', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => draft({ stem: `Batch question ${i}?` }));
    const queued = (await teacherB.myItemDrafts()).length;
    for (let i = queued; i + 10 <= 100; i += 10) await save(teacherB, ten);
    expect((await teacherB.myItemDrafts()).length).toBe(100);
    await expect(save(teacherB, [draft()])).rejects.toThrow(/100 drafts are waiting/);
    for (const d of await teacherB.myItemDrafts()) await teacherB.discardItemDraft(d.draftId);
  });
});

describe('adding a draft', () => {
  it("makes it the teacher's own question, as edited, approved for the school and able to be set", async () => {
    const [, first] = await teacherA.myItemDrafts();
    const itemId = await teacherA.acceptItemDraft(first.draftId, {
      stem: 'Is the set of rational numbers closed under subtraction? Give a reason.',
      options: ['Yes, always', 'No, never', 'Only for positive numbers', 'Only for whole numbers'],
      correctIndex: 0,
      misconceptions: ['', 'Thinks subtraction can leave the set', 'Thinks negatives are not rational', 'Confuses rationals with whole numbers'],
    });
    expect((await teacherA.myItemDrafts()).map((d) => d.draftId)).not.toContain(first.draftId);
    const bank = await teacherA.library({ grade: 8, subject: 'Mathematics' });
    expect(bank.find((i) => i.id === itemId)).toMatchObject({
      source: 'school',
      approved: true,
      stem: 'Is the set of rational numbers closed under subtraction? Give a reason.',
      options: ['Yes, always', 'No, never', 'Only for positive numbers', 'Only for whole numbers'],
      correctIndex: 0,
      outcomeIds: [TOPIC],
      chapter: 'Rational numbers',
    });
    const row = (
      await db.query<{ misconceptions: string[]; ai_model: string; created_by: string }>(
        `select misconceptions, ai_model, created_by from lms.item where id = $1`,
        [itemId],
      )
    ).rows[0];
    expect(row).toEqual({
      misconceptions: ['', 'Thinks subtraction can leave the set', 'Thinks negatives are not rational', 'Confuses rationals with whole numbers'],
      ai_model: 'google/gemini-3.7-flash',
      created_by: one.teacherA,
    });

    const hw = await teacherA.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'homework',
      title: 'Closure',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      answerTypes: ['mcq'],
    });
    await teacherA.setAssignmentItems(hw, [itemId]);
  });

  it("keeps the draft's mistakes when the options are only reworded, and drops them when their number changes", async () => {
    await save(teacherA, [draft({ stem: 'Reworded?' }), draft({ stem: 'Fewer options?' })]);
    const [fewer, reworded] = await teacherA.myItemDrafts();
    const kept = await teacherA.acceptItemDraft(reworded.draftId, {
      stem: 'Reworded?',
      options: ['Yes', 'No', 'Only positives', 'Only integers'],
      correctIndex: 0,
    });
    const dropped = await teacherA.acceptItemDraft(fewer.draftId, { stem: 'Fewer options?', options: ['Yes', 'No'], correctIndex: 0 });
    const labels = async (id: string) =>
      (await db.query<{ m: string[] | null }>(`select misconceptions m from lms.item where id = $1`, [id])).rows[0].m;
    expect(await labels(kept)).toEqual(draft().misconceptions);
    expect(await labels(dropped)).toBeNull();
  });

  it('is checked again as edited', async () => {
    const [d] = await teacherA.myItemDrafts();
    await expect(teacherA.acceptItemDraft(d.draftId, { stem: 'Ok?', options: ['Same', 'same'], correctIndex: 0 })).rejects.toThrow(
      /not a usable question/,
    );
    await expect(teacherA.acceptItemDraft(d.draftId, { stem: 'Ok?', options: ['A', 'B'], correctIndex: 2 })).rejects.toThrow(
      /not a usable question/,
    );
    await expect(
      teacherA.acceptItemDraft(d.draftId, { stem: 'Ok?', options: ['A', 'B'], correctIndex: 0, misconceptions: ['', 'One', 'Two'] }),
    ).rejects.toThrow(/not a usable question/);
    expect((await teacherA.myItemDrafts()).map((x) => x.draftId)).toContain(d.draftId);
  });

  it("is refused to anyone but the draft's own teacher, as is discarding it", async () => {
    const [d] = await teacherA.myItemDrafts();
    const edit = { stem: d.stem, options: d.options, correctIndex: d.correctIndex };
    for (const who of [teacherB, admin, riya, elsewhere]) {
      await expect(who.acceptItemDraft(d.draftId, edit)).rejects.toThrow(/not your draft/);
      await expect(who.discardItemDraft(d.draftId)).rejects.toThrow(/not your draft/);
    }
    expect((await teacherA.myItemDrafts()).map((x) => x.draftId)).toContain(d.draftId);
  });
});

describe('discarding a draft', () => {
  it('takes it out of the queue for good', async () => {
    const [d] = await teacherA.myItemDrafts();
    await teacherA.discardItemDraft(d.draftId);
    expect((await teacherA.myItemDrafts()).map((x) => x.draftId)).not.toContain(d.draftId);
    await expect(teacherA.discardItemDraft(d.draftId)).rejects.toThrow(/not your draft/);
  });
});

describe('a teacher who has left', () => {
  it('keeps, reads and adds no drafts', async () => {
    const leaverId = await seat(db, one.org, 'teacher', 'DRF-T9', 'Teacher Nine');
    const leaver = createLmsClient(pgliteTransport(db, leaverId));
    await save(leaver, [draft({ stem: 'Before leaving?' })]);
    const [d] = await leaver.myItemDrafts();
    await admin.markLeft('DRF-T9');
    await expect(save(leaver, [draft()])).rejects.toThrow(/only a teacher or the school admin/);
    expect(await leaver.myItemDrafts()).toEqual([]);
    await expect(leaver.acceptItemDraft(d.draftId, { stem: d.stem, options: d.options, correctIndex: d.correctIndex })).rejects.toThrow(
      /not your draft/,
    );
  });
});

describe('the database', () => {
  it('keeps drafts away from browsers: no reading or writing the table itself', async () => {
    const { rows } = await db.query<{ r: boolean; w: boolean; rls: boolean }>(
      `select has_table_privilege('authenticated', 'lms.item_draft', 'select') r,
              has_table_privilege('authenticated', 'lms.item_draft', 'insert') w,
              (select relrowsecurity from pg_class where oid = 'lms.item_draft'::regclass) rls`,
    );
    expect(rows[0]).toEqual({ r: false, w: false, rls: true });
  });
});
