import fs from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../../packages/lms-client/src/index.ts';
import { applyPlan, type CreatedAccount } from '../../lms-import/src/apply.ts';
import { pgliteStore } from '../../lms-import/src/pgliteStore.ts';
import { planImport, type SchoolConfig } from '../../lms-import/src/plan.ts';
import { readStudents, readTeachers } from '../../lms-import/src/sheet.ts';
import { libraryItems, loadBanks, type LibraryItem } from '../../lms-library/src/library.ts';
import { setPin } from './auth.ts';

/**
 * The demo school, built the way a real one will be and given a month of
 * made-up but plausible history.
 *
 *   1. People: data/students.csv and data/teachers.csv, fictional names, run
 *      through the real import (sheet → plan → applyPlan). 82 students in
 *      6A, 7A, 8A and 8B; four teachers; one admin.
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
 *      names the error. They are returned as `planted` and written beside the
 *      logins, so that when the brain (L6) says who is stuck on what, it can
 *      be checked against a known answer instead of admired.
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

  const schedule = [
    { published: now - 16 * DAY, due: now - 12 * DAY, current: false },
    { published: now - 9 * DAY, due: now - 5 * DAY, current: false },
    { published: now - 2 * DAY, due: now + 3 * DAY, current: true },
  ];
  const ability = new Map<string, number>();
  const planted: Planted[] = [];

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
        dueAt: new Date(now + 7 * DAY).toISOString(),
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
        dueAt: new Date(now + 5 * DAY).toISOString(),
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

        const late = !hw.current && rand() < 0.15;
        const at = hw.current
          ? hw.publishedAt + rand() * (now - hw.publishedAt)
          : late
            ? hw.dueAt + (0.2 + rand() * 1.8) * DAY
            : hw.publishedAt + (0.1 + rand() * 0.85) * (hw.dueAt - hw.publishedAt);
        await backdate(db, submissionId, new Date(Math.min(at, now)), new Date(hw.dueAt));
      }
    }

    // The first past homework of each of DEMO-T01's classes is part-marked.
    if (c.login_id === 'DEMO-T01') {
      const hw = homeworks[0];
      for (const row of await teacher.assignmentResults(hw.id)) {
        if (!row.submissionId || rand() > 0.4) continue;
        const bump = rand() < 0.3 ? 0.5 : 0;
        await teacher.setTeacherMark(row.submissionId, Math.min(row.machineCorrect! + bump, row.machineTotal!), row.machineTotal!);
        const markedAt = new Date(hw.dueAt + DAY);
        await db.query(`update lms.mark set marked_at = $2 where submission_id = $1`, [row.submissionId, markedAt]);
        await db.query(`update lms.mark_history set changed_at = $2 where submission_id = $1`, [row.submissionId, markedAt]);
      }
    }
  }

  return {
    orgId,
    logins: imported.created.sort((a, b) => kindOrder(a) - kindOrder(b) || a.loginId.localeCompare(b.loginId, 'en', { numeric: true })),
    planted,
  };
}

function kindOrder(a: CreatedAccount): number {
  return a.kind === 'admin' ? 0 : a.kind === 'teacher' ? 1 : 2;
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
