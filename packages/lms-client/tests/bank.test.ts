// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOutcomes } from '../../lms-brain/src/index.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * THE QUESTION BANK, BY CHAPTER AND TOPIC (migration 0028). A teacher picks
 * class and subject, then a chapter, then a topic, in the order the syllabus
 * teaches them, and sees how many questions each has. Their own questions
 * are filed under a topic too. Written first.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const LINEAR = 'class8-mathematics-linear-equations-in-one-variable-identify-linear-expression';

let db: PGlite;
let one: School;
let teacher: LmsClient;

async function libraryItem(ref: string, outcome: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index)
     values ($1, $2, 8, 'Mathematics', 'mcq', $3, '["a","b"]'::jsonb, 0) returning id`,
    [ref, [outcome], `Question ${ref}`],
  );
  return rows[0].id;
}

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'BNK');
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  await libraryItem('b1', DEFINE);
  await libraryItem('b2', DEFINE);
  await libraryItem('b3', CLOSURE);
  await libraryItem('b4', LINEAR);
});
afterAll(async () => {
  await db.close();
});

describe('the question bank, by chapter and topic', () => {
  it('lists the chapters and their topics in syllabus order, with how many questions each has', async () => {
    const topics = await teacher.libraryTopics(8, 'Mathematics');
    const chapters = [...new Set(topics.map((t) => t.chapter))];
    expect(chapters.slice(0, 2)).toEqual(['rational-numbers', 'linear-equations-in-one-variable']);
    expect(topics.find((t) => t.outcomeId === DEFINE)).toMatchObject({
      chapter: 'rational-numbers',
      title: 'Define Rational Numbers',
      questions: 2,
    });
    expect(topics.find((t) => t.outcomeId === CLOSURE)?.questions).toBe(1);
    // Within a chapter, topics come in the order they are taught.
    const rational = topics.filter((t) => t.chapter === 'rational-numbers').map((t) => t.outcomeId);
    expect(rational.indexOf(DEFINE)).toBeLessThan(rational.indexOf(CLOSURE));
  });

  it('filters by chapter, and by topic, and says where each question sits', async () => {
    const chapter = await teacher.library({ grade: 8, subject: 'Mathematics', chapter: 'rational-numbers' });
    expect(chapter.map((i) => i.stem).sort()).toEqual(['Question b1', 'Question b2', 'Question b3']);
    const topic = await teacher.library({ grade: 8, subject: 'Mathematics', outcome: CLOSURE });
    expect(topic).toHaveLength(1);
    expect(topic[0]).toMatchObject({ chapter: 'rational-numbers', topic: 'Closure Property under Addition' });
  });

  it("files a teacher's own question under the topic they choose", async () => {
    const id = await teacher.writeItem({
      grade: 8,
      subject: 'Mathematics',
      outcomeId: LINEAR,
      stem: 'Is 2x + 3 = 7 a linear equation?',
      options: ['Yes', 'No'],
      correctIndex: 0,
    });
    const found = await teacher.library({ grade: 8, subject: 'Mathematics', outcome: LINEAR });
    expect(found.find((i) => i.id === id)).toMatchObject({ source: 'school', chapter: 'linear-equations-in-one-variable' });
  });

  it("refuses a topic from another class or subject", async () => {
    await expect(
      teacher.writeItem({
        grade: 8,
        subject: 'Mathematics',
        outcomeId: 'class8-science-crop-crop-definition',
        stem: 'Wrong place',
        options: ['a', 'b'],
        correctIndex: 0,
      }),
    ).rejects.toThrow(/not a Class 8 Mathematics topic/);
  });
});
