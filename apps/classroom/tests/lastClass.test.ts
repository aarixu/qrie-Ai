import { beforeEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({
  fn: vi.fn(async () => [
    { id: 'heart', title: 'The Heart', path: 'lessons/heart' },
    { id: 'nucleus', title: 'Inside the Nucleus', path: 'lessons/nucleus' },
  ]),
}));
vi.mock('../src/lib/content', () => ({ fetchCatalog: catalog.fn }));

import { lastClassBefore } from '../src/lib/lastClass';
import { progressStore } from '../src/stores/progress';

/**
 * What the tutor is allowed to remember about a student.
 *
 * A title and a date, and nothing else — the conversation itself is never
 * kept. These tests are as much about what is NOT returned as what is: null
 * where there is nothing true to say, because the persona's rule is that an
 * absent signal produces no line rather than a default one.
 */

const AT = (iso: string) => ({ beatIndex: 0, completedAt: iso });
/**
 * Built fresh on every use, never shared. A single module-level Date here was
 * mutated by the first case that passed it in, and every case after it then
 * measured from midnight without one of them failing.
 */
const NOW = () => new Date('2026-09-02T10:00:00+05:30');

beforeEach(() => {
  localStorage.clear();
  progressStore.set({ lessons: {}, lastLessonId: null });
  catalog.fn.mockClear();
});

describe('lastClassBefore', () => {
  it('is null for a student who has never finished one', async () => {
    expect(await lastClassBefore(undefined, NOW())).toBeNull();
  });

  it('is null when the only lessons are unfinished', async () => {
    progressStore.set({ lessons: { heart: { beatIndex: 3 } }, lastLessonId: 'heart' });
    expect(await lastClassBefore(undefined, NOW())).toBeNull();
  });

  it('names the most recent finished class, not the first', async () => {
    progressStore.set({
      lessons: {
        heart: AT('2026-08-20T09:00:00+05:30'),
        nucleus: AT('2026-08-31T18:00:00+05:30'),
      },
      lastLessonId: 'heart',
    });
    expect(await lastClassBefore(undefined, NOW())).toEqual({
      title: 'Inside the Nucleus',
      daysAgo: 2,
    });
  });

  it('counts calendar days, so an evening class is "yesterday" the next morning', async () => {
    progressStore.set({
      lessons: { heart: AT('2026-09-01T23:40:00+05:30') },
      lastLessonId: 'heart',
    });
    // Under twelve hours apart, but a student says "yesterday", not "today".
    expect((await lastClassBefore(undefined, NOW()))?.daysAgo).toBe(1);
  });

  it('says 0 for a class finished earlier the same day', async () => {
    progressStore.set({
      lessons: { heart: AT('2026-09-02T07:15:00+05:30') },
      lastLessonId: 'heart',
    });
    expect((await lastClassBefore(undefined, NOW()))?.daysAgo).toBe(0);
  });

  it('skips the class about to be taught, so a replay is not its own last time', async () => {
    progressStore.set({
      lessons: {
        heart: AT('2026-08-20T09:00:00+05:30'),
        nucleus: AT('2026-08-31T18:00:00+05:30'),
      },
      lastLessonId: 'nucleus',
    });
    expect(await lastClassBefore('nucleus', NOW())).toEqual({ title: 'The Heart', daysAgo: 13 });
  });

  it('is null rather than a slug when the catalogue cannot be reached', async () => {
    progressStore.set({
      lessons: { heart: AT('2026-08-31T18:00:00+05:30') },
      lastLessonId: 'heart',
    });
    catalog.fn.mockRejectedValueOnce(new Error('offline'));
    expect(await lastClassBefore(undefined, NOW())).toBeNull();
  });

  it('is null for a finished class the catalogue no longer lists', async () => {
    // A prepared class can be swept; remembering it by id would read worse
    // than not remembering it.
    progressStore.set({
      lessons: { 'gone-forever': AT('2026-08-31T18:00:00+05:30') },
      lastLessonId: 'gone-forever',
    });
    expect(await lastClassBefore(undefined, NOW())).toBeNull();
  });

  it('does not mutate the clock it was handed', async () => {
    // setHours on the caller's Date would silently rewind their `now`.
    const now = NOW();
    progressStore.set({
      lessons: { heart: AT('2026-08-31T18:00:00+05:30') },
      lastLessonId: 'heart',
    });
    expect(await lastClassBefore(undefined, now)).toEqual({ title: 'The Heart', daysAgo: 2 });
    expect(now.getTime()).toBe(NOW().getTime());
  });
});
