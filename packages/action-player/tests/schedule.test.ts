import { describe, expect, it } from 'vitest';
import type { Action } from '@openmaic/dsl';
import { isBlocking, nextBoundary } from '../src/schedule';

describe('some actions must finish before the next one starts', () => {
  it('treats speech as blocking — the tutor does not talk over herself', () => {
    expect(isBlocking({ id: 'a', type: 'speech', text: 'hello' })).toBe(true);
  });

  it('treats drawing as blocking — the ink lands before the next stroke', () => {
    expect(isBlocking({ id: 'a', type: 'wb_draw_text', content: 'x', x: 0, y: 0 })).toBe(true);
  });

  it('treats a laser as fire-and-forget — pointing does not stop the lesson', () => {
    expect(isBlocking({ id: 'a', type: 'laser', elementId: 'e1' })).toBe(false);
  });

  it('treats a spotlight as fire-and-forget', () => {
    expect(isBlocking({ id: 'a', type: 'spotlight', elementId: 'e1' })).toBe(false);
  });
});

describe('a raised hand interrupts at a boundary, never mid-action', () => {
  const lesson: Action[] = [
    { id: 'a0', type: 'speech', text: 'Look at the mitochondrion.' },
    { id: 'a1', type: 'laser', elementId: 'e1' },
    { id: 'a2', type: 'spotlight', elementId: 'e1' },
    { id: 'a3', type: 'speech', text: 'This fold is a crista.' },
  ];

  it('returns the index itself when it already sits on a blocking action', () => {
    expect(nextBoundary(lesson, 0)).toBe(0);
    expect(nextBoundary(lesson, 3)).toBe(3);
  });

  it('skips past fire-and-forget actions to the next blocking one', () => {
    // Pausing on a laser would freeze a pointer on screen with nothing being said.
    expect(nextBoundary(lesson, 1)).toBe(3);
    expect(nextBoundary(lesson, 2)).toBe(3);
  });

  it('returns the length when nothing blocking remains', () => {
    expect(nextBoundary(lesson, 4)).toBe(4);
    expect(nextBoundary([{ id: 'a', type: 'laser', elementId: 'e' }], 0)).toBe(1);
  });

  it('clamps a negative index to the start', () => {
    expect(nextBoundary(lesson, -5)).toBe(0);
  });
});
