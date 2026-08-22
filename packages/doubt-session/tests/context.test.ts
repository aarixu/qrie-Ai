import { describe, it, expect } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { buildContext } from '../src/context';

/** Three-beat lesson small enough to reason about in every test. */
function miniLesson(): Lesson {
  return {
    formatVersion: 1,
    id: 'mini',
    title: 'Mini',
    language: 'hi-en',
    canvas: { w: 1000, h: 620 },
    elements: [
      { kind: 'title', id: 'e1', x: 0, y: 0, text: 'T' },
      { kind: 'text', id: 'e2', x: 0, y: 100, text: 'body' },
      { kind: 'box', id: 'e3', x: 0, y: 200, w: 100, h: 50, label: 'B' },
    ],
    beats: [
      { id: 'b0', topic: 'the heart', narration: 'n0', show: ['e1'] },
      { id: 'b1', topic: 'chambers', narration: 'n1', show: ['e1', 'e2'] },
      { id: 'b2', topic: 'valves', narration: 'n2', show: ['e2', 'e3'] },
    ],
  };
}

describe('buildContext', () => {
  it('derives the full briefing for a mid-lesson beat', () => {
    const ctx = buildContext(miniLesson(), 1);
    expect(ctx.lessonId).toBe('mini');
    expect(ctx.beatId).toBe('b1');
    expect(ctx.beatTopic).toBe('chambers');
    expect(ctx.transcriptSoFar).toBe('n0\nn1');
    expect(ctx.visibleElementIds).toEqual(['e1', 'e2']);
    expect(ctx.recentBeats).toEqual([
      { id: 'b0', topic: 'the heart' },
      { id: 'b1', topic: 'chambers' },
    ]);
  });

  it('includes only the first beat at index 0', () => {
    const ctx = buildContext(miniLesson(), 0);
    expect(ctx.transcriptSoFar).toBe('n0');
    expect(ctx.recentBeats).toEqual([{ id: 'b0', topic: 'the heart' }]);
  });

  it('covers the whole transcript at the last beat', () => {
    const ctx = buildContext(miniLesson(), 2);
    expect(ctx.transcriptSoFar).toBe('n0\nn1\nn2');
    expect(ctx.recentBeats.map((b) => b.id)).toEqual(['b0', 'b1', 'b2']);
  });

  it('clamps a negative index to the first beat', () => {
    expect(buildContext(miniLesson(), -5).beatId).toBe('b0');
  });

  it('clamps an out-of-range index to the last beat', () => {
    expect(buildContext(miniLesson(), 99).beatId).toBe('b2');
  });

  it('floors a fractional index', () => {
    expect(buildContext(miniLesson(), 1.9).beatId).toBe('b1');
  });

  it('treats a non-finite index as the first beat', () => {
    expect(buildContext(miniLesson(), Number.NaN).beatId).toBe('b0');
    expect(buildContext(miniLesson(), Number.POSITIVE_INFINITY).beatId).toBe('b0');
  });

  it('hands out copies, not references into the lesson', () => {
    const lesson = miniLesson();
    const ctx = buildContext(lesson, 1);
    ctx.visibleElementIds.push('junk');
    ctx.recentBeats.pop();
    expect(lesson.beats[1].show).toEqual(['e1', 'e2']);
    expect(lesson.beats.length).toBe(3);
  });
});
