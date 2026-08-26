import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANVAS_H, CANVAS_W, type Beat, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { initialBoard, reduce, WB_HEIGHT } from '@ai-tutor/action-player';
import { planToScene } from '../src/planToScene';

/**
 * The round trip through the action stream must not move anything.
 *
 * Elements are authored in our 1000x620 space; their whiteboard verbs are
 * documented in 1000x562. `planToScene` converts down, `reduce` scales back up.
 * Get one of those wrong and the whole lesson slides 10% down the board — which
 * is exactly what happened before this test existed, and which every id-based
 * assertion in this package cheerfully passed.
 */

const lesson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'content/class9-particle-size/lesson.json'), 'utf8'),
) as Lesson;

const yOf = (el: Element): number | null => ('y' in el ? el.y : null);

describe('a real lesson comes back where it started', () => {
  const { actions } = planToScene(lesson);
  const board = actions.reduce(reduce, initialBoard);
  const source = new Map(lesson.elements.map((e) => [e.id, e]));

  it('draws every element at the y it was authored at', () => {
    const moved: string[] = [];
    for (const drawn of board.elements) {
      const original = source.get(drawn.id);
      if (!original) continue;
      const before = yOf(original);
      const after = yOf(drawn);
      if (before === null || after === null) continue;
      // Floating point only; anything larger is a space conversion bug.
      if (Math.abs(before - after) > 0.001) moved.push(`${drawn.id}: ${before} -> ${after}`);
    }
    expect(moved).toEqual([]);
  });

  it('keeps every arrow endpoint where it was authored', () => {
    for (const drawn of board.elements) {
      if (drawn.kind !== 'arrow') continue;
      const original = source.get(drawn.id);
      if (original?.kind !== 'arrow') continue;
      expect(drawn.from.y).toBeCloseTo(original.from.y, 3);
      expect(drawn.to.y).toBeCloseTo(original.to.y, 3);
    }
  });

  it('keeps every box the height it was authored at', () => {
    for (const drawn of board.elements) {
      if (drawn.kind !== 'box') continue;
      const original = source.get(drawn.id);
      if (original?.kind !== 'box') continue;
      expect(drawn.h).toBeCloseTo(original.h, 3);
    }
  });

  it('leaves nothing off the canvas', () => {
    const escaped = board.elements
      .filter((el) => {
        const y = yOf(el);
        return y !== null && (y < 0 || y > CANVAS_H);
      })
      .map((el) => el.id);
    expect(escaped).toEqual([]);
  });
});

describe('an element authored at the very bottom still lands on the board', () => {
  // The regression this guards is silent on the real lesson, whose lowest
  // element sits at y=500: unconverted, it landed at 552, still inside 620.
  // An element at 600 is what makes the bug visible, so the test authors one.
  it('does not push a low element off the bottom', () => {
    const elements: Element[] = [
      { kind: 'text', id: 'e_low', x: CANVAS_W / 2, y: 600, text: 'right at the bottom' },
    ];
    const beats: Beat[] = [{ id: 'b1', topic: 't', narration: 'look down here', show: ['e_low'] }];

    const { actions } = planToScene({ elements, beats });
    const board = actions.reduce(reduce, initialBoard);
    const drawn = board.elements.find((e) => e.id === 'e_low')!;

    expect('y' in drawn && drawn.y).toBeCloseTo(600, 3);
    expect('y' in drawn && drawn.y).toBeLessThanOrEqual(CANVAS_H);
  });

  it('emits that element inside their 562-high whiteboard space', () => {
    const elements: Element[] = [
      { kind: 'text', id: 'e_low', x: 500, y: 600, text: 'right at the bottom' },
    ];
    const beats: Beat[] = [{ id: 'b1', topic: 't', narration: 'x', show: ['e_low'] }];

    const { actions } = planToScene({ elements, beats });
    const draw = actions.find((a) => a.type === 'wb_draw_text') as { y: number };
    expect(draw.y).toBeLessThanOrEqual(WB_HEIGHT);
  });
});
