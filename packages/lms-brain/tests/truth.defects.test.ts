// @vitest-environment node
import fs from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import {
  confirmedMisconceptions,
  emptyConceptState,
  emptyModel,
  foldHistory,
  foldSession,
  foldSessionReport,
  nextActivity,
  type ConceptState,
  type FoldSession,
  type LearnerModel,
} from '@ai-tutor/learner-model';
import * as learnerModel from '@ai-tutor/learner-model';
import { describeFactors } from '@ai-tutor/persona';
import { decide, leaks, type AskInput, type DecideHistory } from '@ai-tutor/tutor-control';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asService, asUser, createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { askHistory } from '../../../apps/classroom/src/lib/askHistory.ts';
import { chaptersEmptyText, standingOf } from '../../../apps/student/src/features/standing.ts';
import { waitingText } from '../../../apps/lms/src/features/analytics/freshness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../lms-client/src/index.ts';
import {
  handleBrain,
  libraryIndex,
  loadOutcomes,
  modelFromServer,
  think,
  thinkLearner,
  type ServerModel,
} from '../src/index.ts';

/**
 * THE TRUTH TEST'S DEFECTS, RE-RUN (lam-one-brain Task 12, review SF6).
 *
 * The 2026-10-06 truth test (workflow wf_a1a31d81-925, verdict PARTIAL) named
 * 29 defects, D01-D29. Each `it('Dnn: ...')` below is one defect this branch
 * set out to fix, asserting the behaviour the truth test expected there and
 * did not get. Where only part of a defect is fixed, the title says which
 * part, and for D04, D12, D15 and D27 an `it('Dnn open: ...')` pins what is
 * still as the truth test found it, so the scorecard
 * (docs/verify/2026-10-07-lam-one-brain-results.md) cannot overstate it.
 *
 * Not here, because this branch does not change them: D02 (the LMS lane's
 * 98167c5), D06/D17 (content), D16's data, D19 (moot once the server model is
 * the base), D25's board display (the canvas session), and D29's content
 * hygiene and early-review counting (content). D27, D28's last-active and
 * D29's dead export are Task 13's (the last describe).
 *
 * Real migrations on PGlite, the real fold, the real RPCs and decisions; no
 * model call.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const IDENTITY = 'class8-mathematics-rational-numbers-additive-identity';
const ASSOCIATIVE = 'class8-mathematics-rational-numbers-associative-addition';
const ZERO = 'thinks the denominator may be zero';
const ADDS = 'adds the numerators and the denominators';
const SCATTERED = [
  'confuses numerator with denominator',
  'believes every fraction is less than one',
  'treats negative signs as subtraction',
  'ignores the sign of zero',
  'reads a decimal point as a comma',
  'multiplies instead of dividing',
];
const DAY = 86_400_000;

let db: PGlite;
let one: School;
let teacher: LmsClient;
let homework = '';
const item: Record<string, string> = {};
const kid: Record<string, string> = {};

const as = (user: string) => createLmsClient(pgliteTransport(db, user));
const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

async function bankItem(ref: string, outcome: string, label: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ($1, $2, 8, 'Mathematics', 'mcq', $1, '["right","wrong one","wrong two"]'::jsonb, 0, $3::jsonb)
     returning id`,
    [ref, [outcome], JSON.stringify(['', label, ''])],
  );
  item[ref] = rows[0].id;
  return rows[0].id;
}

/** A child of the school in 8A. */
async function child(name: string): Promise<string> {
  const user = await seat(db, one.org, 'student', `TRU-${Object.keys(kid).length + 200}`, name);
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
     values ($1, $2, $3, $4, $5)`,
    [one.org, one.year, one.s8a, user, String(Object.keys(kid).length + 50)],
  );
  kid[name] = user;
  return user;
}

interface Answer {
  outcome: string;
  probe: string;
  chosen?: number;
  correct?: boolean;
  rung?: number;
  attempt?: number;
}

/** One tutor sitting as the phone sends it. */
function sitting(source: string, answers: Answer[], at = new Date().toISOString()) {
  const id = crypto.randomUUID();
  return {
    session: { id, source, startedAt: at },
    events: [
      { id: crypto.randomUUID(), sessionId: id, seq: 0, at, kind: 'session-started', source, surface: 'tap', outcomeIds: [], payload: {} },
      ...answers.map((a, n) => {
        const chosen = a.chosen ?? (a.correct === false ? 1 : 0);
        return {
          id: crypto.randomUUID(), sessionId: id, seq: n + 1, at, kind: 'answered', source, surface: 'tap',
          outcomeIds: [a.outcome],
          payload: {
            correct: a.correct ?? chosen === 0, chosenIndex: chosen, probeId: a.probe, ms: 4000,
            attempt: a.attempt ?? 1, assistanceRung: a.rung ?? 0, hintsShown: 0,
          },
        };
      }),
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

/** A sitting the server received at `receivedAt`, written by the database owner (the past cannot be sent today). */
async function receivedAt(user: string, source: string, at: string, payloads: { outcome: string; payload: object }[]): Promise<void> {
  const org = (await db.query<{ org: string }>(`select public.org_of($1) as org`, [user])).rows[0].org;
  const session = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at) values ($1, $2, $3, $4, $5, $5)`,
    [session, org, user, source, at],
  );
  for (const [n, p] of payloads.entries()) {
    await db.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $5, 'answered', $6, 'tap', $7, $8::jsonb)`,
      [org, user, session, n + 1, at, source, [p.outcome], JSON.stringify(p.payload)],
    );
  }
}

async function tutorModel(user: string): Promise<LearnerModel> {
  const server = await asUser(db, user, async (tx) =>
    (await tx.query<{ m: ServerModel }>(`select public.my_learner_model() as m`)).rows[0].m,
  );
  return modelFromServer(server);
}

type Row = Record<string, unknown>;
const stateOf = async (user: string, outcome: string): Promise<Row | undefined> =>
  (
    await db.query<{ row: Row }>(
      `select to_jsonb(cs) - 'updated_at' as row from public.concept_state cs where user_id = $1 and outcome_id = $2`,
      [user, outcome],
    )
  ).rows[0]?.row;
const allStates = async (user: string): Promise<Row[]> =>
  (
    await db.query<{ row: Row }>(
      `select to_jsonb(cs) - 'updated_at' as row from public.concept_state cs where user_id = $1 order by outcome_id`,
      [user],
    )
  ).rows.map((r) => r.row);

const ASK: AskInput = {
  question: 'Is 1/2 + 1/3 a rational number, and what is it?',
  expect: '5/6',
  options: [
    { text: '5/6', correct: true, why: 'Make the denominators the same, then add the numerators.' },
    { text: ADDS, correct: false, why: 'Adding the denominators changes the size of the pieces.' },
  ],
  alternates: [{ mode: 'everyday', say: 'Half a roti and a third of a roti: cut both into sixths first, then count the pieces.' }],
};
const wrongWith = (history?: DecideHistory) =>
  decide({ verdict: 'wrong', attempt: 1, rungSoFar: 0, ask: ASK, matchedOption: 1, history, lang: 'en', now: 0 });

const nextFor = (model: LearnerModel, next: string[] = [], now = new Date().toISOString()) =>
  nextActivity({ model, index: libraryIndex(), now, next: { outcomeIds: next } });

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'TRU');
  teacher = as(one.teacherA);
  for (const n of [1, 2, 3, 4]) await bankItem(`probe-td-z${n}`, DEFINE, ZERO);
  for (const [n, label] of SCATTERED.entries()) await bankItem(`probe-td-s${n}`, DEFINE, label);
  for (const n of [1, 2, 3]) await bankItem(`probe-td-a${n}`, CLOSURE, ADDS);
  await bankItem('probe-td-c1', CLOSURE, '');
  for (const id of Object.values(item)) await teacher.approveItem(id);

  // One homework for 8A on z1 and z2: a repeat (wrong on both), a slip (wrong on one), a right twin.
  for (const name of ['repeat', 'slip', 'right', 'clears']) await child(name);
  homework = await teacher.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title: 'Rational numbers',
    dueAt: new Date(Date.now() + DAY).toISOString(), answerTypes: ['mcq'],
  });
  const [z1, z2] = [item['probe-td-z1'], item['probe-td-z2']];
  await teacher.setAssignmentItems(homework, [z1, z2]);
  await teacher.publishAssignment(homework);
  await as(kid.repeat).submitMcq(homework, { [z1]: 1, [z2]: 1 });
  await as(kid.clears).submitMcq(homework, { [z1]: 1, [z2]: 1 });
  await as(kid.slip).submitMcq(homework, { [z1]: 1, [z2]: 0 });
  await as(kid.right).submitMcq(homework, { [z1]: 0, [z2]: 0 });
  await db.query(`update lms.assignment set due_at = now() - interval '1 hour' where id = $1`, [homework]);
  await think(db, [kid.repeat, kid.clears, kid.slip, kid.right]);
});
afterAll(async () => {
  await db.close();
});

describe('M2: one trusted brain', () => {
  it('D01: an answer queues its learner, and one brain run, called as the function is, writes their model', async () => {
    const learner = await createUser(db);
    expect((await send(learner, sitting('quiz', [{ outcome: CLOSURE, probe: 'probe-td-c1' }]))).map((r) => r.status))
      .toEqual(['recorded', 'recorded']);
    const queued = await db.query(`select 1 from public.brain_queue where user_id = $1`, [learner]);
    expect(queued.rows).toHaveLength(1);
    const lines: string[] = [];
    const answer = await handleBrain({ method: 'POST', secret: 'td-secret' }, { db, secret: 'td-secret', log: (l) => lines.push(l) });
    expect(answer.status).toBe(200);
    expect(await stateOf(learner, CLOSURE)).toMatchObject({ answer_observations: 1 });
    expect((await db.query(`select 1 from public.brain_queue where user_id = $1`, [learner])).rows).toHaveLength(0);
    // graph.ts builds the fold's graph from imported JSON (MF12); tests/brain-function.test.ts walks every module the function reaches.
    const graph = fs.readFileSync(new URL('../src/graph.ts', import.meta.url), 'utf8');
    expect(graph).not.toMatch(/from 'node:/);
  });

  it('D03: a homework fact only on the server reaches the tutor: its next activity is remedial on it', async () => {
    const next = nextFor(await tutorModel(kid.repeat));
    expect(next).toMatchObject({ kind: 'remedial', outcomeIds: [DEFINE] });
    expect(nextFor(await tutorModel(kid.right)).kind).toBe('next');
  });

  it('D04 (fixed part): a child’s token cannot write the ledger directly, nor send a source only the LMS writes', async () => {
    const forger = await child('forger');
    await expect(
      asUser(db, forger, (tx) =>
        tx.query(
          `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
           values (gen_random_uuid(), $1, $2, gen_random_uuid(), 1, now(), '2099-01-01', 'answered', 'quiz', 'tap', $3, '{"correct":true,"assistanceRung":0}'::jsonb)`,
          [one.org, forger, [DEFINE]],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    for (const source of ['api', 'homework', 'test', 'practice']) {
      const receipts = await send(forger, sitting(source, [{ outcome: DEFINE, probe: `probe-td-forge-${source}` }]));
      expect(receipts.every((r) => r.status === 'refused' && r.reason === 'source')).toBe(true);
    }
    const { rows } = await db.query(`select 1 from public.ledger_event where user_id = $1`, [forger]);
    expect(rows).toEqual([]);
  });

  it('D04 open: a tutor answer’s correctness is still the phone’s word', async () => {
    // MF4: record_evidence does not grade tutor answers. Six rights a phone
    // claims on questions it never asked still lift the figure a teacher sees.
    const claimant = await child('claimant');
    await send(claimant, sitting('quiz', Array.from({ length: 6 }, (_, n) => ({ outcome: IDENTITY, probe: `probe-td-claim-${n}` }))));
    await think(db, [claimant]);
    expect(Number((await stateOf(claimant, IDENTITY))?.unassisted_mastery)).toBeGreaterThan(0.9);
  });

  it('D05 (server part): the same answers read the same on the server whatever the phone’s clock said', async () => {
    const honest = await createUser(db);
    const clock2099 = await createUser(db);
    const answers: Answer[] = [
      { outcome: CLOSURE, probe: 'probe-td-a1', correct: false },
      { outcome: CLOSURE, probe: 'probe-td-c1' },
      { outcome: CLOSURE, probe: 'probe-td-a2', correct: false },
    ];
    await send(honest, sitting('quiz', answers.slice(0, 1)), sitting('quiz', answers.slice(1)));
    await send(clock2099, sitting('quiz', answers.slice(0, 1), '2099-01-01T00:00:00.000Z'), sitting('quiz', answers.slice(1)));
    const { rows } = await db.query<{ ahead: boolean }>(
      `select bool_or(at > received_at + interval '5 minutes') as ahead from public.ledger_event where user_id = $1`,
      [clock2099],
    );
    expect(rows[0].ahead).toBe(false);
    await think(db, [honest, clock2099]);
    const pick = (r: Row | undefined) => ({
      unassisted: r?.unassisted_mastery,
      cold: r?.unassisted_observations,
      answers: r?.answer_observations,
    });
    expect(pick(await stateOf(clock2099, CLOSURE))).toEqual(pick(await stateOf(honest, CLOSURE)));
    expect(pick(await stateOf(honest, CLOSURE)).answers).toBe(3);
  });

  it('D20: shuffled or late delivery on the phone loses nothing: it is folded or reported, and the rebuild equals the sorted fold', () => {
    const node = (id: string, prerequisites: string[]) => ({
      id, klass: 10, subject: 'Science', chapter: 'ch1', title: id, outcome: `can do ${id}`, prerequisites,
      difficulty: 2, topicRef: 'class10-science/ch1/t1',
    });
    const index = new GraphIndex({ version: 1, nodes: [node('a', []), node('b', ['a'])] } as never);
    const params = emptyParams();
    const sittings: FoldSession[] = [1, 2, 3].map((d) => ({ id: `s${d}`, startedAt: `2026-09-1${d}T10:00:00.000Z` }));
    const events: LedgerEvent[] = sittings.flatMap((s, i) =>
      Array.from({ length: 6 }, (_, seq) => ({
        id: `${s.id}-e${seq}`, sessionId: s.id, seq, at: s.startedAt, kind: 'answered', source: 'class', surface: 'tap',
        outcomeIds: [seq % 2 ? 'a' : 'b'],
        payload: { correct: (seq + i) % 3 !== 0, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: 0, probeId: `${s.id}-p${seq}` },
      }) as unknown as LedgerEvent),
    );
    const sorted = foldHistory(sittings, events, index, params).model;
    // Chunks of two, delivered in a fixed shuffled order, each to its own sitting.
    const chunks = Array.from({ length: events.length / 2 }, (_, n) => events.slice(n * 2, n * 2 + 2));
    const order = [7, 2, 0, 8, 5, 1, 4, 6, 3];
    let model = emptyModel();
    let rebuild = false;
    let skipped = 0;
    for (const n of order) {
      const chunk = chunks[n];
      const r = foldSessionReport(model, sittings.find((s) => s.id === chunk[0].sessionId)!, chunk, index, params);
      model = r.model;
      rebuild ||= r.needsRebuild;
      skipped += r.skipped;
    }
    // Every event is in the model or reported as skipped: none is lost in silence.
    expect(sorted.states.a.observations + sorted.states.b.observations).toBe(18);
    expect(model.states.a.observations + model.states.b.observations + skipped).toBe(18);
    expect(rebuild).toBe(true);
    // The rebuild the report asks for, from the history in the order it arrived, is the sorted fold.
    const delivered = order.flatMap((n) => chunks[n]);
    const healed = foldHistory([...sittings].reverse(), delivered, index, params).model;
    expect(healed.states).toEqual(sorted.states);
  });

  it('D20: a redelivered older sitting leaves the live sitting its help', () => {
    const node = (id: string) => ({
      id, klass: 10, subject: 'Science', chapter: 'ch1', title: id, outcome: id, prerequisites: [], difficulty: 2,
      topicRef: 'class10-science/ch1/t1',
    });
    const index = new GraphIndex({ version: 1, nodes: [node('a'), node('b')] } as never);
    const params = emptyParams();
    const S1: FoldSession = { id: 's1', startedAt: '2026-09-14T10:00:00.000Z' };
    const S2: FoldSession = { id: 's2', startedAt: '2026-09-15T10:00:00.000Z' };
    const ev = (s: FoldSession, seq: number, kind: string, ids: string[], payload: object) =>
      ({ id: `${s.id}-e${seq}`, sessionId: s.id, seq, at: s.startedAt, kind, source: 'class', surface: 'tap', outcomeIds: ids, payload }) as unknown as LedgerEvent;
    const old = [ev(S1, 0, 'answered', ['a'], { correct: true, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0 })];
    let m = foldSession(emptyModel(), S1, old, index, params);
    m = foldSession(m, S2, [ev(S2, 0, 'helped', ['b'], { beatId: 'B3', rung: 5, requested: false })], index, params);
    m = foldSession(m, S1, old, index, params);
    m = foldSession(m, S2, [ev(S2, 1, 'answered', ['b'], { correct: true, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, beatId: 'B3' })], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
  });

  it('D22 (fixed part): one learner’s think is one transaction: a failed run leaves the last good model, and a rerun changes nothing', async () => {
    const before = await allStates(kid.repeat);
    await expect(
      db.transaction(async (tx) => {
        await thinkLearner(tx, kid.repeat, { rebuild: true });
        await tx.query(`delete from public.concept_state where user_id = $1`, [kid.repeat]);
        throw new Error('the run fails after writing');
      }),
    ).rejects.toThrow(/fails after writing/);
    expect(await allStates(kid.repeat)).toEqual(before);
    await think(db, [kid.repeat], { rebuild: true });
    expect(await allStates(kid.repeat)).toEqual(before);
  });

  it('D23 (fixed part): time on task is bounded by the sitting, and a sitting cannot end before it starts', async () => {
    const learner = await createUser(db);
    const s = sitting('class', []);
    await send(learner, s);
    await asUser(db, learner, (tx) =>
      tx.query(`select public.close_learning_session($1, $2, $3)`, [s.session.id, '2000-01-01T00:00:00Z', 2_147_483_000]),
    );
    const { rows } = await db.query<{ ordered: boolean; within: boolean }>(
      `select ended_at >= started_at as ordered,
              active_ms <= extract(epoch from (ended_at - started_at)) * 1000 as within
         from public.learning_session where id = $1`,
      [s.session.id],
    );
    expect(rows[0]).toEqual({ ordered: true, within: true });
  });

  it('D28 (fixed part): no api source, no squatting another learner’s sitting, no recount of a replayed event', async () => {
    const owner = await createUser(db);
    const squatter = await createUser(db);
    const mine = sitting('quiz', [{ outcome: CLOSURE, probe: 'probe-td-c1' }]);
    await send(owner, mine);
    const squat = sitting('quiz', [{ outcome: CLOSURE, probe: 'probe-td-c1' }]);
    squat.events = squat.events.map((e) => ({ ...e, id: crypto.randomUUID(), sessionId: mine.session.id, seq: e.seq + 10 }));
    expect((await send(squatter, squat)).map((r) => r.reason)).toEqual(['not-your-session', 'not-your-session']);
    // The same event id again under a new seq.
    const replay = { session: mine.session, events: [{ ...mine.events[1], seq: 7 }] };
    expect((await send(owner, replay)).map((r) => r.status)).not.toContain('recorded');
    await think(db, [owner]);
    expect(await stateOf(owner, CLOSURE)).toMatchObject({ answer_observations: 1 });
    expect((await send(owner, sitting('api', [{ outcome: CLOSURE, probe: 'x' }])))[0]).toMatchObject({ status: 'refused', reason: 'source' });
  });
});

describe('M1: the model and its decisions', () => {
  it('D07: the server folds with the tutor’s arithmetic: version 4, help discounted, a retry not cold, every v4 field kept', async () => {
    const helped = await createUser(db);
    const alone = await createUser(db);
    const retried = await createUser(db);
    const three = (rung: number, attempt = 1) =>
      [0, 1, 2].map((n) => ({ outcome: CLOSURE, probe: `probe-td-v4-${n}`, rung, attempt }));
    await send(helped, sitting('class', three(7)));
    await send(alone, sitting('class', three(0)));
    await send(retried, sitting('quiz', three(0, 2)));
    await think(db, [helped, alone, retried]);
    const h = (await stateOf(helped, CLOSURE))!;
    const a = (await stateOf(alone, CLOSURE))!;
    expect(Number(h.mastery)).toBeLessThan(Number(a.mastery));
    expect(h.unassisted_observations).toBe(0);
    expect((await stateOf(retried, CLOSURE))?.unassisted_observations).toBe(0);
    for (const column of ['mastered_at', 'cold_wins', 'box', 'last_exposed_at', 'last_retrieved_at', 'misconceptions']) {
      expect(a).toHaveProperty(column);
    }
    expect(a.box).not.toBeNull();
    const { rows } = await db.query<{ version: number }>(`select version from public.learner_model where user_id = $1`, [alone]);
    expect(rows[0].version).toBe(4);
  });

  it('D08: thirty rights carried by help read "with help", to the child and to the teacher, never Strong', async () => {
    const helped = await child('helped');
    for (let s = 0; s < 3; s++) {
      await send(helped, sitting('class', Array.from({ length: 10 }, (_, n) => ({ outcome: DEFINE, probe: `probe-td-h-${s}-${n}`, rung: 7 }))));
    }
    await think(db, [helped]);
    const [mine] = await as(helped).myProgress();
    expect(mine.unassistedObservations).toBe(0);
    expect(standingOf(mine).word).toBe('Getting there (with help)');
    const [seen] = (await teacher.classInsights(one.s8a, one.maths)).filter((r) => r.studentUserId === helped);
    expect(seen.unassistedMastery).toBeNull();
    expect(standingOf(seen).word).toBe('Getting there (with help)');
  });

  it('D09: the same wrong idea six times and six scattered wrong answers make different models', async () => {
    const same = await createUser(db);
    const scattered = await createUser(db);
    await send(same, sitting('quiz', [1, 2, 3].map((n) => ({ outcome: DEFINE, probe: `probe-td-z${n}`, chosen: 1 }))));
    await send(same, sitting('quiz', [1, 2, 3].map((n) => ({ outcome: DEFINE, probe: `probe-td-z${n}`, chosen: 1 }))));
    await send(scattered, sitting('quiz', SCATTERED.map((_, n) => ({ outcome: DEFINE, probe: `probe-td-s${n}`, chosen: 1 }))));
    await think(db, [same, scattered]);
    const a = (await tutorModel(same)).states[DEFINE];
    const b = (await tutorModel(scattered)).states[DEFINE];
    expect(a.unassistedObservations).toBe(b.unassistedObservations);
    expect(a.misconceptions).not.toEqual(b.misconceptions);
    expect(confirmedMisconceptions(a).map((m) => m.label)).toEqual([ZERO]);
    expect(confirmedMisconceptions(b)).toEqual([]);
  });

  it('D10: the teacher’s list has a repeat rule and clears: a slip is not listed, a two-question repeat is, until two later rights', async () => {
    const children = async (label: string) =>
      (await teacher.classLikelyMisconceptions(one.s8a, one.maths)).find((m) => m.label === label)?.children.map((c) => c.studentUserId) ?? [];
    expect(await children(ZERO)).toContain(kid.repeat);
    expect(await children(ZERO)).toContain(kid.clears);
    expect(await children(ZERO)).not.toContain(kid.slip);
    // Two later cold rights on distinct questions of the outcome, from the tutor.
    await send(kid.clears, sitting('quiz', [{ outcome: DEFINE, probe: 'probe-td-z3' }, { outcome: DEFINE, probe: 'probe-td-z4' }]));
    await think(db, [kid.clears]);
    expect(await children(ZERO)).not.toContain(kid.clears);
    expect(await children(ZERO)).toContain(kid.repeat);
  });

  it('D11 (fixed part): a wrong answer to an idea shown before is not met as a first miss', () => {
    // decide.ts onWrong used to replay "first miss" on the seventh identical one.
    expect(wrongWith().kind).toBe('rethink');
    expect(wrongWith({ repeatedMisconception: ADDS }).kind).toBe('explainAgain');
  });

  it('D12 (fixed part): one lucky right is not "they already hold this"; the mastery rule is', () => {
    const lucky = describeFactors({ klass: 8, mastery: 0.98, mastered: false }).join(' ');
    const held = describeFactors({ klass: 8, mastery: 0.98, mastered: true }).join(' ');
    expect(lucky).not.toContain('They already hold this');
    expect(held).toContain('They already hold this');
  });

  it('D12 open: one question answered right six times still lifts belief without mastering', async () => {
    const repeater = await createUser(db);
    await send(repeater, sitting('quiz', Array.from({ length: 6 }, () => ({ outcome: IDENTITY, probe: 'probe-td-one-item' }))));
    await think(db, [repeater]);
    const s = (await stateOf(repeater, IDENTITY))!;
    expect(Number(s.unassisted_mastery)).toBeGreaterThan(0.9);
    expect(s.mastered_at).toBeNull();
  });

  it('D13: school homework on two distinct items a day apart earns mastered', async () => {
    const learner = await child('homework-master');
    const right = (ref: string) => ({
      outcome: DEFINE,
      payload: { correct: true, chosenIndex: 0, itemId: item[ref], attempt: 1, assistanceRung: 0 },
    });
    await receivedAt(learner, 'homework', ago(25), [right('probe-td-z3')]);
    await receivedAt(learner, 'homework', ago(0), [right('probe-td-z4')]);
    await think(db, [learner]);
    expect((await stateOf(learner, DEFINE))?.mastered_at).not.toBeNull();
  });

  it('D14: practice is picked from the child’s own evidence: the repeat’s opens on the idea, the right twin’s does not', async () => {
    const mine = await as(kid.repeat).practiceForMe('Mathematics', 5);
    expect(mine[0]).toMatchObject({ reason: 'misconception', watchOut: ZERO, outcomeId: DEFINE });
    for (const r of await as(kid.right).practiceForMe('Mathematics', 20)) expect(r.reason).not.toBe('misconception');
  });

  it('D15 (fixed part): practising a question again after its answer was shown is not cold evidence', async () => {
    const learner = await child('practiser');
    const c1 = item['probe-td-c1'];
    await as(learner).checkPracticeAnswer(crypto.randomUUID(), c1, 1); // wrong: the key is shown
    await as(learner).checkPracticeAnswer(crypto.randomUUID(), c1, 0);
    await think(db, [learner]);
    expect(await stateOf(learner, CLOSURE)).toMatchObject({ answer_observations: 2, unassisted_observations: 1 });
  });

  it('D15 open: a homework retry is read as a fresh cold hand-in', async () => {
    // rung.ts atLeastANudge: on the school's sources `attempt` numbers the hand-in.
    const learner = await createUser(db);
    await receivedAt(learner, 'homework', ago(1), [
      { outcome: IDENTITY, payload: { correct: false, chosenIndex: 1, itemId: item['probe-td-c1'], attempt: 1, assistanceRung: 0 } },
    ]);
    await receivedAt(learner, 'homework', ago(0), [
      { outcome: IDENTITY, payload: { correct: true, chosenIndex: 0, itemId: item['probe-td-c1'], attempt: 2, assistanceRung: 0 } },
    ]);
    await think(db, [learner]);
    expect((await stateOf(learner, IDENTITY))?.unassisted_observations).toBe(2);
  });

  it('D16 (code part): a prerequisite three hops down is found, and an unexamined one is checked first', async () => {
    const deep = await createUser(db);
    await send(deep, sitting('quiz', [{ outcome: DEFINE, probe: 'probe-td-deep', correct: false }]));
    const stuck = await createUser(db);
    await send(stuck, sitting('quiz', [{ outcome: CLOSURE, probe: 'probe-td-st1', correct: false }, { outcome: CLOSURE, probe: 'probe-td-st2', correct: false }]));
    await think(db, [deep, stuck]);
    // associative-addition <- commutative-addition <- closure-addition <- define-rational-number
    expect(nextFor(await tutorModel(deep), [ASSOCIATIVE])).toMatchObject({ kind: 'prerequisite', outcomeId: DEFINE });
    expect(nextFor(await tutorModel(stuck))).toMatchObject({ kind: 'check-prerequisite', outcomeId: DEFINE });
  });

  it('D18 (fixed part): the server schedules review, and the student’s practice opens on it when it comes due', async () => {
    const s = (await stateOf(kid.right, DEFINE))!;
    expect(s.box).not.toBeNull();
    expect(s.next_review_at).not.toBeNull();
    // Time passes until the review is due.
    await db.query(
      `update public.concept_state set next_review_at = now() - interval '1 hour' where user_id = $1 and outcome_id = $2`,
      [kid.right, DEFINE],
    );
    expect((await as(kid.right).practiceForMe('Mathematics', 5))[0]).toMatchObject({ reason: 'review', outcomeId: DEFINE });
  });

  it('D21: the 90-day purge deletes old answers by age and the model keeps what they taught', async () => {
    const learner = await createUser(db);
    const right = (ref: string) => ({
      outcome: DEFINE,
      payload: { correct: true, chosenIndex: 0, probeId: ref, attempt: 1, assistanceRung: 0 },
    });
    await receivedAt(learner, 'quiz', ago(100 * 24), [right('probe-td-z1'), right('probe-td-z2')]);
    await receivedAt(learner, 'quiz', ago(99 * 24), [right('probe-td-z3')]);
    await think(db, [learner]);
    const earned = (await stateOf(learner, DEFINE))!;
    expect(earned.mastered_at).not.toBeNull();
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect((await db.query(`select 1 from public.ledger_event where user_id = $1`, [learner])).rows).toEqual([]);
    await receivedAt(learner, 'quiz', ago(0), [{ outcome: CLOSURE, payload: right('probe-td-c1').payload }]);
    await think(db, [learner]);
    const kept = (await stateOf(learner, DEFINE))!;
    expect(kept.mastered_at).toBe(earned.mastered_at);
    expect(kept.unassisted_observations).toBe(earned.unassisted_observations);
  });

  it('D24 (fixed part): wheel-spinning and asking before trying change the next move', async () => {
    const spinner = await createUser(db);
    await send(spinner, sitting('quiz', [1, 2, 3].map((n) => ({ outcome: CLOSURE, probe: `probe-td-spin-${n}`, correct: false }))));
    await think(db, [spinner]);
    const history = askHistory({ model: await tutorModel(spinner), outcomeIds: [CLOSURE], sessionId: 'this-sitting' });
    expect(history.wheelSpin).toBe(true);
    expect(wrongWith(history).kind).not.toBe(wrongWith().kind);
    const pulled = decide({ verdict: 'hintRequest', attempt: 0, rungSoFar: 0, ask: ASK, history: { hintAbuse: true }, lang: 'en', now: 0 });
    const plain = decide({ verdict: 'hintRequest', attempt: 0, rungSoFar: 0, ask: ASK, lang: 'en', now: 0 });
    expect(pulled).toMatchObject({ kind: 'nudge', helped: null });
    expect(plain.helped).not.toBeNull();
  });

  it('D25 (fixed part): a due outcome failed cold is remedial; a due outcome held is maintenance review', () => {
    const at = '2026-09-01T10:00:00.000Z';
    const due = { box: 1, nextReviewAt: '2026-09-02T10:00:00.000Z', unassistedObservations: 2 };
    const failed: ConceptState = { ...emptyConceptState(DEFINE), ...due, unassistedMastery: 0.1 };
    const held: ConceptState = {
      ...emptyConceptState(IDENTITY), ...due, unassistedMastery: 0.95, lastUnassistedSuccessAt: at, masteredAt: at,
    };
    const now = '2026-09-10T10:00:00.000Z';
    const both: LearnerModel = { ...emptyModel(), states: { [DEFINE]: failed, [IDENTITY]: held } };
    expect(nextFor(both, [], now)).toMatchObject({ kind: 'remedial', outcomeIds: [DEFINE] });
    const heldOnly: LearnerModel = { ...emptyModel(), states: { [IDENTITY]: held } };
    expect(nextFor(heldOnly, [], now)).toMatchObject({ kind: 'review', outcomeIds: [IDENTITY] });
  });

  it('D26: answers the brain has not read say "being worked out", not "no answers yet", to the child and the teacher', async () => {
    const waiting = await child('waiting');
    await send(waiting, sitting('quiz', [{ outcome: CLOSURE, probe: 'probe-td-c1' }]));
    const status = await teacher.brainStatus(waiting);
    expect(status?.waitingSince).not.toBeNull();
    expect(chaptersEmptyText(status)).toBe('Checking your answers, back in a few minutes.');
    const cls = await teacher.classBrainStatus(one.s8a, one.maths);
    expect(cls?.studentsWaiting).toBeGreaterThan(0);
    expect(waitingText(cls, Date.parse(cls!.waitingSince!) + 60_000)).toMatch(/^Answers are in from \d+ students?\. /);
  });
});

describe('Task 13: small leftovers', () => {
  const FOUR: AskInput = { question: 'How many corners does a square have?', expect: '4', hint: 'Dekho, iske chaar kone hain.' };

  it('D27 (fixed part): a Hinglish hint that says the answer as a Hindi number is not said', () => {
    const hinglish = decide({ verdict: 'wrong', attempt: 2, rungSoFar: 1, ask: FOUR, lang: 'hi-en', now: 0 });
    expect(hinglish.kind).not.toBe('hint');
    expect(hinglish.say ?? '').not.toContain('chaar');
    expect(leaks('char hai', ['4'], 'hi-en')).toBe(true);
  });

  it('D27 open: arithmetic that comes to the answer still passes the leak check', () => {
    expect(leaks('8 divided by 2', ['4'], 'hi-en')).toBe(false);
    expect(leaks('2 squared', ['4'], 'hi-en')).toBe(false);
  });

  it('D28 (last active): the school’s student list reads when the server received an answer, not the phone’s clock', async () => {
    const late = await child('late');
    const received = new Date(Date.now() - 2 * 3_600_000);
    const session = crypto.randomUUID();
    await db.query(
      `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
       values ($1, $2, $3, 'class', '2099-01-01T00:00:00Z', $4)`,
      [session, one.org, late, received.toISOString()],
    );
    await db.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface)
       values (gen_random_uuid(), $1, $2, $3, 0, '2099-01-01T00:00:00Z', $4, 'answered', 'class', 'tap')`,
      [one.org, late, session, received.toISOString()],
    );
    const [row] = (await as(one.admin).schoolStudents(one.s8a)).filter((r) => r.userId === late);
    expect(Date.parse(row.lastActive!)).toBe(received.getTime());
  });

  it('D29 (dead export): chooseAsk, which nothing called, is gone from the learner model', () => {
    expect('chooseAsk' in learnerModel).toBe(false);
  });
});
