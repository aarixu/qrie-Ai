// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyParams } from '@ai-tutor/knowledge-graph';
import { nextActivity, type LearnerModel } from '@ai-tutor/learner-model';
import { RECOGNISE, decide, type Action, type AskInput } from '@ai-tutor/tutor-control';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { askHistory, wrongOptionText } from '../../../apps/classroom/src/lib/askHistory.ts';
import { standingOf } from '../../../apps/student/src/features/standing.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../lms-client/src/index.ts';
import { foldLedger, libraryIndex, loadOutcomes, readLedger, think } from '../src/index.ts';

/**
 * THE M1 GATE (lam-one-brain Task 6b, binding amendment MF13): the medium
 * version, visibly adaptive, end to end.
 *
 * Real migrations on PGlite, the real fold, think() called directly, the real
 * RPCs and the real decision functions. Each pair of children answers the same
 * questions, one wrong (or carried by help) and one right (or alone); every
 * decision must differ between them:
 *   (1) a homework wrong idea on two questions is on the teacher's lists;
 *   (2) that child's practice opens on it, saying what to watch out for;
 *   (3) thirty rights on the tutor's rung 7 read "Getting there (with help)";
 *   (4) a tutor wrong idea in two sittings makes the next activity remedial
 *       and the next wrong answer to it a targeted re-explanation that opens
 *       by recognising it.
 * M2 waits on this file.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const ZERO = 'thinks the denominator may be zero';
const ADDS = 'adds the numerators and the denominators';
const DAY = 86_400_000;

let db: PGlite;
let one: School;
let teacher: LmsClient;
const kid: Record<'aWrong' | 'aRight' | 'bHelped' | 'bAlone' | 'cWrong' | 'cRight', string> = {
  aWrong: '', aRight: '', bHelped: '', bAlone: '', cWrong: '', cRight: '',
};
const item: Record<string, string> = {};

const as = (user: string) => createLmsClient(pgliteTransport(db, user));

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

/** One tutor sitting written straight into the ledger, as the database owner. */
async function tutorSitting(
  user: string,
  source: 'class' | 'quiz',
  answers: { outcome: string; probe: string; correct: boolean; rung?: number }[],
): Promise<void> {
  const session = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, $4, now())`,
    [session, one.org, user, source],
  );
  for (const [n, a] of answers.entries()) {
    await db.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
       values ($1, $2, $3, $4, $5, now(), 'answered', $6, 'tap', $7, $8::jsonb)`,
      [
        crypto.randomUUID(), one.org, user, session, n + 1, source, [a.outcome],
        JSON.stringify({
          correct: a.correct, chosenIndex: a.correct ? 0 : 1, probeId: a.probe, attempt: 1, assistanceRung: a.rung ?? 0,
        }),
      ],
    );
  }
}

/** The model think() writes for this learner: their ledger through the same fold. */
async function serverModel(user: string): Promise<LearnerModel> {
  return foldLedger(await readLedger(db, user), libraryIndex(), emptyParams());
}

/** The tutor's held question on closure, with ADDS as its wrong option and another way to explain it. */
const ASK: AskInput = {
  question: 'Is 1/2 + 1/3 a rational number, and what is it?',
  expect: '5/6',
  options: [
    { text: '5/6', correct: true, why: 'Make the denominators the same, then add the numerators.' },
    { text: ADDS, correct: false, why: 'Adding the denominators changes the size of the pieces.' },
  ],
  alternates: [{ mode: 'everyday', say: 'Half a roti and a third of a roti: cut both into sixths first, then count the pieces.' }],
};

/** The next wrong answer to ASK, choosing ADDS, as the classroom would decide it. */
function nextWrongAnswer(model: LearnerModel): Action {
  return decide({
    verdict: 'wrong',
    attempt: 1,
    rungSoFar: 0,
    ask: ASK,
    matchedOption: 1,
    history: askHistory({ model, outcomeIds: [CLOSURE], wrongOption: wrongOptionText(ASK, 1), sessionId: 'this-sitting' }),
    lang: 'en',
    now: 0,
  });
}

