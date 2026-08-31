import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * A SKETCH beside the picture, with a long arrow from the part it explains.
 *
 * Aarav's third mark-up: "take a long arrow from the water inside the glass and
 * draw tiny particles while speaking." A photograph shows the glass; what is
 * INSIDE the water is a drawing — small, beside it, joined to the exact spot
 * by an arrow. The move every textbook zoom-in is made of, and the one the
 * board could not make: a page held exactly one figure.
 */

const parts = new Map([['glass', [{ name: 'water', x: 0.2, y: 0.35, w: 0.5, h: 0.45 }]]]);
const board: Instruction[] = [
  { do: 'title', text: 'Spaces between particles' },
  { do: 'picture', ref: 'glass' },
  { do: 'say', text: 'Where did the sugar go?' },
  { do: 'label', target: 'glass#water', text: 'Water' },
  { do: 'say', text: 'Look inside the water.' },
  { do: 'sketch', ref: 'particles', from: 'glass#water' },
];
const laid = layoutBeat({ id: 's', topic: 'matter', narration: '', board } as ScriptBeat, parts);
const picture = boxOf(laid.elements.find((el) => el.kind === 'image')!);
const sketch = laid.elements.find((el) => el.kind === 'diagram' && el.id === 'particles');
const arrow = laid.elements.find((el) => el.kind === 'arrow' && el.id === 's_5_arrow') as
  | Extract<Element, { kind: 'arrow' }>
  | undefined;

describe('a sketch beside the picture', () => {
  it('is drawn, on the same page as the picture', () => {
    expect(sketch).toBeDefined();
    const s = boxOf(sketch!);
    expect(Math.floor(s.x / 1260)).toBe(Math.floor(picture.x / 1260));
  });

  it('sits beside the picture, not on it', () => {
    const s = boxOf(sketch!);
    expect(s.x).toBeGreaterThanOrEqual(picture.x + picture.w);
  });

  it('is big enough to read as a drawing', () => {
    const s = boxOf(sketch!);
    expect(s.w).toBeGreaterThanOrEqual(150);
    expect(s.h).toBeGreaterThanOrEqual(120);
  });

  it('runs an arrow from the part it explains to the sketch', () => {
    expect(arrow).toBeDefined();
    // From inside the water, to the sketch's near edge.
    expect(arrow!.from.x).toBeGreaterThan(picture.x);
    expect(arrow!.from.x).toBeLessThan(picture.x + picture.w);
    const s = boxOf(sketch!);
    expect(Math.abs(arrow!.to.x - s.x)).toBeLessThan(12);
  });

  it('keeps the names on the other side, so nothing shares the room', () => {
    const name = boxOf(laid.elements.find((el) => el.id === 's_3')!);
    expect(name.x + name.w).toBeLessThanOrEqual(picture.x);
  });

  it('arrives on the line that asks for it', () => {
    expect(laid.steps[1].show).toContain('particles');
    expect(laid.steps[0].show).not.toContain('particles');
  });
});
