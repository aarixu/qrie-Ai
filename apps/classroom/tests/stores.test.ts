import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalStore } from '../src/stores/localStore';
import { computeStreak, type Progress } from '../src/stores/progress';

beforeEach(() => {
  localStorage.clear();
});

describe('createLocalStore', () => {
  it('round-trips through localStorage', () => {
    const a = createLocalStore('t:rt', { n: 1 });
    a.set({ n: 5 });
    // A fresh store over the same key sees the persisted value.
    const b = createLocalStore('t:rt', { n: 1 });
    expect(b.get()).toEqual({ n: 5 });
  });

  it('falls back to the initial value on corrupt JSON', () => {
    localStorage.setItem('t:bad', '{not json');
    const s = createLocalStore('t:bad', { ok: true });
    expect(s.get()).toEqual({ ok: true });
  });

  it('notifies subscribers on set and stops after unsubscribe', () => {
    const s = createLocalStore('t:sub', 0);
    let calls = 0;
    const off = s.subscribe(() => {
      calls += 1;
    });
    s.set(1);
    off();
    s.set(2);
    expect(calls).toBe(1);
  });
});

describe('computeStreak', () => {
  const progressWith = (...isoDays: string[]): Progress => ({
    lastLessonId: null,
    lessons: Object.fromEntries(
      isoDays.map((day, i) => [`l${i}`, { beatIndex: 0, completedAt: `${day}T10:00:00.000Z` }]),
    ),
  });
  const today = new Date('2026-08-22T15:00:00.000Z');

  it('is 0 with no completions', () => {
    expect(computeStreak({ lessons: {}, lastLessonId: null }, today)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    expect(computeStreak(progressWith('2026-08-20', '2026-08-21', '2026-08-22'), today)).toBe(3);
  });

  it('stays alive when the run ends yesterday (today is not over)', () => {
    expect(computeStreak(progressWith('2026-08-20', '2026-08-21'), today)).toBe(2);
  });

  it('breaks on a gap', () => {
    expect(computeStreak(progressWith('2026-08-18', '2026-08-22'), today)).toBe(1);
    expect(computeStreak(progressWith('2026-08-18', '2026-08-19'), today)).toBe(0);
  });

  it('counts a day once regardless of how many lessons finished that day', () => {
    expect(computeStreak(progressWith('2026-08-22', '2026-08-22', '2026-08-22'), today)).toBe(1);
  });
});