const opensByRecognising = (a: Action): boolean => RECOGNISE.idea.en.some((p) => (a.say ?? '').startsWith(p));

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'MOG');
  teacher = as(one.teacherA);
  for (const [n, k] of (Object.keys(kid) as (keyof typeof kid)[]).entries()) {
    kid[k] = await seat(db, one.org, 'student', `MOG-${110 + n}`, k);
    await enrolIn8a(kid[k], String(10 + n));
  }

  item.z1 = await bankItem('probe-mog-z1', DEFINE, ZERO);
  item.z2 = await bankItem('probe-mog-z2', DEFINE, ZERO);
  item.z3 = await bankItem('probe-mog-z3', DEFINE, ZERO); // practice only
  item.d1 = await bankItem('probe-mog-d1', DEFINE, '');
  item.a1 = await bankItem('probe-mog-a1', CLOSURE, ADDS); // the tutor's
  item.a2 = await bankItem('probe-mog-a2', CLOSURE, ADDS); // the tutor's
  item.c1 = await bankItem('probe-mog-c1', CLOSURE, '');
  for (const id of Object.values(item)) await teacher.approveItem(id);

  // A: homework on the two questions that catch ZERO, wrong on both, or right on both.
  const hw = await teacher.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title: 'Rational numbers',
    dueAt: new Date(Date.now() + DAY).toISOString(), answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(hw, [item.z1, item.z2]);
  await teacher.publishAssignment(hw);
  await as(kid.aWrong).submitMcq(hw, { [item.z1]: 1, [item.z2]: 1 });
  await as(kid.aRight).submitMcq(hw, { [item.z1]: 0, [item.z2]: 0 });
  // The homework closes, so its questions may be practised.
  await db.query(`update lms.assignment set due_at = now() - interval '1 hour' where id = $1`, [hw]);

  // B: thirty right answers on defining, in three sittings: each after the
  // tutor walked them to it (rung 7), or each alone.
  for (let s = 0; s < 3; s++) {
    for (const [who, rung] of [[kid.bHelped, 7], [kid.bAlone, 0]] as const) {
      await tutorSitting(who, 'class', Array.from({ length: 10 }, (_, n) => ({
        outcome: DEFINE, probe: `probe-mog-b-${s}-${n}`, correct: true, rung,
      })));
    }
  }

  // C: the tutor's quiz asks the bank's ADDS questions in two sittings: ADDS chosen each time, or the right answer.
  for (const probe of ['probe-mog-a1', 'probe-mog-a2']) {
    await tutorSitting(kid.cWrong, 'quiz', [{ outcome: CLOSURE, probe, correct: false }]);
    await tutorSitting(kid.cRight, 'quiz', [{ outcome: CLOSURE, probe, correct: true }]);
  }

  await think(db, Object.values(kid));
});
afterAll(async () => {
  await db.close();
});

describe('(1) a wrong idea on two homework questions is on the teacher’s lists; right answers are not', () => {
  it('class_likely_misconceptions and class_misconceptions name it for that child only', async () => {
    const likely = await teacher.classLikelyMisconceptions(one.s8a, one.maths);
    const zero = likely.find((m) => m.label === ZERO);
    expect(zero?.children.map((c) => c.studentUserId)).toEqual([kid.aWrong]);
    const perChild = await teacher.classMisconceptions(one.s8a, one.maths);
    expect(perChild.filter((m) => m.label === ZERO).map((m) => m.studentUserId)).toEqual([kid.aWrong]);
    expect(perChild.filter((m) => m.studentUserId === kid.aRight)).toEqual([]);
  });
});

describe('(2) that child’s practice opens on the idea; the flipped child’s does not', () => {
  it('practice_for_me puts a ZERO question first, with what to watch out for', async () => {
    const wrong = await as(kid.aWrong).practiceForMe('Mathematics', 5);
    expect(wrong[0]).toMatchObject({ reason: 'misconception', watchOut: ZERO, outcomeId: DEFINE });
    expect([item.z1, item.z2, item.z3]).toContain(wrong[0].itemId);

    const right = await as(kid.aRight).practiceForMe('Mathematics', 20);
    expect(right.length).toBeGreaterThan(0);
    for (const r of right) expect(r).toMatchObject({ watchOut: null });
    for (const r of right) expect(r.reason).not.toBe('misconception');
  });
});

describe('(3) success carried by help reads as help, not as Strong', () => {
  it('thirty rung-7 rights read "Getting there (with help)"; the same thirty alone read "Strong"', async () => {
    const [helped] = await as(kid.bHelped).myProgress();
    expect(standingOf(helped).word).toBe('Getting there (with help)');
    const [alone] = await as(kid.bAlone).myProgress();
    expect(standingOf(alone).word).toBe('Strong');
  });
});

describe('(4) a tutor wrong idea in two sittings changes what the tutor does next', () => {
  it('the next activity is remedial on that outcome; right answers in its place are not', async () => {
    const now = new Date().toISOString();
    const wrong = nextActivity({ model: await serverModel(kid.cWrong), index: libraryIndex(), now, next: { outcomeIds: [] } });
    expect(wrong.kind).toBe('remedial');
    if (wrong.kind === 'remedial') expect(wrong.outcomeIds).toContain(CLOSURE);
    const right = nextActivity({ model: await serverModel(kid.cRight), index: libraryIndex(), now, next: { outcomeIds: [] } });
    expect(right.kind).toBe('next');
  });

  it('the next wrong answer is explained another way and opens by recognising the idea; after right answers it is not', async () => {
    const wrong = nextWrongAnswer(await serverModel(kid.cWrong));
    expect(wrong.kind).toBe('explainAgain');
    expect(opensByRecognising(wrong)).toBe(true);
    const right = nextWrongAnswer(await serverModel(kid.cRight));
    expect(right.kind).toBe('rethink');
    expect(opensByRecognising(right)).toBe(false);
  });

  it('the teacher sees the tutor’s idea in the bank’s words, for that child only', async () => {
    const likely = await teacher.classLikelyMisconceptions(one.s8a, one.maths);
    expect(likely.find((m) => m.label === ADDS)?.children.map((c) => c.studentUserId)).toEqual([kid.cWrong]);
  });

  it('the model the tutor reads is the one the server wrote', async () => {
    const { rows } = await db.query<{ misconceptions: Record<string, { label: string | null }> }>(
      `select misconceptions from public.concept_state where user_id = $1 and outcome_id = $2`,
      [kid.cWrong, CLOSURE],
    );
    const model = await serverModel(kid.cWrong);
    expect(Object.keys(rows[0].misconceptions)).toEqual(Object.keys(model.states[CLOSURE].misconceptions));
    expect(Object.values(rows[0].misconceptions).map((m) => m.label)).toEqual([ADDS]);
  });
});
