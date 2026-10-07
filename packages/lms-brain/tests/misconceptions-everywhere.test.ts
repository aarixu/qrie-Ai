// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { normaliseMisconception } from '../../learner-model/src/index.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../lms-client/src/index.ts';
import { loadOutcomes, think } from '../src/index.ts';

/**
 * A WRONG IDEA IS A WRONG IDEA WHEREVER IT WAS SHOWN (lam-one-brain Task 4;
 * truth test D10; migration 0063).
 *
 * The teacher's three lists of wrong ideas — per child (class_misconceptions),
 * the class's likely ones (class_likely_misconceptions) and a child's report
 * (student_misconceptions) — now read what the brain confirmed from homework
 * AND the tutor (concept_state.misconceptions), and homework the brain has
 * not read yet. One wrong answer is a slip and is listed nowhere; a wrong idea
 * shown on two questions is; a tutor-only one is, as a summary with no words
 * the phone sent; and it goes once two later right answers clear it.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const ZERO = 'thinks the denominator may be zero';
const ADDS = 'adds the numerators and the denominators';
const NEGATIVE = 'thinks closure fails for negative numbers';
const PHONE_WORDS = 'SENTINEL-7Q the words the phone sent';
const FROM_TUTOR = 'Repeated wrong idea (from the tutor)';
const SAME = 'Same wrong answer, chosen again';
const DAY = 86_400_000;

let db: PGlite;
let one: School;
let teacher: LmsClient;
let kabir: string; // ZERO on two homework questions
let meera: string; // wrong ideas from the tutor only
let dev: string; // NEGATIVE on two questions of a test not yet released
let isha: string; // one unlabelled wrong option of one tutor question, in two sittings
const item: Record<string, string> = {};

async function bankItem(ref: string, outcome: string, label: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ($1, $2, 8, 'Mathematics', 'mcq', $1, '["right","wrong one","wrong two"]'::jsonb, 0, $3::jsonb)
     returning id`,
    [ref, [outcome], JSON.stringify(['', label, ''])],
  );
  return rows[0].id;
}

async function enrolIn8a(user: string, roll: string): Promise<void> {
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
     values ($1, $2, $3, $4, $5)`,
    [one.org, one.year, one.s8a, user, roll],
  );
}

/** One tutor sitting written straight into the ledger, as the database owner: wrong answers, alone. */
async function tutorMisses(user: string, misses: { outcome: string; probe: string; label?: string }[]): Promise<void> {
  const session = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'class', now())`,
    [session, one.org, user],
  );
  for (const [n, m] of misses.entries()) {
    await db.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
       values ($1, $2, $3, $4, $5, now(), 'answered', 'class', 'tap', $6, $7::jsonb)`,
      [
        crypto.randomUUID(), one.org, user, session, n + 1, [m.outcome],
        JSON.stringify({
          correct: false, chosenIndex: 1, probeId: m.probe, attempt: 1, assistanceRung: 0,
          ...(m.label ? { misconceptionId: m.label } : {}),
        }),
      ],
    );
  }
}

async function homework(title: string, items: string[]): Promise<string> {
  const id = await teacher.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title,
    dueAt: new Date(Date.now() + DAY).toISOString(), answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(id, items);
  await teacher.publishAssignment(id);
  return id;
}

const as = (user: string) => createLmsClient(pgliteTransport(db, user));

/** Each child's wrong ideas in the class, as [name, label] pairs, sorted. */
async function perChild(): Promise<[string, string][]> {
  return (await teacher.classMisconceptions(one.s8a, one.maths))
    .map((m): [string, string] => [m.displayName, m.label])
    .sort();
}

