import { addParentForAdmin } from './import.ts';
import fs from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../../packages/lms-client/src/index.ts';
import { applyPlan, type CreatedAccount } from '../../lms-import/src/apply.ts';
import { pgliteStore } from '../../lms-import/src/pgliteStore.ts';
import { planImport, type SchoolConfig } from '../../lms-import/src/plan.ts';
import { readStudents, readTeachers } from '../../lms-import/src/sheet.ts';
import { libraryItems, loadBanks, type LibraryItem } from '../../lms-library/src/library.ts';
import { drainBrainQueue, loadOutcomes } from '../../../packages/lms-brain/src/index.ts';
import { setPin } from './auth.ts';
import { demoLogoPng } from './logo.ts';

/**
 * The demo school, built the way a real one will be and given a month of
 * made-up but plausible history.
 *
 *   1. People: data/students.csv and data/teachers.csv, fictional names,
 *      headed as a school's own sheets often are ("Roll No.", "Student
 *      Name", "Classes and Subjects"), run through the real import
 *      (sheet → plan → applyPlan). 82 students in
 *      6A, 7A, 8A and 8B; four teachers; one admin. Then the school's look,
 *      and a pilot licence of 90 seats (0041).
 *   2. Questions: Qrie's library, all of it unless `libraryPerClass` cuts it
 *      (the tests do, for speed).
 *   3. Homework: each teacher, through the same API the teacher app calls,
 *      approves questions and sets two past homeworks and one current one
 *      per class; Neha Sharma (DEMO-T01) also has a draft, and Imran Khan
 *      (DEMO-T02) a photo homework. Dates are then moved back in time.
 *   4. Answers: each student, through the API the student app calls, hands
 *      in most past homework and some current, right or wrong by a simple
 *      ability model. A few hand in late; some do not hand in at all.
 *   5. PLANTED MISCONCEPTIONS. A handful of students answer EVERY question on
 *      one chapter wrong, picking the distractor whose misconception label
 *      names the error, then practise that chapter and choose the same
 *      wrong options again. They are returned as `planted` and written beside the
 *      logins, so that when the brain (L6) says who is stuck on what, it can
 *      be checked against a known answer instead of admired.
 *   7. One of each other kind of work — written work as a checklist, an
 *      online test tomorrow, a test on paper with marks, a project — and
 *      the school's events (0029). Run before the brain, but none of it
 *      reaches the ledger: ticks and paper marks are not answers.
 *   6. The brain (packages/lms-brain) folds every student's answers into
 *      concept_state: every answer put its student on public.brain_queue
 *      (0108), and the seed drains the whole queue, as the demo server does
 *      after each hand-in. It is given the ledger only, never the planted
 *      list. It runs before step 12, whose practice goes to the children it
 *      finds.
 *
 * Only step 4's timestamps, and the dates in step 3, are written directly
 * (as the database owner); everything else goes through the real paths.
 * The ledger rows each answer writes are moved back in time with it.
 */

