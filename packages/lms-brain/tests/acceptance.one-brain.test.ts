// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nextActivity, type LearnerModel } from '@ai-tutor/learner-model';
import { decide, type Action, type AskInput } from '@ai-tutor/tutor-control';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { askHistory, wrongOptionText } from '../../../apps/classroom/src/lib/askHistory.ts';
import { standingOf } from '../../../apps/student/src/features/standing.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../lms-client/src/index.ts';
import {
  drainBrainQueue,
  libraryIndex,
  loadOutcomes,
  modelFromServer,
  type ServerModel,
} from '../src/index.ts';

/**
 * THE ONE BRAIN, ACCEPTED (lam-one-brain Task 12; spec sections 1-2; review
 * SF7, SF8, SF13). Permanent.
 *
 * One database with every migration (PGlite), the real write doors
 * (lms.submit_mcq for homework, public.record_evidence for the tutor), the
 * brain run as it runs by itself (the ledger trigger queues the learner,
 * drainBrainQueue folds them), and the real reads: what the student app, the
 * teacher app and the tutor (public.my_learner_model) are given, and the
 * decisions taken from them (nextActivity, decide, lms.practice_for_me).
 *
 * For each of the three ways a learner meets Qrie:
 *   (a) a school child with homework AND tutor evidence;
 *   (b) a school child with homework only, no tutor event at all;
 *   (c) an independent tutor learner: an anonymous account in its own solo org.
 * Each learner has a twin who answers the same questions the other way (C1:
 * flipping the answers must flip the decisions), and each tries to forge the
 * evidence or its clock (C2). C5: fetch and every export of packages/relay
 * are stubbed to throw, and the whole loop must run without touching them.
 *
 * What this file does not prove: a class lesson's answer is still the
 * phone's word (record_evidence grades only bank questions, 0115; truth D04
 * and D04 open), so C2 for the tutor's evidence stays partial; and nothing
 * here runs on the hosted project.
 */

// --- C5: no model call. Every relay export and fetch throw, and are counted. ---
const stub = vi.hoisted(() => ({ relay: 0, fetch: 0 }));
vi.mock('@ai-tutor/relay', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(real)) {
    out[name] =
      typeof value === 'function'
        ? (..._args: unknown[]) => {
            stub.relay++;
            throw new Error(`a model call reached the relay (${name})`);
          }
        : value;
  }
  return out;
});

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
/** The outcome the clock and forgery attempts aim at, so they leave the others alone. */
const IDENTITY = 'class8-mathematics-rational-numbers-additive-identity';
const ZERO = 'thinks the denominator may be zero';
const ADDS = 'adds the numerators and the denominators';
/** An answer's words, planted in a tutor event: no teacher read may ever return it (SF8 a). */
const SENTINEL = 'SENTINEL-7Q';
const DAY = 86_400_000;
const FUTURE = '2099-01-01T00:00:00.000Z';

let db: PGlite;
let one: School;
/** Another school, whose org the forgery tests name: never the forger's own. */
let two: School;
let teacher: LmsClient;
let admin: LmsClient;
let homework = '';
const kid = { a: '', aTwin: '', b: '', bTwin: '', c: '', cTwin: '' };
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

/** An independent tutor learner: an anonymous sign-up, which the platform gives its own solo org (0005, 0021). */
async function anonymousLearner(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`insert into auth.users (is_anonymous) values (true) returning id`);
  return rows[0].id;
}

interface Answer {
  outcome: string;
  probe: string;
  chosen: number;
  extra?: Record<string, unknown>;
}

