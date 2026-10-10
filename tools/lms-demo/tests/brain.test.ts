// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainBrainQueue } from '../../../packages/lms-brain/src/index.ts';
import {
  createLmsClient,
  pgliteTransport,
  type ChapterStanding,
  type LmsClient,
} from '../../../packages/lms-client/src/index.ts';
import { openDemoDatabase } from '../src/database.ts';
import { seedDemoSchool, type Planted, type Seeded } from '../src/seed.ts';

/**
 * IS THE BRAIN REAL, OR AN ILLUSION?
 *
 * The demo school hides a known answer: a few students were made to get
 * every question on one chapter wrong (seed.ts, "planted"). The brain is
 * given the ledger and nothing else. If what it tells a teacher is real, it
 * must find those students on those chapters — without calling the whole
 * class stuck, while keeping their stronger chapters apart from the planted
 * one, and it must change its mind when their answers change. A dashboard
 * that only looked clever would fail at least one of these.
 */

let db: PGlite;
let seeded: Seeded;

interface ClassOf {
  sectionId: string;
  subjectId: string;
  teacher: LmsClient;
}

async function classOf(p: Planted): Promise<ClassOf> {
  const { rows } = await db.query<{ section_id: string; subject_id: string; teacher: string }>(
    `select ta.section_id, ta.subject_id, ta.teacher_user_id as teacher
       from lms.teaching_assignment ta
       join lms.section sec on sec.id = ta.section_id
       join lms.subject sub on sub.id = ta.subject_id
      where sec.grade || sec.name = $1 and sub.name = $2`,
    [p.className, p.subject],
  );
  const r = rows[0];
  return { sectionId: r.section_id, subjectId: r.subject_id, teacher: createLmsClient(pgliteTransport(db, r.teacher)) };
}

const standingOf = (rows: ChapterStanding[], loginId: string, chapter: string, seed: Seeded) => {
  const user = seed.logins.find((l) => l.loginId === loginId)!.userId;
  return rows.find((r) => r.studentUserId === user && r.chapter === chapter);
};

beforeAll(async () => {
  db = await openDemoDatabase();
  seeded = await seedDemoSchool(db, { libraryPerClass: 60 });
}, 180_000);
afterAll(async () => {
  await db?.close();
});

describe('the brain, against a known answer', () => {
  it('finds every planted student on the chapter planted', async () => {
    for (const p of seeded.planted) {
      const c = await classOf(p);
      const rows = await c.teacher.classInsights(c.sectionId, c.subjectId);
      const s = standingOf(rows, p.loginId, p.topic, seeded);
      expect(s, `${p.loginId} on ${p.topic}`).toBeDefined();
      expect(s!.mastery, `${p.loginId} on ${p.topic}`).toBeLessThan(0.25);
    }
  });

  it('does not call the whole class stuck on that chapter', async () => {
    for (const p of seeded.planted) {
      const c = await classOf(p);
      const rows = (await c.teacher.classInsights(c.sectionId, c.subjectId)).filter((r) => r.chapter === p.topic);
      const low = rows.filter((r) => r.mastery < 0.25);
      expect(low.length / rows.length, `${p.className} ${p.subject} ${p.topic}`).toBeLessThan(0.5);
    }
  });

  it("keeps a planted student's other chapters apart from the planted one", async () => {
    for (const p of seeded.planted) {
      const c = await classOf(p);
      const rows = await c.teacher.classInsights(c.sectionId, c.subjectId);
      const user = seeded.logins.find((l) => l.loginId === p.loginId)!.userId;
      const planted = rows.find((r) => r.studentUserId === user && r.chapter === p.topic)!;
      const others = rows.filter((r) => r.studentUserId === user && r.chapter !== p.topic && r.answers >= 3);
      for (const o of others) {
        expect(planted.mastery, `${p.loginId}: ${p.topic} vs ${o.chapter}`).toBeLessThanOrEqual(o.mastery + 0.05);
      }
    }
  });

  it('names, for each planted student, the misconceptions their chosen answers were written to catch', async () => {
    for (const p of seeded.planted) {
      const c = await classOf(p);
      const shown = (await c.teacher.classMisconceptions(c.sectionId, c.subjectId)).filter(
        (m) => m.chapter === p.topic && m.studentUserId === seeded.logins.find((l) => l.loginId === p.loginId)!.userId,
      );
      expect(shown.length, `${p.loginId}`).toBeGreaterThan(0);
    }
  });

  it('changes its mind when the answers change', async () => {
    const p = seeded.planted[0];
    const c = await classOf(p);
    const before = standingOf(await c.teacher.classInsights(c.sectionId, c.subjectId), p.loginId, p.topic, seeded)!;

    // Four questions on the planted chapter — the demo library is small, so
    // possibly ones they got wrong before — now all answered right.
    const { rows } = await db.query<{ id: string; correct_index: number }>(
      `select i.id, i.correct_index from lms.item i
         join lms.outcome o on o.id = any (i.outcome_ids)
        where o.chapter = $1 and i.grade = $2 and i.subject = $3
        order by i.library_ref
        limit 4`,
      [p.topic, Number(p.className.slice(0, -1)), p.subject],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) await c.teacher.approveItem(r.id);
    const hw = await c.teacher.createAssignment({
      sectionId: c.sectionId,
      subjectId: c.subjectId,
      kind: 'homework',
      title: 'Second chance',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      answerTypes: ['mcq'],
    });
    await c.teacher.setAssignmentItems(hw, rows.map((r) => r.id));
    await c.teacher.publishAssignment(hw);
    const user = seeded.logins.find((l) => l.loginId === p.loginId)!.userId;
    await createLmsClient(pgliteTransport(db, user)).submitMcq(
      hw,
      Object.fromEntries(rows.map((r) => [r.id, r.correct_index])),
    );
    // The hand-in queued them (0108); the brain's drain reads it.
    expect(await drainBrainQueue(db)).toMatchObject({ thought: 1, waiting: 0 });

    const after = standingOf(await c.teacher.classInsights(c.sectionId, c.subjectId), p.loginId, p.topic, seeded)!;
    expect(after.answers).toBe(before.answers + rows.length);
    expect(after.mastery - before.mastery).toBeGreaterThan(0.1);
  });
});
