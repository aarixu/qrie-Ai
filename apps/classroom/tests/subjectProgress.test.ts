import { describe, expect, it } from 'vitest';
import { subjectNeedingAttention, subjectProgress } from '../src/lib/subjectProgress';
import type { CatalogEntry } from '../src/lib/content';
import type { Progress } from '../src/stores/progress';

/**
 * The app knew two numbers — lessons finished and days in a row — and neither
 * answers "am I behind in Science or in Maths".
 */

const lesson = (id: string, subject: string): CatalogEntry =>
  ({ id, subject, title: id, class: 9, path: `${id}/lesson.json` }) as CatalogEntry;

const progressWith = (done: Record<string, string>): Progress => ({
  lessons: Object.fromEntries(
    Object.entries(done).map(([id, at]) => [id, { beatIndex: 0, completedAt: at }]),
  ),
  lastLessonId: null,
}) as Progress;

const catalog = [
  lesson('s1', 'Science'),
  lesson('s2', 'Science'),
  lesson('s3', 'Science'),
  lesson('m1', 'Mathematics'),
];

describe('where a student stands, subject by subject', () => {
  it('counts what is finished against what exists, per subject', () => {
    const rows = subjectProgress({
      catalog,
      progress: progressWith({ s1: '2026-09-01T10:00:00Z', m1: '2026-09-02T10:00:00Z' }),
      chosen: ['Science', 'Mathematics'],
      offered: [],
    });
    const science = rows.find((r) => r.subject === 'Science')!;
    expect(science.done).toBe(1);
    expect(science.available).toBe(3);
    expect(science.share).toBeCloseTo(1 / 3);
  });

  it('remembers the most recent finish, not the first', () => {
    const rows = subjectProgress({
      catalog,
      progress: progressWith({ s1: '2026-08-01T10:00:00Z', s2: '2026-09-01T10:00:00Z' }),
      chosen: ['Science'],
      offered: [],
    });
    expect(rows[0].lastStudied).toBe('2026-09-01T10:00:00Z');
  });

  it('marks a subject with a syllabus and no lessons as empty, and its share as null', () => {
    // Class 9 Maths today: 306 mapped nodes, zero lessons. A bar at zero would
    // say "you have done none of it" when the truth is "there is none of it".
    const rows = subjectProgress({
      catalog: [lesson('s1', 'Science')],
      progress: progressWith({}),
      chosen: ['Science', 'Mathematics'],
      offered: [],
    });
    const maths = rows.find((r) => r.subject === 'Mathematics')!;
    expect(maths.empty).toBe(true);
    expect(maths.share).toBeNull();
    expect(rows.find((r) => r.subject === 'Science')!.empty).toBe(false);
  });

  it('falls back to what the class offers when nothing was chosen', () => {
    const rows = subjectProgress({
      catalog,
      progress: progressWith({}),
      chosen: [],
      offered: ['Science', 'Mathematics'],
    });
    expect(rows.map((r) => r.subject)).toEqual(['Mathematics', 'Science']);
  });

  it('keeps a stable order, so the list does not reshuffle as they work', () => {
    const before = subjectProgress({ catalog, progress: progressWith({}), chosen: ['Science', 'Mathematics'], offered: [] });
    const after = subjectProgress({
      catalog,
      progress: progressWith({ s1: '2026-09-01T10:00:00Z', s2: '2026-09-01T11:00:00Z' }),
      chosen: ['Science', 'Mathematics'],
      offered: [],
    });
    expect(after.map((r) => r.subject)).toEqual(before.map((r) => r.subject));
  });
});

describe('which subject is quietly being dropped', () => {
  const rows = (over: Partial<Record<string, string | null>>) =>
    subjectProgress({
      catalog,
      progress: progressWith(
        Object.fromEntries(
          Object.entries(over).filter(([, v]) => v !== null) as [string, string][],
        ),
      ),
      chosen: ['Science', 'Mathematics'],
      offered: [],
    });

  it('names the one touched least recently', () => {
    const out = subjectNeedingAttention(
      rows({ s1: '2026-09-05T10:00:00Z', m1: '2026-08-01T10:00:00Z' }),
    );
    expect(out).toBe('Mathematics');
  });

  it('prefers one never touched at all over one touched long ago', () => {
    const out = subjectNeedingAttention(rows({ s1: '2026-08-01T10:00:00Z' }));
    expect(out).toBe('Mathematics');
  });

  it('never points at a dead end', () => {
    const out = subjectNeedingAttention(
      subjectProgress({
        catalog: [lesson('s1', 'Science')],
        progress: progressWith({ s1: '2026-08-01T10:00:00Z' }),
        chosen: ['Science', 'Mathematics'],
        offered: [],
      }),
    );
    expect(out).toBe('Science');
  });

  it('says nothing when there is nothing to study', () => {
    expect(subjectNeedingAttention([])).toBeNull();
  });
});