/** One tutor sitting as the phone sends it: a session-started and its answers, all at the phone's `at`. */
function sitting(source: string, answers: Answer[], at = new Date().toISOString(), extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  return {
    session: { id, source, startedAt: at },
    events: [
      { id: crypto.randomUUID(), sessionId: id, seq: 0, at, kind: 'session-started', source, surface: 'tap', outcomeIds: [], payload: {}, ...extra },
      ...answers.map((a, n) => ({
        id: crypto.randomUUID(), sessionId: id, seq: n + 1, at, kind: 'answered', source, surface: 'tap',
        outcomeIds: [a.outcome],
        payload: {
          correct: a.chosen === 0, chosenIndex: a.chosen, probeId: a.probe, ms: 4000, attempt: 1, assistanceRung: 0,
          hintsShown: 0, ...a.extra,
        },
        ...extra,
      })),
    ],
  };
}
type Sitting = ReturnType<typeof sitting>;

interface Receipt {
  id: string;
  status: string;
  reason: string | null;
}

/** public.record_evidence as the learner's own token sends it (0107). */
async function send(user: string, ...sittings: Sitting[]): Promise<Receipt[]> {
  return asUser(db, user, async (tx) =>
    (
      await tx.query<Receipt>(`select id, status, reason from public.record_evidence($1::jsonb, $2::jsonb)`, [
        JSON.stringify(sittings.map((s) => s.session)),
        JSON.stringify(sittings.flatMap((s) => s.events)),
      ])
    ).rows,
  );
}

/** The brain as it runs by itself: drain everything the ledger trigger queued. */
const drain = () => drainBrainQueue(db, { maxLearners: Infinity, maxMs: Infinity });

/** What the tutor reads at sign-in and lesson start (public.my_learner_model, 0109), as its base model. */
async function tutorModel(user: string): Promise<LearnerModel> {
  const server = await asUser(db, user, async (tx) =>
    (await tx.query<{ m: ServerModel }>(`select public.my_learner_model() as m`)).rows[0].m,
  );
  return modelFromServer(server);
}

