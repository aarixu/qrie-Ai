import { beforeEach, describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { PRIOR, applyDoubt, applyTaught } from '@ai-tutor/knowledge-graph';
import {
  outcomeStore,
  outcomesAtBeat,
  outcomesOf,
  recordDoubtAtBeat,
  recordLessonTaught,
  recordAnswerAtBeat,
} from '../src/stores/outcomes';

/** A lesson shaped the way the planner shapes one: hook, teach, check, recap. */
const lesson: Lesson = {
  formatVersion: 1,
  id: 'l1',
  title: 'Matter',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'text', id: 't', x: 500, y: 300, text: 'hi' }],
  beats: [
    { id: 'b1', topic: 'hook', narration: 'a puzzle', show: ['t'], teaches: [], checks: [] },
    { id: 'b2', topic: 'particles', narration: 'teaching', show: ['t'], teaches: ['particles'] },
    { id: 'b3', topic: 'matter', narration: 'teaching', show: ['t'], teaches: ['matter'] },
    { id: 'b4', topic: 'check', narration: 'a question', show: ['t'], checks: ['particles'] },
    { id: 'b5', topic: 'recap', narration: 'say it back', show: ['t'], checks: ['particles'] },
  ],
};

// The store caches in memory, so clearing localStorage alone leaves the
// previous test's counts in place.
beforeEach(() => {
  localStorage.clear();
  outcomeStore.set({ taught: {}, confused: {}, answeredRight: {}, answeredWrong: {}, updatedAt: null });
});

describe('reading outcomes off a lesson', () => {
  it('collects every outcome the lesson teaches, once each', () => {
    expect(outcomesOf(lesson)).toEqual(['particles', 'matter']);
  });

  it('locates the outcomes of one beat — what a hand raised there is about', () => {
    expect(outcomesAtBeat(lesson, 'b3')).toEqual(['matter']);
  });

  it('a hook and a recap teach nothing, and that is an answer not a gap', () => {
    expect(outcomesAtBeat(lesson, 'b1')).toEqual([]);
    expect(outcomesAtBeat(lesson, 'b5')).toEqual([]);
  });
});

describe('recording what the classroom saw', () => {
  it('a finished lesson counts as taught for every outcome in it', () => {
    recordLessonTaught(lesson);
    expect(outcomeStore.get().taught).toEqual({ particles: 1, matter: 1 });
  });

  it('watching twice counts twice — rewatching is a signal of its own', () => {
    recordLessonTaught(lesson);
    recordLessonTaught(lesson);
    expect(outcomeStore.get().taught.particles).toBe(2);
  });

  it('a raised hand lands on the outcomes of that beat only', () => {
    recordDoubtAtBeat(lesson, 'b3');
    expect(outcomeStore.get().confused).toEqual({ matter: 1 });
  });

  it('a hand raised during a hook records nothing to blame', () => {
    recordDoubtAtBeat(lesson, 'b1');
    expect(outcomeStore.get().confused).toEqual({});
  });

  it('a lesson from before the map existed is silently ignored', () => {
    const old: Lesson = { ...lesson, beats: lesson.beats.map(({ teaches, ...b }) => b) };
    recordLessonTaught(old);
    expect(outcomeStore.get().taught).toEqual({});
  });
});

describe('what those signals are worth', () => {
  it('being taught raises belief, but far less than answering would', () => {
    const after = applyTaught({ a: PRIOR }, ['a']);
    expect(after.a).toBeGreaterThan(PRIOR);
    // A correct answer takes 0.5 to ~0.78; attendance must stay well under it.
    expect(after.a).toBeLessThan(0.65);
  });

  it('saturates — the third viewing moves belief less than the first', () => {
    const once = applyTaught({ a: PRIOR }, ['a'], 1).a - PRIOR;
    const thrice = applyTaught({ a: PRIOR }, ['a'], 3).a - PRIOR;
    expect(thrice).toBeGreaterThan(once);
    expect(thrice).toBeLessThan(once * 2); // rewatching is not proof
  });

  it('confusion pulls the other way, and the two can coexist', () => {
    const taught = applyTaught({ a: PRIOR }, ['a']);
    const confused = applyDoubt(taught, ['a']);
    // Sat through it, then stopped the class on it: back below where it began.
    expect(confused.a).toBeLessThan(taught.a);
  });
});

describe('an in-class answer is the strongest signal of the three', () => {
  const lesson = {
    formatVersion: 1,
    id: 'l',
    title: 'T',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [],
    beats: [
      { id: 'b1', topic: 't', narration: 'n', show: [], teaches: ['out.a'], checks: ['out.b'] },
      { id: 'b2', topic: 't', narration: 'n', show: [], teaches: ['out.c'] },
      { id: 'b3', topic: 't', narration: 'n', show: [] },
    ],
  } as never;

  it('lands on what the beat CHECKS, not what it happens to teach around', () => {
    outcomeStore.update(() => ({ taught: {}, confused: {}, answeredRight: {}, answeredWrong: {}, updatedAt: null }));
    recordAnswerAtBeat(lesson, 'b1', true);
    expect(outcomeStore.get().answeredRight).toEqual({ 'out.b': 1 });
    expect(outcomeStore.get().answeredWrong).toEqual({});
  });

  it('keeps wrong apart from right — they are opposite evidence', () => {
    outcomeStore.update(() => ({ taught: {}, confused: {}, answeredRight: {}, answeredWrong: {}, updatedAt: null }));
    recordAnswerAtBeat(lesson, 'b2', false);
    expect(outcomeStore.get().answeredWrong).toEqual({ 'out.c': 1 });
  });

  it('records nothing for a beat that checks and teaches nothing', () => {
    outcomeStore.update(() => ({ taught: {}, confused: {}, answeredRight: {}, answeredWrong: {}, updatedAt: null }));
    recordAnswerAtBeat(lesson, 'b3', true);
    expect(outcomeStore.get().answeredRight).toEqual({});
  });
});