/** The class's likely wrong ideas, as [label, names of the children]. */
async function likely(): Promise<[string, string[]][]> {
  return (await teacher.classLikelyMisconceptions(one.s8a, one.maths))
    .map((m): [string, string[]] => [m.label, m.children.map((c) => c.displayName)])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const labelsOf = async (viewer: LmsClient, student: string) =>
  (await viewer.studentMistakes(student)).map((m) => m.label).sort();

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'MIS');
  teacher = as(one.teacherA);
  kabir = await seat(db, one.org, 'student', 'MIS-103', 'Kabir');
  meera = await seat(db, one.org, 'student', 'MIS-104', 'Meera');
  dev = await seat(db, one.org, 'student', 'MIS-105', 'Dev');
  isha = await seat(db, one.org, 'student', 'MIS-106', 'Isha');
  await enrolIn8a(kabir, '3');
  await enrolIn8a(meera, '4');
  await enrolIn8a(dev, '5');
  await enrolIn8a(isha, '6');

  item.z1 = await bankItem('probe-mis-z1', DEFINE, ZERO);
  item.z2 = await bankItem('probe-mis-z2', DEFINE, ZERO);
  item.d3 = await bankItem('probe-mis-d3', DEFINE, '');
  item.d4 = await bankItem('probe-mis-d4', DEFINE, '');
  item.a1 = await bankItem('probe-mis-a1', CLOSURE, ADDS); // asked by the tutor only
  item.a2 = await bankItem('probe-mis-a2', CLOSURE, ADDS); // asked by the tutor only
  item.n1 = await bankItem('probe-mis-n1', CLOSURE, NEGATIVE);
  item.n2 = await bankItem('probe-mis-n2', CLOSURE, NEGATIVE);
  for (const id of Object.values(item)) await teacher.approveItem(id);

  // Riya slips once on ZERO; Kabir shows it on both questions that catch it.
  const hw = await homework('Rational numbers', [item.z1, item.z2, item.d3]);
  await as(one.kid8a).submitMcq(hw, { [item.z1]: 1, [item.z2]: 0, [item.d3]: 0 });
  await as(kabir).submitMcq(hw, { [item.z1]: 1, [item.z2]: 1, [item.d3]: 0 });

  // Dev shows NEGATIVE twice on a test whose results are not out.
  const test = await teacher.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'test', title: 'Unit test',
    dueAt: new Date(Date.now() + DAY).toISOString(), timeLimitMinutes: 10, answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(test, [item.n1, item.n2]);
  await teacher.publishAssignment(test);
  await as(dev).startTest(test);
  await as(dev).submitMcq(test, { [item.n1]: 1, [item.n2]: 1 });

  // Meera, in the tutor only: twice the idea the phone named in its own words,
  // on questions the bank does not hold; twice ADDS on the bank's questions.
  await tutorMisses(meera, [
    { outcome: DEFINE, probe: 'phone-only-1', label: PHONE_WORDS },
    { outcome: DEFINE, probe: 'phone-only-2', label: PHONE_WORDS },
    { outcome: CLOSURE, probe: 'probe-mis-a1', label: 'whatever the phone says' },
    { outcome: CLOSURE, probe: 'probe-mis-a2' },
  ]);
  // Isha picks the same unlabelled wrong option of one tutor question in two sittings.
  await tutorMisses(isha, [{ outcome: DEFINE, probe: 'phone-only-3' }]);
  await tutorMisses(isha, [{ outcome: DEFINE, probe: 'phone-only-3' }]);
  // Riya slips once on ADDS in the tutor.
  await tutorMisses(one.kid8a, [{ outcome: CLOSURE, probe: 'probe-mis-a1' }]);
});
afterAll(async () => {
  await db.close();
});

describe('before the brain has read anything: homework alone, two or more', () => {
  it('lists a wrong idea shown on two questions, and not a single slip', async () => {
    expect(await perChild()).toEqual([
      ['Dev', NEGATIVE],
      ['Kabir', ZERO],
    ]);
    expect(await likely()).toEqual([
      [NEGATIVE, ['Dev']],
      [ZERO, ['Kabir']],
    ]);
    expect(await labelsOf(teacher, one.kid8a)).toEqual([]);
    expect(await labelsOf(teacher, kabir)).toEqual([ZERO]);
  });
});