const ledgerCount = async (user: string): Promise<number> =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.ledger_event where user_id = $1`, [user])).rows[0].n;

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

/** The tutor's move on the next wrong answer to ASK (choosing ADDS), from the model it read. */
const nextWrongAnswer = (model: LearnerModel): Action =>
  decide({
    verdict: 'wrong',
    attempt: 1,
    rungSoFar: 0,
    ask: ASK,
    matchedOption: 1,
    history: askHistory({ model, outcomeIds: [CLOSURE], wrongOption: wrongOptionText(ASK, 1), sessionId: 'this-sitting' }),
    lang: 'en',
    now: 0,
  });

const nextFor = (model: LearnerModel, now = new Date().toISOString()) =>
  nextActivity({ model, index: libraryIndex(), now, next: { outcomeIds: [] } });

/** Everything a teacher and an admin of the school can read, as JSON (SF8). */
async function everythingTheSchoolReads(): Promise<string> {
  const reads: Record<string, unknown> = {
    myClasses: await teacher.myClasses(),
    classRoster: await teacher.classRoster(one.s8a),
    classInsights: await teacher.classInsights(one.s8a, one.maths),
    classBrainStatus: await teacher.classBrainStatus(one.s8a, one.maths),
    classMisconceptions: await teacher.classMisconceptions(one.s8a, one.maths),
    classLikelyMisconceptions: await teacher.classLikelyMisconceptions(one.s8a, one.maths),
    classTrend: await teacher.classTrend(one.s8a, one.maths),
    classAssignments: await teacher.classAssignments(one.s8a, one.maths),
    assignmentResults: await teacher.assignmentResults(homework),
    assignmentOverview: await teacher.assignmentOverview(homework),
    itemStats: await teacher.itemStats(homework),
    needsAttention: await teacher.needsAttention(),
    schoolOverview: await admin.schoolOverview(),
    schoolClasses: await admin.schoolClasses(),
    schoolStudents: await admin.schoolStudents(),
  };
  for (const k of [kid.a, kid.aTwin, kid.b, kid.bTwin]) {
    reads[`student ${k}`] = {
      card: await teacher.studentCard(k),
      subjects: await teacher.studentSubjects(k),
      timeline: await teacher.studentTimeline(k),
      chapters: await teacher.studentChapters(k),
      brainStatus: await teacher.brainStatus(k),
      mistakes: await teacher.studentMistakes(k),
    };
  }
  return JSON.stringify(reads);
}

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  // From here on, nothing may reach the network.
  vi.stubGlobal('fetch', (..._args: unknown[]) => {
    stub.fetch++;
    throw new Error('the loop reached the network');
  });

  one = await buildSchool(db, 'ONE');
  two = await buildSchool(db, 'TWO');
  teacher = as(one.teacherA);
  admin = as(one.admin);
  for (const [n, k] of (['a', 'aTwin', 'b', 'bTwin'] as const).entries()) {
    kid[k] = await seat(db, one.org, 'student', `ONE-${120 + n}`, k);
    await enrolIn8a(kid[k], String(20 + n));
  }
  kid.c = await anonymousLearner();
  kid.cTwin = await anonymousLearner();

  item.z1 = await bankItem('probe-one-z1', DEFINE, ZERO);
  item.z2 = await bankItem('probe-one-z2', DEFINE, ZERO);
  item.z3 = await bankItem('probe-one-z3', DEFINE, ZERO); // practice only
  item.a1 = await bankItem('probe-one-a1', CLOSURE, ADDS); // the tutor's
  item.a2 = await bankItem('probe-one-a2', CLOSURE, ADDS); // the tutor's
  item.a3 = await bankItem('probe-one-a3', CLOSURE, ADDS); // practice only
  item.c1 = await bankItem('probe-one-c1', CLOSURE, '');
  for (const id of Object.values(item)) await teacher.approveItem(id);

  // Homework for 8A on the two questions that catch ZERO: (a) and (b) wrong on both, their twins right.
  homework = await teacher.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title: 'Rational numbers',
    dueAt: new Date(Date.now() + DAY).toISOString(), answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(homework, [item.z1, item.z2]);
  await teacher.publishAssignment(homework);
  for (const k of [kid.a, kid.b]) await as(k).submitMcq(homework, { [item.z1]: 1, [item.z2]: 1 });
  for (const k of [kid.aTwin, kid.bTwin]) await as(k).submitMcq(homework, { [item.z1]: 0, [item.z2]: 0 });
  // The homework closes, so its questions may be practised.
  await db.query(`update lms.assignment set due_at = now() - interval '1 hour' where id = $1`, [homework]);

  // The tutor's quiz asks the bank's ADDS questions in two sittings: (a) and (c) choose ADDS, their twins the right answer.
  for (const probe of ['probe-one-a1', 'probe-one-a2']) {
    for (const [who, chosen] of [[kid.a, 1], [kid.aTwin, 0], [kid.c, 1], [kid.cTwin, 0]] as const) {
      // (a)'s answer carries words, as a typed answer would: the planted sentinel.
      const extra = who === kid.a ? { answerNormalised: SENTINEL } : {};
      const receipts = await send(who, sitting('quiz', [{ outcome: CLOSURE, probe, chosen, extra }]));
      expect(receipts.map((r) => r.status)).toEqual(['recorded', 'recorded']);
    }
  }

  await drain();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.close();
});

/** The forgery and clock attempts every learner makes (C2), each aimed at IDENTITY or refused outright. */
function forgeryAndClock(who: () => string, ownOrg: () => Promise<string>, otherOrg: () => string) {
  it('C2: a source only the LMS may write is refused, and the ledger is unchanged', async () => {
    const before = await ledgerCount(who());
    for (const source of ['homework', 'test', 'practice', 'api']) {
      const receipts = await send(who(), sitting(source, [{ outcome: IDENTITY, probe: 'probe-one-forged', chosen: 0 }]));
      expect(receipts.every((r) => r.status === 'refused' && r.reason === 'source')).toBe(true);
    }
    expect(await ledgerCount(who())).toBe(before);
  });

  it('C2: a direct insert into the ledger is refused', async () => {
    await expect(
      asUser(db, who(), (tx) =>
        tx.query(
          `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
           values (gen_random_uuid(), $1, $2, gen_random_uuid(), 1, now(), 'answered', 'quiz', 'tap', $3, '{"correct":true}'::jsonb)`,
          [otherOrg(), who(), [IDENTITY]],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('C2: an org, a learner and a clock in the input are not the ones stored', async () => {
    // The org named in the input must be another one, or an ignored org could
    // not be told from a used one.
    expect(otherOrg()).not.toBe(await ownOrg());
    const forged = sitting('quiz', [{ outcome: IDENTITY, probe: 'probe-one-clock', chosen: 0 }], FUTURE, {
      orgId: otherOrg(),
      userId: kid.aTwin === who() ? kid.a : kid.aTwin,
    });
    expect((await send(who(), forged)).map((r) => r.status)).toEqual(['recorded', 'recorded']);
    const { rows } = await db.query<{ org_id: string; user_id: string; ahead: boolean; s_ahead: boolean }>(
      `select e.org_id, e.user_id, e.at > e.received_at + interval '5 minutes' as ahead,
              s.started_at > s.received_at + interval '5 minutes' as s_ahead
         from public.ledger_event e join public.learning_session s on s.id = e.session_id
        where e.session_id = $1`,
      [forged.session.id],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toEqual({ org_id: await ownOrg(), user_id: who(), ahead: false, s_ahead: false });
  });

  it('C2: two cold rights a phone dates a day apart, received together, do not earn mastered', async () => {
    const yesterday = new Date(Date.now() - DAY - 3_600_000).toISOString();
    await send(
      who(),
      sitting('quiz', [{ outcome: IDENTITY, probe: 'probe-one-back-1', chosen: 0 }], yesterday),
      sitting('quiz', [{ outcome: IDENTITY, probe: 'probe-one-back-2', chosen: 0 }]),
    );
    await drain();
    const { rows } = await db.query<{ mastered_at: unknown; unassisted_observations: number }>(
      `select mastered_at, unassisted_observations from public.concept_state where user_id = $1 and outcome_id = $2`,
      [who(), IDENTITY],
    );
    expect(rows[0].unassisted_observations).toBe(3);
    expect(rows[0].mastered_at).toBeNull();
  });
}

const orgOf = async (user: string): Promise<string> =>
  asUser(db, user, async (tx) => (await tx.query<{ org: string }>(`select public.current_org_id() as org`)).rows[0].org);

describe('(a) a school child with homework and tutor evidence', () => {
  it('C3: one model holds both: homework on defining, the tutor’s quiz on closure', async () => {
    const { rows } = await db.query<{ source: string; n: number }>(
      `select source, count(*)::int as n from public.ledger_event where user_id = $1 and kind = 'answered' group by source order by source`,
      [kid.a],
    );
    expect(rows).toEqual([{ source: 'homework', n: 2 }, { source: 'quiz', n: 2 }]);
    const model = await tutorModel(kid.a);
    expect(model.states[DEFINE].answerObservations).toBe(2);
    expect(model.states[CLOSURE].answerObservations).toBe(2);
  });

  it('C4: the teacher’s summary counts both sources and names both wrong ideas, for this child only', async () => {
    const [row] = (await teacher.classInsights(one.s8a, one.maths)).filter((r) => r.studentUserId === kid.a);
    expect(row.answers).toBe(4);
    const likely = await teacher.classLikelyMisconceptions(one.s8a, one.maths);
    for (const label of [ZERO, ADDS]) {
      expect(likely.find((m) => m.label === label)?.children.map((c) => c.studentUserId)).toContain(kid.a);
      expect(likely.find((m) => m.label === label)?.children.map((c) => c.studentUserId)).not.toContain(kid.aTwin);
    }
  });

  it('C1: the tutor’s next activity, from the server’s model, is remedial on both; the twin’s is not', async () => {
    const next = nextFor(await tutorModel(kid.a));
    expect(next.kind).toBe('remedial');
    if (next.kind === 'remedial') expect([...next.outcomeIds].sort()).toEqual([CLOSURE, DEFINE].sort());
    expect(nextFor(await tutorModel(kid.aTwin)).kind).toBe('next');
  });

  it('C1: the next wrong answer to the idea is explained another way; the twin’s is a rethink', async () => {
    expect(nextWrongAnswer(await tutorModel(kid.a)).kind).toBe('explainAgain');
    expect(nextWrongAnswer(await tutorModel(kid.aTwin)).kind).toBe('rethink');
  });

  it('C1/C4: practice opens on a wrong idea, saying what to watch out for; the twin’s does not', async () => {
    const mine = await as(kid.a).practiceForMe('Mathematics', 5);
    expect(mine[0].reason).toBe('misconception');
    expect([ZERO, ADDS]).toContain(mine[0].watchOut);
    for (const r of await as(kid.aTwin).practiceForMe('Mathematics', 20)) expect(r.reason).not.toBe('misconception');
  });

  forgeryAndClock(() => kid.a, () => orgOf(kid.a), () => two.org);
});

describe('(b) a school child with homework only', () => {
  it('has no tutor event at all', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.ledger_event where user_id = $1 and source <> 'homework'`,
      [kid.b],
    );
    expect(rows[0].n).toBe(0);
  });

  it('C1/C4: the wrong idea on two questions is on the teacher’s list; the twin is not', async () => {
    const perChild = await teacher.classMisconceptions(one.s8a, one.maths);
    expect(perChild.filter((m) => m.label === ZERO).map((m) => m.studentUserId)).toContain(kid.b);
    expect(perChild.filter((m) => m.studentUserId === kid.bTwin)).toEqual([]);
  });

  it('C1/C4: practice opens on ZERO with what to watch out for; the twin’s does not', async () => {
    const mine = await as(kid.b).practiceForMe('Mathematics', 5);
    expect(mine[0]).toMatchObject({ reason: 'misconception', watchOut: ZERO, outcomeId: DEFINE });
    for (const r of await as(kid.bTwin).practiceForMe('Mathematics', 20)) expect(r.reason).not.toBe('misconception');
  });

  it('C1: their standing reads lower than the twin’s, from answers given alone', async () => {
    const [mine] = await as(kid.b).myProgress();
    const [twin] = await as(kid.bTwin).myProgress();
    expect(mine.unassistedObservations).toBe(2);
    expect(mine.unassistedMastery!).toBeLessThan(twin.unassistedMastery!);
    expect(standingOf(mine).word).not.toBe('Strong');
  });

  it('C3: a tutor that reads the server’s model would start with the remedial; the twin would not', async () => {
    const next = nextFor(await tutorModel(kid.b));
    expect(next.kind).toBe('remedial');
    if (next.kind === 'remedial') expect(next.outcomeIds).toEqual([DEFINE]);
    expect(nextFor(await tutorModel(kid.bTwin)).kind).toBe('next');
  });

  it('C2: homework is timed by the server: every hand-in event is stamped at its receipt', async () => {
    const { rows } = await db.query<{ same: boolean }>(
      `select e.at = e.received_at as same from public.ledger_event e where e.user_id = $1 and e.source = 'homework'`,
      [kid.b],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.same).toBe(true);
  });

  it('C2: the child cannot write the brain’s model', async () => {
    await expect(
      asUser(db, kid.b, (tx) => tx.query(`update public.concept_state set unassisted_mastery = 1 where user_id = $1`, [kid.b])),
    ).rejects.toThrow(/permission denied/);
  });

  forgeryAndClock(() => kid.b, () => orgOf(kid.b), () => two.org);
});

