import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import type { Instruction } from '@ai-tutor/board-layout';
import { assemble } from '../src/prepare';
import { gateLesson } from '../src/gate';
import type { Blueprint } from '../src/types';

/** C3: a derivation is maths on the board, so the keep gate checks it. */
function gateFor(steps: string[]) {
  const board: Instruction[] = [
    { do: 'title', text: 'Solving for x' },
    { do: 'say', text: 'Let us solve two x plus three equals eleven.' },
    { do: 'derive', steps },
    { do: 'say', text: 'So x is four.' },
  ];
  const plan = { id: 'derive', title: 'Derive', visuals: [], beats: [{ id: 'b1', topic: 'Solve', narration: '', board }] };
  const made = assemble(plan as unknown as Blueprint, new Set(), new Map(), new Map());
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return gateLesson(checked.lesson as Lesson, { bonds: made.bonds, unspoken: made.unspoken, undrawn: made.undrawn });
}

describe('the keep gate reads a derivation', () => {
  it('keeps working whose every step is true', () => {
    expect(gateFor(['2x + 3 = 11', '2x = 8', 'x = 4']).filter((p) => p.rule === 'maths')).toEqual([]);
  });

  it('refuses working with a wrong step', () => {
    expect(gateFor(['2x + 3 = 11', '2x = 8', 'x = 5']).some((p) => p.rule === 'maths')).toBe(true);
  });
});