describe('once the brain has read it: homework and the tutor alike', () => {
  beforeAll(async () => {
    await think(db, [one.kid8a, kabir, meera, dev, isha]);
  });

  it("lists every child's confirmed wrong ideas, from homework and from the tutor", async () => {
    expect(await perChild()).toEqual([
      ['Dev', NEGATIVE],
      ['Isha', SAME],
      ['Kabir', ZERO],
      ['Meera', FROM_TUTOR],
      ['Meera', ADDS],
    ]);
    const kabirs = (await teacher.classMisconceptions(one.s8a, one.maths)).find((m) => m.displayName === 'Kabir')!;
    expect(kabirs).toMatchObject({ chapter: 'rational-numbers', times: 2 });
  });

  it("puts tutor-only ideas on the class's likely list, and a slip on none", async () => {
    expect(await likely()).toEqual([
      [FROM_TUTOR, ['Meera']],
      [SAME, ['Isha']],
      [ADDS, ['Meera']],
      [NEGATIVE, ['Dev']],
      [ZERO, ['Kabir']],
    ]);
    const adds = (await teacher.classLikelyMisconceptions(one.s8a, one.maths)).find((m) => m.label === ADDS)!;
    expect(adds).toMatchObject({ chapter: 'rational-numbers', students: 1 });
    // a1 and a2 catch it, are approved, and are on no work of the class.
    expect(adds.questions).toBeGreaterThanOrEqual(2);
  });

  it("shows them on the child's report, to the teacher and the child", async () => {
    expect(await labelsOf(teacher, meera)).toEqual([FROM_TUTOR, ADDS]);
    expect(await labelsOf(as(meera), meera)).toEqual([FROM_TUTOR, ADDS]);
    expect(await labelsOf(teacher, one.kid8a)).toEqual([]);
  });

  it('keeps a test the child has not had back off their own report, as before', async () => {
    expect(await labelsOf(teacher, dev)).toEqual([NEGATIVE]);
    expect(await labelsOf(as(dev), dev)).toEqual([]);
  });

  it('is a summary only: never the words the phone sent', async () => {
    const everything = JSON.stringify([
      await teacher.classMisconceptions(one.s8a, one.maths),
      await teacher.classLikelyMisconceptions(one.s8a, one.maths),
      await teacher.studentMistakes(meera),
      await as(meera).studentMistakes(meera),
    ]).toLowerCase();
    expect(everything).not.toContain('sentinel');
    expect(everything).not.toContain('whatever the phone says');
  });

  it('sets practice that catches the idea first, however the label is written', async () => {
    const practice = await teacher.sendPractice({
      sectionId: one.s8a, subjectId: one.maths, chapter: 'rational-numbers',
      misconception: '  Adds the NUMERATORS, and the denominators! ',
      studentUserIds: [meera], dueAt: new Date(Date.now() + 2 * DAY).toISOString(), questions: 2,
    });
    expect((await teacher.assignmentItems(practice)).map((x) => x.itemId).sort()).toEqual([item.a1, item.a2].sort());
  });
});

describe('cleared by two later right answers, on its own', () => {
  it('drops the idea everywhere once the brain reads them', async () => {
    const again = await homework('Rational numbers again', [item.d3, item.d4]);
    await as(kabir).submitMcq(again, { [item.d3]: 0, [item.d4]: 0 });
    // Not read yet: the brain still holds it.
    expect((await perChild()).filter(([name]) => name === 'Kabir')).toEqual([['Kabir', ZERO]]);

    await think(db, [kabir]);
    expect((await perChild()).filter(([name]) => name === 'Kabir')).toEqual([]);
    expect((await likely()).map(([label]) => label)).not.toContain(ZERO);
    expect(await labelsOf(teacher, kabir)).toEqual([]);
  });
});

describe('the pieces underneath', () => {
  it("keys a label in SQL as the model does", async () => {
    const labels = [
      ZERO,
      '  Adds the NUMERATORS, and the denominators! ',
      'thinks 1/0 is "infinity" -- or 0?',
      'x'.repeat(118) + ' y-z tail beyond the cut',
      '?!',
    ];
    for (const label of labels) {
      const { rows } = await db.query<{ key: string }>(`select lms.misconception_key($1) as key`, [label]);
      expect(rows[0].key, label).toBe(normaliseMisconception(label));
    }
  });

  it("keeps the brain's reading of any child's model from a browser", async () => {
    for (const call of [
      `select * from lms.brain_misconceptions('${meera}')`,
      `select lms.brain_has_read('${meera}', now())`,
      `select lms.misconception_key('x')`,
    ]) {
      await expect(asUser(db, one.teacherA, (tx) => tx.query(call)), call).rejects.toThrow(/permission denied/);
    }
  });
});