describe('(c) an independent tutor learner (anonymous, solo org)', () => {
  it('is in a solo org, and the brain wrote its model there', async () => {
    const org = await orgOf(kid.c);
    const { rows } = await db.query<{ kind: string }>(`select kind from public.organization where id = $1`, [org]);
    expect(rows[0].kind).toBe('solo');
    const { rows: states } = await db.query<{ org_id: string }>(
      `select distinct org_id from public.concept_state where user_id = $1`,
      [kid.c],
    );
    expect(states).toEqual([{ org_id: org }]);
  });

  it('C1: the next activity is remedial on closure; the twin’s is not', async () => {
    const next = nextFor(await tutorModel(kid.c));
    expect(next).toMatchObject({ kind: 'remedial', outcomeIds: [CLOSURE] });
    expect(nextFor(await tutorModel(kid.cTwin)).kind).toBe('next');
  });

  it('C1: the next wrong answer to the idea is explained another way; the twin’s is a rethink', async () => {
    expect(nextWrongAnswer(await tutorModel(kid.c)).kind).toBe('explainAgain');
    expect(nextWrongAnswer(await tutorModel(kid.cTwin)).kind).toBe('rethink');
  });

  it('C1/C4: review: the twin’s right answers are scheduled, and come back as review when due', async () => {
    const model = await tutorModel(kid.cTwin);
    const due = model.states[CLOSURE].nextReviewAt;
    expect(due).not.toBeNull();
    expect(Date.parse(due!)).toBeGreaterThan(Date.now());
    const later = new Date(Date.parse(due!) + 60_000).toISOString();
    expect(nextFor(model, later)).toMatchObject({ kind: 'review', outcomeIds: [CLOSURE] });
  });

  forgeryAndClock(() => kid.c, () => orgOf(kid.c), () => two.org);
});