export const DEMO_SCHOOL: SchoolConfig = {
  code: 'DEMO',
  displayName: 'Qrie Demo School',
  shortName: 'Qrie Demo',
  board: 'CBSE',
  year: { label: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31' },
};

export interface Planted {
  loginId: string;
  name: string;
  className: string;
  subject: string;
  /** The chapter, as the knowledge graph names it. */
  topic: string;
  /** The outcomes of that chapter among the loaded questions: where the brain should find the error. */
  outcomeIds: string[];
  why: string;
}

export interface Seeded {
  orgId: string;
  logins: CreatedAccount[];
  planted: Planted[];
}

export interface SeedOptions {
  /** Keep only the first N library questions of each grade and subject. */
  libraryPerClass?: number;
}

const DATA = new URL('../data/', import.meta.url);
const DAY = 86_400_000;
const DEMO_COLOUR = '#0e7490';
const DEMO_ACCENT = '#fb923c';

// Which students carry a planted misconception: class, subject, which of the
// class's homeworks sets the chapter, and roll numbers.
const PLANTS = [
  { grade: 8, section: 'A', subject: 'Mathematics', homework: 0, rolls: ['5', '9', '14', '20'] },
  { grade: 8, section: 'B', subject: 'Mathematics', homework: 1, rolls: ['6', '11'] },
  { grade: 8, section: 'A', subject: 'Science', homework: 0, rolls: ['8', '16'] },
];

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Item extends LibraryItem {
  id: string;
  chapter: string;
  difficulty: number;
}

interface Homework {
  id: string;
  items: Item[];
  publishedAt: number;
  dueAt: number;
  current: boolean;
}

export async function seedDemoSchool(db: PGlite, opts: SeedOptions = {}): Promise<Seeded> {
  const rand = mulberry32(20260927);
  const now = Date.now();

  // 1. People -----------------------------------------------------------------
  const students = readStudents(fs.readFileSync(new URL('students.csv', DATA), 'utf8'));
  const teachers = readTeachers(fs.readFileSync(new URL('teachers.csv', DATA), 'utf8'));
  const errors = [...students.errors, ...teachers.errors];
  if (errors.length) throw new Error(`the demo sheets do not read:\n${errors.join('\n')}`);
  const imported = await applyPlan(planImport(DEMO_SCHOOL, students.students, teachers.teachers), pgliteStore(db));
  for (const a of imported.created) await setPin(db, a.loginId, a.userId, a.pin);
  const orgId = (await db.query<{ org_id: string }>(`select org_id from lms.school where code = $1`, [DEMO_SCHOOL.code]))
    .rows[0].org_id;

  // The school's look (0031, 0032), set by its admin as a real school would.
  const office = createLmsClient(pgliteTransport(db, imported.created.find((a) => a.kind === 'admin')!.userId));
  await office.setSchoolBrand({ primary: DEMO_COLOUR, accent: DEMO_ACCENT });
  await office.setSchoolLogo('image/png', demoLogoPng(DEMO_COLOUR).toString('base64'));

  // The licence (0041), set as Qrie's founder sets it: a pilot with 5 to 14
  // seats more than the school has students, its last day five months from
  // today (India's).
  await db.query(`select lms.set_licence($1, 'pilot', $2, (lms.india_today() + interval '5 months')::date)`, [
    DEMO_SCHOOL.code,
    Math.ceil((students.students.length + 5) / 10) * 10,
  ]);

  // 2. Questions -----------------------------------------------------------------
  const banks = loadBanks();
  const chapterOf = new Map<string, string>();
  for (const b of banks) for (const n of b.graph.nodes) chapterOf.set(n.id, (n as { chapter?: string }).chapter ?? n.id);
  let library = libraryItems(banks);
  if (opts.libraryPerClass !== undefined) {
    const kept = new Map<string, number>();
    library = library.filter((i) => {
      const k = `${i.grade}|${i.subject}`;
      kept.set(k, (kept.get(k) ?? 0) + 1);
      return kept.get(k)! <= opts.libraryPerClass!;
    });
  }
  for (let i = 0; i < library.length; i += 500) {
    const batch = library.slice(i, i + 500).map((it) => ({
      ref: it.libraryRef,
      outcomes: it.outcomeIds,
      grade: it.grade,
      subject: it.subject,
      stem: it.stem,
      options: it.options,
      correct: it.correctIndex,
      misconceptions: it.misconceptions ?? null,
    }));
    await db.query(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
       select x.ref, x.outcomes, x.grade, x.subject, 'mcq', x.stem, x.options, x.correct, x.misconceptions
         from jsonb_to_recordset($1::jsonb) as x(ref text, outcomes text[], grade smallint, subject text,
                                                 stem text, options jsonb, correct smallint, misconceptions jsonb)
       on conflict (library_ref) do nothing`,
      [JSON.stringify(batch)],
    );
  }
  await loadOutcomes(db);
  const ids = new Map(
    (await db.query<{ id: string; library_ref: string }>(`select id, library_ref from lms.item where library_ref is not null`))
      .rows.map((r) => [r.library_ref, r.id]),
  );
  const items: Item[] = library.map((it) => ({
    ...it,
    id: ids.get(it.libraryRef)!,
    chapter: chapterOf.get(it.outcomeIds[0]) ?? it.outcomeIds[0],
    difficulty: rand() * 2.4 - 1.2,
  }));

  // 3. Homework -------------------------------------------------------------------
  const classes = (
    await db.query<{
      teacher: string;
      login_id: string;
      section_id: string;
      subject_id: string;
      grade: number;
      section: string;
      subject: string;
    }>(
      `select ta.teacher_user_id as teacher, acc.login_id, ta.section_id, ta.subject_id,
              sec.grade, sec.name as section, sub.name as subject
         from lms.teaching_assignment ta
         join lms.section sec on sec.id = ta.section_id
         join lms.subject sub on sub.id = ta.subject_id
         join lms.account acc on acc.user_id = ta.teacher_user_id
        order by acc.login_id, sec.grade, sec.name`,
    )
  ).rows;

  // Published in the morning, due at 8 pm, as a teacher would set them.
  const at = (days: number, hour: number) => {
    const d = new Date(now + days * DAY);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const schedule = [
    { published: at(-16, 9), due: at(-12, 20), current: false },
    { published: at(-9, 9), due: at(-5, 20), current: false },
    { published: at(-2, 9), due: at(3, 20), current: true },
  ];
  const ability = new Map<string, number>();
  const planted: Planted[] = [];
  // The wrong option each planted student chose on each question of their planted chapter.
  const plantedChoices = new Map<string, { subject: string; chapter: string; choices: Map<string, number> }>();

  for (const c of classes) {
    const teacher = createLmsClient(pgliteTransport(db, c.teacher));
    const groups = homeworkGroups(items.filter((i) => i.grade === c.grade && i.subject === c.subject));
    const title = (g: Item[]) => chapterTitle(g[0].chapter);
    const homeworks: Homework[] = [];

    for (const [n, when] of schedule.entries()) {
      const group = groups[n % groups.length];
      const id = await setHomework(teacher, c.section_id, c.subject_id, title(group), group, when.due);
      await db.query(
        `update lms.assignment set created_at = $2, published_at = $3 where id = $1`,
        [id, new Date(when.published - DAY), new Date(when.published)],
      );
      homeworks.push({ id, items: group, publishedAt: when.published, dueAt: when.due, current: when.current });
    }
    if (c.login_id === 'DEMO-T01') {
      const group = groups[3 % groups.length];
      const draft = await teacher.createAssignment({
        sectionId: c.section_id,
        subjectId: c.subject_id,
        kind: 'homework',
        title: `${title(group)} (draft)`,
        dueAt: new Date(at(7, 20)).toISOString(),
        answerTypes: ['mcq'],
      });
      for (const it of group) await teacher.approveItem(it.id);
      await teacher.setAssignmentItems(draft, group.map((i) => i.id));
    }
    if (c.login_id === 'DEMO-T02' && c.grade === 8 && c.section === 'A') {
      const photo = await teacher.createAssignment({
        sectionId: c.section_id,
        subjectId: c.subject_id,
        kind: 'homework',
        title: 'Draw and label a plant cell',
        instructions: 'Draw it in your notebook, label every part you know, and hand in a photo of the page.',
        dueAt: new Date(at(5, 20)).toISOString(),
        answerTypes: ['photo'],
      });
      await teacher.publishAssignment(photo);
    }

    // 4 and 5. Answers ----------------------------------------------------------
    const roster = await teacher.classRoster(c.section_id);
    const plant = PLANTS.find((p) => p.grade === c.grade && p.section === c.section && p.subject === c.subject);
    const plantedTopic = plant ? homeworks[plant.homework].items[0].chapter : null;
    const plantedHere = new Set(
      plant ? roster.filter((r) => plant.rolls.includes(r.rollNumber ?? '')).map((r) => r.studentUserId) : [],
    );
    for (const r of roster.filter((x) => plantedHere.has(x.studentUserId))) {
      planted.push({
        loginId: r.loginId,
        name: r.displayName,
        className: `${c.grade}${c.section}`,
        subject: c.subject,
        topic: plantedTopic!,
        outcomeIds: [
          ...new Set(
            items
              .filter((i) => i.grade === c.grade && i.subject === c.subject && i.chapter === plantedTopic)
              .flatMap((i) => i.outcomeIds),
          ),
        ],
        why: `answers every question on "${chapterTitle(plantedTopic!)}" wrong, choosing the distractor its misconception label names`,
      });
    }

    for (const hw of homeworks) {
      for (const r of roster) {
        if (!ability.has(r.studentUserId)) ability.set(r.studentUserId, gaussian(rand));
        const theta = ability.get(r.studentUserId)!;
        const isPlanted = plantedHere.has(r.studentUserId) && hw.items.some((i) => i.chapter === plantedTopic);
        if (!isPlanted && rand() > (hw.current ? 0.35 : 0.85)) continue;

        const answers: Record<string, number> = {};
        for (const it of hw.items) {
          const wrongOnPurpose = plantedHere.has(r.studentUserId) && it.chapter === plantedTopic;
          const p = 1 / (1 + Math.exp(-(1.4 * theta - it.difficulty + 0.5)));
          answers[it.id] = !wrongOnPurpose && rand() < p ? it.correctIndex : distractor(it, rand, wrongOnPurpose);
        }
        const student = createLmsClient(pgliteTransport(db, r.studentUserId));
        const { submissionId } = await student.submitMcq(hw.id, answers);
        if (plantedHere.has(r.studentUserId)) {
          const mine = plantedChoices.get(r.studentUserId) ?? { subject: c.subject, chapter: plantedTopic!, choices: new Map() };
          for (const it of hw.items) if (it.chapter === plantedTopic) mine.choices.set(it.id, answers[it.id]);
          plantedChoices.set(r.studentUserId, mine);
        }

        const late = !hw.current && rand() < 0.15;
        const handedAt = hw.current
          ? hw.publishedAt + rand() * (now - hw.publishedAt)
          : late
            ? hw.dueAt + (0.2 + rand() * 1.8) * DAY
            : hw.publishedAt + (0.1 + rand() * 0.85) * (hw.dueAt - hw.publishedAt);
        await backdate(db, submissionId, new Date(Math.min(handedAt, now)), new Date(hw.dueAt));
      }
    }

    // The first past homework of each of DEMO-T01's classes is part-marked.
    if (c.login_id === 'DEMO-T01') {
      const hw = homeworks[0];
      for (const row of await teacher.assignmentResults(hw.id)) {
        if (!row.submissionId || rand() > 0.4) continue;
        // Mostly the machine's score confirmed; now and then half a mark for working shown.
        const partial = row.machineCorrect! > 0 && row.machineCorrect! < row.machineTotal!;
        const bump = partial && rand() < 0.3 ? 0.5 : 0;
        await teacher.setTeacherMark(row.submissionId, Math.min(row.machineCorrect! + bump, row.machineTotal!), row.machineTotal!);
        const markedAt = new Date(hw.dueAt + DAY);
        await db.query(`update lms.mark set marked_at = $2 where submission_id = $1`, [row.submissionId, markedAt]);
        await db.query(`update lms.mark_history set changed_at = $2 where submission_id = $1`, [row.submissionId, markedAt]);
      }
    }
  }

  // 7. The other kinds of work, and events (0029), so each has an example.
  await seedWorkTypes(db, { rand, at, ability, items, orgId });

  // 8. Learn (0031): each class's first three chapters approved whole, and a
  // round of practice from some of its students.
  await seedPractice(db, { rand, at, ability, items, orgId }, classes);

  // 9. Attendance (0036): four weeks of school days, marked by a teacher of
  // each class; today marked in one class only, as on a real morning.
  await seedAttendance(db, rand, classes);

  // 10. Teachers' words (0038): comments on work in 8A Mathematics, and this
  // year's remark on the report cards of some of 8A.
  await seedComments(db, orgId);

  // 11. Notices (0039): the admin's to the whole school with a PDF circular,
  // and two teachers' to their classes; some children have opened them.
  await seedNotices(db, orgId);

  // 5, again. A wrong idea a child really holds comes back: each planted
  // student practises their planted chapter and chooses the same wrong option
  // on every question of it they had in homework. One wrong answer is a slip
  // (0103); the same one in a second sitting is what the brain confirms.
  await seedPlantedPractice(db, plantedChoices);

  // 6. The brain. It is given the ledger and nothing else — not `planted`:
  // every learner the answers queued, the whole queue at once.
  await drainBrainQueue(db, { maxLearners: Infinity, maxMs: Infinity });

  // 12. Practice for some children (0040): Neha's, in 8A Mathematics, for the
  // children who show the class's most-shown misconception.
  await seedPracticeForSome(db);

  // 13. A parent (0045): the first child of 8A's mother, with her own sign-in.
  const parent = await seedParent(db, imported.created);

  return {
    orgId,
    logins: [...imported.created, parent].sort(
      (a, b) => kindOrder(a) - kindOrder(b) || a.loginId.localeCompare(b.loginId, 'en', { numeric: true }),
    ),
    planted,
  };
}

function kindOrder(a: CreatedAccount): number {
  return a.kind === 'admin' ? 0 : a.kind === 'teacher' ? 1 : a.kind === 'student' ? 2 : 3;
}

/** The first child of 8A's mother, given a sign-in by the admin as the portal does. */
async function seedParent(db: PGlite, created: CreatedAccount[]): Promise<CreatedAccount> {
  const admin = created.find((a) => a.kind === 'admin')!;
  const child = created.find((a) => a.loginId === 'DEMO-8A-1')!;
  const surname = child.displayName.split(' ').at(-1);
  const p = await addParentForAdmin(db, admin.userId, { studentLoginId: child.loginId, displayName: `Sunita ${surname}` });
  const userId = (await db.query<{ user_id: string }>(`select user_id from lms.account where login_id = $1`, [p.loginId])).rows[0]
    .user_id;
  return { loginId: p.loginId, kind: 'parent', displayName: p.displayName, userId, pin: p.pin };
}

/** Homework-sized groups: a chapter's questions, six at most; small chapters are merged in order. */
function homeworkGroups(items: Item[]): Item[][] {
  const byChapter = new Map<string, Item[]>();
  for (const it of items) byChapter.set(it.chapter, [...(byChapter.get(it.chapter) ?? []), it]);
  const groups = [...byChapter.values()].filter((g) => g.length >= 3).map((g) => g.slice(0, 6));
  if (groups.length >= 4) return groups;
  const chunks: Item[][] = [];
  for (let i = 0; i < items.length; i += 6) chunks.push(items.slice(i, i + 6));
  if (!chunks.length) throw new Error('no library questions for a demo class');
  return chunks;
}

async function setHomework(
  teacher: LmsClient,
  sectionId: string,
  subjectId: string,
  title: string,
  group: Item[],
  dueAt: number,
): Promise<string> {
  for (const it of group) await teacher.approveItem(it.id);
  const id = await teacher.createAssignment({
    sectionId,
    subjectId,
    kind: 'homework',
    title,
    dueAt: new Date(dueAt).toISOString(),
    answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(id, group.map((i) => i.id));
  await teacher.publishAssignment(id);
  return id;
}

/** A wrong option; on purpose, the one a misconception label names when there is one. */
function distractor(it: Item, rand: () => number, onPurpose: boolean): number {
  const wrong = it.options.map((_, i) => i).filter((i) => i !== it.correctIndex);
  const labelled = wrong.filter((i) => (it.misconceptions?.[i] ?? '').trim() !== '');
  const pool = labelled.length && (onPurpose || rand() < 0.7) ? labelled : wrong;
  return pool[Math.floor(rand() * pool.length)];
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function chapterTitle(slug: string): string {
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Moves one submission, its answers' ledger rows and its session to `at`. */
async function backdate(db: PGlite, submissionId: string, at: Date, due: Date): Promise<void> {
  await db.query(`update lms.submission set submitted_at = $2, late = $2::timestamptz > $3::timestamptz where id = $1`, [submissionId, at, due]);
  await db.query(`update public.ledger_event set at = $2 where payload->>'submissionId' = $1`, [submissionId, at]);
  await db.query(
    `update public.learning_session set started_at = $2, ended_at = $2
      where id in (select session_id from public.ledger_event where payload->>'submissionId' = $1)`,
    [submissionId, at],
  );
}

interface WorkSeed {
  rand: () => number;
  at: (days: number, hour: number) => number;
  ability: Map<string, number>;
  items: Item[];
  orgId: string;
}

async function seedWorkTypes(db: PGlite, w: WorkSeed): Promise<void> {
  const { rand, at } = w;
  const cls = async (login: string, grade: number, section: string, subject: string) => {
    const { rows } = await db.query<{ teacher: string; section_id: string; subject_id: string }>(
      `select ta.teacher_user_id as teacher, ta.section_id, ta.subject_id
         from lms.teaching_assignment ta
         join lms.account acc on acc.user_id = ta.teacher_user_id
         join lms.section sec on sec.id = ta.section_id
         join lms.subject sub on sub.id = ta.subject_id
        where acc.login_id = $1 and sec.grade = $2 and sec.name = $3 and sub.name = $4`,
      [login, grade, section, subject],
    );
    const r = rows[0];
    return { ...r, api: createLmsClient(pgliteTransport(db, r.teacher)) };
  };
  const maths8a = await cls('DEMO-T01', 8, 'A', 'Mathematics');
  const maths8b = await cls('DEMO-T01', 8, 'B', 'Mathematics');
  const science8a = await cls('DEMO-T02', 8, 'A', 'Science');

  // Written work in the notebook, as a checklist, for both of Neha's classes;
  // about half the children have ticked everything, some a part.
  for (const c of [maths8a, maths8b]) {
    const hw = await c.api.createAssignment({
      sectionId: c.section_id,
      subjectId: c.subject_id,
      kind: 'homework',
      title: 'Exercise 1.2 in your notebook',
      instructions: 'Neat work, one question per line. Bring your notebook on Monday.',
      dueAt: new Date(at(2, 20)).toISOString(),
      answerTypes: ['checklist'],
    });
    await c.api.setAssignmentTasks(hw, [
      'Exercise 1.2, questions 1 to 4',
      'Exercise 1.2, questions 5 to 7 (show every step)',
      'Learn the properties of rational numbers for the class quiz',
    ]);
    await c.api.publishAssignment(hw);
    await db.query(`update lms.assignment set created_at = $2, published_at = $2 where id = $1`, [hw, new Date(at(-1, 9))]);
    const checked: string[] = [];
    const notDone: string[] = [];
    for (const r of await c.api.classRoster(c.section_id)) {
      const kid = createLmsClient(pgliteTransport(db, r.studentUserId));
      const tasks = await kid.myTasks(hw);
      const roll = rand();
      const upTo = roll < 0.5 ? tasks.length : roll < 0.7 ? 1 : 0;
      for (const t of tasks.slice(0, upTo)) await kid.tickTask(t.taskId, true);
      // The teacher has looked at some notebooks already: most ticks were
      // true, and one or two children who ticked nothing had done nothing.
      if (upTo === tasks.length && rand() < 0.6) checked.push(r.studentUserId);
      if (upTo === 0 && rand() < 0.5) notDone.push(r.studentUserId);
    }
    if (checked.length) await c.api.setWorkStatus(hw, checked, 'checked');
    if (notDone.length) await c.api.setWorkStatus(hw, notDone, 'not_done');
  }

  // An online test for 8A tomorrow morning: 20 minutes, eight questions.
  const pool = w.items.filter((i) => i.grade === 8 && i.subject === 'Mathematics' && i.chapter === 'squares-and-square-roots');
  const questions = (pool.length >= 4 ? pool : w.items.filter((i) => i.grade === 8 && i.subject === 'Mathematics')).slice(0, 8);
  for (const q of questions) await maths8a.api.approveItem(q.id);
  const test = await maths8a.api.createAssignment({
    sectionId: maths8a.section_id,
    subjectId: maths8a.subject_id,
    kind: 'test',
    title: 'Unit test 1: Squares and square roots',
    instructions: 'Twenty minutes. Rough work in your notebook is fine.',
    opensAt: new Date(at(1, 10)).toISOString(),
    dueAt: new Date(at(1, 11)).toISOString(),
    timeLimitMinutes: 20,
    answerTypes: ['mcq'],
  });
  await maths8a.api.setAssignmentItems(test, questions.map((q) => q.id));
  await maths8a.api.publishAssignment(test);

  // A class test on paper last week, marks entered and released.
  const paper = await maths8a.api.createAssignment({
    sectionId: maths8a.section_id,
    subjectId: maths8a.subject_id,
    kind: 'test',
    title: 'Class test: Linear equations',
    dueAt: new Date(at(-5, 10)).toISOString(),
    answerTypes: ['paper'],
    maxMarks: 20,
  });
  await maths8a.api.publishAssignment(paper);
  for (const r of await maths8a.api.classRoster(maths8a.section_id)) {
    if (rand() < 0.08) {
      await maths8a.api.setWorkStatus(paper, [r.studentUserId], 'absent');
      continue;
    }
    const theta = w.ability.get(r.studentUserId) ?? 0;
    const p = 1 / (1 + Math.exp(-(1.2 * theta + 0.6)));
    const mark = Math.max(0, Math.min(20, Math.round((p * 20 + (rand() - 0.5) * 4) * 2) / 2));
    await maths8a.api.recordPaperMark(paper, r.studentUserId, mark);
  }
  await maths8a.api.releaseResults(paper);

  // A longer assignment in science: written work, a model, and a photo of it.
  const project = await science8a.api.createAssignment({
    sectionId: science8a.section_id,
    subjectId: science8a.subject_id,
    kind: 'assignment',
    title: 'Project: a model of a plant cell',
    instructions: 'Use things from home — clay, card, beads. Label every part.',
    dueAt: new Date(at(7, 20)).toISOString(),
    answerTypes: ['checklist', 'photo'],
    maxMarks: 10,
  });
  await science8a.api.setAssignmentTasks(project, [
    'Draw a labelled plant cell in your notebook',
    'Make the model at home',
    'Take a photo of the model and hand it in below',
  ]);
  await science8a.api.publishAssignment(project);

  // Events: Neha's PTM for 8A, and the admin's for the whole school.
  await maths8a.api.createEvent({
    sectionId: maths8a.section_id,
    kind: 'ptm',
    title: 'Parent–teacher meeting, Class 8A',
    details: 'Room 12. Parents may come any time in the two hours.',
    startsAt: new Date(at(6, 10)).toISOString(),
    endsAt: new Date(at(6, 12)).toISOString(),
  });
  const { rows: admins } = await db.query<{ user_id: string }>(
    `select user_id from lms.account where org_id = $1 and kind = 'admin' limit 1`,
    [w.orgId],
  );
  const admin = createLmsClient(pgliteTransport(db, admins[0].user_id));
  const year = new Date().getFullYear();
  const gandhi = new Date(year, 9, 2, 0, 0, 0).getTime() > Date.now() ? new Date(year, 9, 2) : new Date(year + 1, 9, 2);
  for (const e of [
    { kind: 'holiday' as const, title: 'Gandhi Jayanti — school closed', startsAt: gandhi.toISOString() },
    { kind: 'exam' as const, title: 'Half-yearly exams begin', details: 'Date sheet on the notice board.', startsAt: new Date(at(14, 9)).toISOString() },
    { kind: 'event' as const, title: 'Annual day', details: 'Parents welcome. Students in school uniform.', startsAt: new Date(at(21, 17)).toISOString() },
  ]) {
    await admin.createEvent({ sectionId: null, ...e });
  }
}

interface TaughtRow {
  teacher: string;
  section_id: string;
  grade: number;
  subject: string;
}

/**
 * Learn: the first three chapters of each class's subject approved whole by
 * its teacher, then one practice round of five from about half of each
 * class, answered to each child's ability.
 */
async function seedPractice(db: PGlite, w: WorkSeed, classes: TaughtRow[]): Promise<void> {
  const approved = new Set<string>();
  for (const c of classes) {
    const key = `${c.grade}|${c.subject}`;
    if (approved.has(key)) continue;
    approved.add(key);
    const teacher = createLmsClient(pgliteTransport(db, c.teacher));
    const chapters = [...new Set(w.items.filter((i) => i.grade === c.grade && i.subject === c.subject).map((i) => i.chapter))];
    for (const chapter of chapters.slice(0, 3)) await teacher.approveChapter(c.grade, c.subject, chapter);
  }
  const byItem = new Map(w.items.map((i) => [i.id, i]));
  const done = new Set<string>();
  for (const c of classes) {
    const teacher = createLmsClient(pgliteTransport(db, c.teacher));
    for (const r of await teacher.classRoster(c.section_id)) {
      if (done.has(r.studentUserId)) continue;
      done.add(r.studentUserId);
      if (w.rand() > 0.5) continue;
      const kid = createLmsClient(pgliteTransport(db, r.studentUserId));
      const open = (await kid.practiceChapters()).filter((ch) => ch.questions > 0);
      if (!open.length) continue;
      const ch = open[Math.floor(w.rand() * open.length)];
      const session = crypto.randomUUID();
      const theta = w.ability.get(r.studentUserId) ?? 0;
      for (const q of await kid.practiceQuestions(ch.subjectName, ch.chapter, 5)) {
        const it = byItem.get(q.itemId);
        if (!it) continue;
        const p = 1 / (1 + Math.exp(-(1.4 * theta - it.difficulty + 0.5)));
        await kid.checkPracticeAnswer(session, q.itemId, w.rand() < p ? it.correctIndex : distractor(it, w.rand, false));
      }
    }
  }
}

/**
 * Each planted student's round of practice on their planted chapter, through
 * the student app's own calls: of the questions it offers (up to 20), those
 * they had in homework, answered with the option they chose then. Uses none
 * of the seed's random numbers, so nothing seeded after it moves.
 */
async function seedPlantedPractice(
  db: PGlite,
  plantedChoices: Map<string, { subject: string; chapter: string; choices: Map<string, number> }>,
): Promise<void> {
  for (const [user, { subject, chapter, choices }] of plantedChoices) {
    const kid = createLmsClient(pgliteTransport(db, user));
    const session = crypto.randomUUID();
    for (const q of await kid.practiceQuestions(subject, chapter, 20)) {
      const chosen = choices.get(q.itemId);
      if (chosen !== undefined) await kid.checkPracticeAnswer(session, q.itemId, chosen);
    }
  }
}

/**
 * Four weeks of attendance, Monday to Saturday, through the teacher's own
 * call: most children present, some late, a few absent, now and then one on
 * leave — and a weaker child absent a little more often.
 */
async function seedAttendance(db: PGlite, rand: () => number, classes: TaughtRow[]): Promise<void> {
  const bySection = new Map<string, string>();
  for (const c of classes) if (!bySection.has(c.section_id)) bySection.set(c.section_id, c.teacher);
  const day = (n: number) => {
    const d = new Date(Date.now() - n * DAY);
    return { ymd: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, sunday: d.getDay() === 0 };
  };
  let first = true;
  for (const [sectionId, teacherId] of bySection) {
    const teacher = createLmsClient(pgliteTransport(db, teacherId));
    const roster = await teacher.classRoster(sectionId);
    for (let n = 27; n >= 0; n--) {
      const d = day(n);
      if (d.sunday || (n === 0 && !first)) continue;
      const marks: Record<string, 'present' | 'absent' | 'late' | 'leave'> = {};
      roster.forEach((r, i) => {
        const x = rand();
        const shaky = i % 7 === 0;
        marks[r.studentUserId] = x < (shaky ? 0.16 : 0.05) ? 'absent' : x < (shaky ? 0.22 : 0.1) ? 'late' : x > 0.985 ? 'leave' : 'present';
      });
      await teacher.markAttendance(sectionId, d.ymd, marks);
    }
    first = false;
  }
}

const WORK_COMMENTS = [
  'Show your working, even for the short ones: it is how we find where it went wrong.',
  'Read each question twice before choosing. Redo the ones you got wrong in your notebook.',
  'Slow down, and check each answer once more before you hand it in.',
  'Come and see me after class and we will go over this chapter together.',
];
const PAPER_COMMENTS = {
  top: 'Excellent: neat, complete and every step shown. Try the extra questions at the end of the chapter.',
  low: 'Practise moving a term across the equals sign, then redo the questions you lost marks on.',
};
const REMARKS = [
  'A careful worker who asks good questions in class. Next step: show every line of working in Mathematics.',
  'Hands in work on time and is always willing to help others. Should read each question fully before answering.',
  'Has improved steadily this term. More practice with fractions and decimals will help.',
  'Quick and keen, but rushes. Checking answers before handing in will lift the marks.',
];
const ADMIN_REMARKS = [
  'Punctual, polite and a good member of the class. Keep it up.',
  'Good progress this term. Keep reading every day.',
];

/**
 * Neha Sharma (DEMO-T01) comments on the four lowest-scoring hand-ins of
 * 8A Mathematics' first past homework, and on the highest and lowest marks
 * of its paper test; this year's remark is written for the first six of 8A
 * by roll, four by her and two by the admin. All through the API, and with
 * none of the seed's random numbers, so everything seeded earlier keeps its
 * values.
 */
async function seedComments(db: PGlite, orgId: string): Promise<void> {
  const { rows } = await db.query<{ teacher: string; section_id: string; subject_id: string }>(
    `select ta.teacher_user_id as teacher, ta.section_id, ta.subject_id
       from lms.teaching_assignment ta
       join lms.account acc on acc.user_id = ta.teacher_user_id
       join lms.section sec on sec.id = ta.section_id
       join lms.subject sub on sub.id = ta.subject_id
      where acc.login_id = 'DEMO-T01' and sec.grade = 8 and sec.name = 'A' and sub.name = 'Mathematics'`,
  );
  const c = rows[0];
  const neha = createLmsClient(pgliteTransport(db, c.teacher));
  const work = await neha.classAssignments(c.section_id, c.subject_id);

  const homework = work
    .filter((a) => a.published && a.kind === 'homework' && a.answerTypes.includes('mcq') && Date.parse(a.dueAt) < Date.now())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  const share = (r: { machineCorrect: number | null; machineTotal: number | null }) =>
    (r.machineCorrect ?? 0) / (r.machineTotal || 1);
  const weakest = (await neha.assignmentResults(homework.id))
    .filter((r) => r.submissionId && r.machineTotal)
    .sort((a, b) => share(a) - share(b) || a.studentUserId.localeCompare(b.studentUserId))
    .slice(0, WORK_COMMENTS.length);
  for (const [i, r] of weakest.entries()) await neha.setWorkComment(homework.id, r.studentUserId, WORK_COMMENTS[i]);

  const paper = work.find((a) => a.answerTypes.includes('paper'));
  if (paper) {
    const marked = (await neha.assignmentResults(paper.id))
      .filter((r) => r.paperScore !== null)
      .sort((a, b) => b.paperScore! - a.paperScore! || a.studentUserId.localeCompare(b.studentUserId));
    if (marked.length >= 2) {
      await neha.setWorkComment(paper.id, marked[0].studentUserId, PAPER_COMMENTS.top);
      await neha.setWorkComment(paper.id, marked[marked.length - 1].studentUserId, PAPER_COMMENTS.low);
    }
  }

  const { rows: admins } = await db.query<{ user_id: string }>(
    `select user_id from lms.account where org_id = $1 and kind = 'admin' limit 1`,
    [orgId],
  );
  const office = createLmsClient(pgliteTransport(db, admins[0].user_id));
  const roster = await neha.classRoster(c.section_id);
  for (const [i, r] of roster.slice(0, REMARKS.length + ADMIN_REMARKS.length).entries()) {
    if (i < REMARKS.length) await neha.setReportRemark(r.studentUserId, REMARKS[i]);
    else await office.setReportRemark(r.studentUserId, ADMIN_REMARKS[i - REMARKS.length]);
  }
}

/**
 * Neha Sharma (DEMO-T01) sends practice, due in three days, to the children
 * of 8A Mathematics who show its most-shown likely misconception that has
 * approved questions free to set — the first of the class's list that has
 * any. Through the API, and with none of the seed's random numbers.
 */
async function seedPracticeForSome(db: PGlite): Promise<void> {
  const { rows } = await db.query<{ teacher: string; section_id: string; subject_id: string }>(
    `select ta.teacher_user_id as teacher, ta.section_id, ta.subject_id
       from lms.teaching_assignment ta
       join lms.account acc on acc.user_id = ta.teacher_user_id
       join lms.section sec on sec.id = ta.section_id
       join lms.subject sub on sub.id = ta.subject_id
      where acc.login_id = 'DEMO-T01' and sec.grade = 8 and sec.name = 'A' and sub.name = 'Mathematics'`,
  );
  const c = rows[0];
  const neha = createLmsClient(pgliteTransport(db, c.teacher));
  const top = (await neha.classLikelyMisconceptions(c.section_id, c.subject_id)).find((m) => m.questions > 0);
  if (!top) throw new Error('8A Mathematics shows no misconception that practice can be set for');
  await neha.sendPractice({
    sectionId: c.section_id,
    subjectId: c.subject_id,
    chapter: top.chapter,
    misconception: top.label,
    studentUserIds: top.children.map((x) => x.studentUserId),
    dueAt: new Date(Date.now() + 3 * DAY).toISOString(),
  });
}

/** A one-page PDF of a few lines of plain ASCII text, for a demo circular. */
function onePagePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 18 : 12} Tf 72 ${770 - i * 26} Td (${esc(l)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, o] of objects.entries()) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * The admin's notice to the whole school, with its circular as a PDF; Neha
 * Sharma's (DEMO-T01) to 8A and 8B; Imran Khan's (DEMO-T02) to 8A. Opened by
 * the first fifteen of 8A and ten of 8B by roll (Neha's), every third child of
 * the school by school ID and two teachers (the admin's), and the first five
 * of 8A (Imran's). All through the API, and with none of the seed's random
 * numbers.
 */
async function seedNotices(db: PGlite, orgId: string): Promise<void> {
  const { rows: people } = await db.query<{ user_id: string; login_id: string; kind: string }>(
    `select user_id, login_id, kind from lms.account where org_id = $1 order by login_id`,
    [orgId],
  );
  const as = (loginId: string) => createLmsClient(pgliteTransport(db, people.find((p) => p.login_id === loginId)!.user_id));
  const office = createLmsClient(pgliteTransport(db, people.find((p) => p.kind === 'admin')!.user_id));
  const neha = as('DEMO-T01');
  const imran = as('DEMO-T02');
  const nehaClasses = await neha.myClasses();
  const sectionOf = (grade: number, name: string) => nehaClasses.find((c) => c.grade === grade && c.sectionName === name)!.sectionId;
  const s8a = sectionOf(8, 'A');
  const s8b = sectionOf(8, 'B');

  const uniform = await office.sendNotice({
    title: 'Winter uniform from 1 November',
    body:
      'From 1 November every student comes to school in the winter uniform: the navy blazer or sweater, ' +
      'grey trousers or skirt, and the school tie. The circular with the full list is attached.',
    sectionIds: null,
    attachment: {
      name: 'winter-uniform-circular.pdf',
      mime: 'application/pdf',
      base64: onePagePdf([
        'Qrie Demo School - Circular',
        'Winter uniform from 1 November',
        'Navy blazer or navy sweater with the school crest.',
        'Grey trousers or grey skirt; black shoes, grey socks.',
        'The school tie, every day.',
        'Contact the school office with any questions.',
      ]).toString('base64'),
    },
  });
  const geometry = await neha.sendNotice({
    title: 'Bring your geometry box on Monday',
    body: 'We start constructions on Monday. Bring a compass, a protractor, a ruler and a sharp pencil.',
    sectionIds: [s8a, s8b],
  });
  const lab = await imran.sendNotice({
    title: 'Science lab visit on Thursday',
    body: 'We go to the science lab in the third period on Thursday. Wear your lab coat; bags stay in the classroom.',
    sectionIds: [s8a],
  });

  const r8a = await neha.classRoster(s8a);
  const r8b = await neha.classRoster(s8b);
  const read = (userId: string, noticeId: string) => createLmsClient(pgliteTransport(db, userId)).readNotice(noticeId);
  for (const r of [...r8a.slice(0, 15), ...r8b.slice(0, 10)]) await read(r.studentUserId, geometry);
  for (const r of r8a.slice(0, 5)) await read(r.studentUserId, lab);
  for (const [i, p] of people.filter((x) => x.kind === 'student').entries()) if (i % 3 === 0) await read(p.user_id, uniform);
  for (const login of ['DEMO-T02', 'DEMO-T03']) await as(login).readNotice(uniform);
}