describe('oracles (SF8)', () => {
  it('(a) no teacher or admin read returns an answer’s words', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.ledger_event where user_id = $1 and payload->>'answerNormalised' = $2`,
      [kid.a, SENTINEL],
    );
    expect(rows[0].n).toBe(2); // GUARD: the words are in the ledger
    expect(await everythingTheSchoolReads()).not.toContain(SENTINEL);
  });

  it('(c) no school read returns an independent learner', async () => {
    const all = await everythingTheSchoolReads();
    expect(all).toContain(kid.a); // GUARD: the reads do name learners
    expect(all).not.toContain(kid.c);
    expect(all).not.toContain(kid.cTwin);
  });

  it('(d) a solo account and a school account with the same parent phone stay apart', async () => {
    const phone = '+919876543210';
    for (const user of [kid.a, kid.c]) {
      await db.query(
        `insert into public.consent_record (user_id, parent_name, parent_phone, source, otp_verified_at)
         values ($1, 'Parent', $2, 'self_serve', now())`,
        [user, phone],
      );
    }
    const before = (await tutorModel(kid.a)).states[CLOSURE].answerObservations;
    expect((await send(kid.c, sitting('quiz', [{ outcome: CLOSURE, probe: 'probe-one-c1', chosen: 0 }]))).map((r) => r.status))
      .toEqual(['recorded', 'recorded']);
    await drain();
    expect((await tutorModel(kid.a)).states[CLOSURE].answerObservations).toBe(before);
    expect(await everythingTheSchoolReads()).not.toContain(kid.c);
    for (const user of [kid.a, kid.c]) {
      const { rows } = await db.query<{ org_id: string }>(
        `select distinct org_id from public.concept_state where user_id = $1`,
        [user],
      );
      expect(rows).toEqual([{ org_id: await orgOf(user) }]);
    }
    expect(await orgOf(kid.a)).toBe(one.org);
    expect(await orgOf(kid.c)).not.toBe(one.org);
  });
});

describe('C5: the loop made no model call', () => {
  it('neither fetch nor the relay was reached by writing, draining, reading or deciding', () => {
    expect(stub).toEqual({ relay: 0, fetch: 0 });
  });

  it('GUARD: the stubs are live', async () => {
    const relay = await import('@ai-tutor/relay');
    expect(() => (relay.llmRelay as unknown as () => unknown)()).toThrow(/model call/);
    expect(() => fetch('https://example.invalid')).toThrow(/network/);
    expect(stub).toEqual({ relay: 1, fetch: 1 });
  });
});
