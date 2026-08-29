import { describe, expect, it } from 'vitest';
import { CANVAS_H, CANVAS_W, type Element } from '@ai-tutor/lesson-format';
import { BOARD, layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[]): ScriptBeat => ({
  id: 'b1',
  topic: 't',
  narration: 'n',
  board,
});

/** The rectangle an element covers, for collision checks. */
function rectOf(el: Element): { x: number; y: number; w: number; h: number } | null {
  switch (el.kind) {
    case 'box':
    case 'diagram':
    case 'chart':
    case 'image':
    case 'doc':
    case 'model3d':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'note':
      // Height is the layout's own estimate; a generous constant is enough to
      // catch a note landing on top of a picture.
      return { x: el.x, y: el.y, w: el.w, h: 60 };
    default:
      return null;
  }
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the planner never chooses a coordinate', () => {
  it('places a title in the top band and a caption in the bottom one', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'title', text: 'Speed', sub: 'Class 9' },
        { do: 'caption', text: 'Steeper means faster.' },
      ]),
    );
    const title = elements.find((e) => e.kind === 'title')!;
    const caption = elements.find((e) => e.kind === 'text')!;
    expect('y' in title && title.y).toBeLessThan(BOARD.MAIN.y);
    expect('y' in caption && caption.y).toBeGreaterThan(BOARD.MAIN.y + BOARD.MAIN.h);
  });

  it('centres a title and a caption horizontally, always', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'title', text: 'Speed' },
        { do: 'caption', text: 'A caption' },
      ]),
    );
    for (const el of elements) expect('x' in el && el.x).toBe(CANVAS_W / 2);
  });

  it('keeps everything inside the board', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'title', text: 'Speed' },
        { do: 'diagram', ref: 'd_track' },
        { do: 'equation', text: 'v = s / t' },
        { do: 'caption', text: 'Steeper means faster.' },
      ]),
    );
    for (const el of elements) {
      const r = rectOf(el);
      if (!r) continue;
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(CANVAS_W);
      expect(r.y + r.h).toBeLessThanOrEqual(CANVAS_H);
    }
  });
});

describe('two things can never land on top of each other', () => {
  // The bug this package exists for: a real planner put a box at y 355..475 and
  // a line of text at y 425, and the board drew exactly that.
  it('stacks a diagram, a note and an equation without overlap', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'title', text: 'Speed' },
        { do: 'diagram', ref: 'd_track' },
        { do: 'note', text: 'Distance over time. That is the whole idea.' },
        { do: 'equation', text: 'v = s / t' },
      ]),
    );
    const rects = elements.map(rectOf).filter((r): r is NonNullable<typeof r> => r !== null);
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it('lays a run of cards side by side, equal width, not stacked on each other', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'card', heading: 'SI unit', body: 'metre per second' },
        { do: 'card', heading: 'Everyday unit', body: 'kilometre per hour' },
      ]),
    );
    const boxes = elements.filter((e) => e.kind === 'box') as Extract<
      Element,
      { kind: 'box' }
    >[];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].w).toBeCloseTo(boxes[1].w, 6);
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(overlaps(boxes[0], boxes[1])).toBe(false);
  });

  it("puts a card's heading and body inside its own box, and never on each other", () => {
    const { elements } = layoutBeat(
      beat([{ do: 'card', heading: 'SI unit', body: 'metre per second' }]),
    );
    const box = elements.find((e) => e.kind === 'box') as Extract<Element, { kind: 'box' }>;
    const texts = elements.filter((e) => e.kind === 'text') as Extract<
      Element,
      { kind: 'text' }
    >[];

    expect(texts).toHaveLength(2);
    // The box's own label is empty on purpose: a centred label plus a body line
    // is exactly how the two used to collide.
    expect(box.label).toBe('');
    for (const t of texts) {
      expect(t.y).toBeGreaterThan(box.y);
      expect(t.y).toBeLessThan(box.y + box.h);
    }
    expect(Math.abs(texts[0].y - texts[1].y)).toBeGreaterThan(24);
  });
});

describe('pointing is not a layout decision', () => {
  it('turns point into focus without adding an element', () => {
    const { elements, laid } = layoutBeat(
      beat([
        { do: 'diagram', ref: 'd_track' },
        { do: 'point', ref: 'd_track', part: 'car_a' },
      ]),
    );
    expect(elements.filter((e) => e.kind === 'diagram')).toHaveLength(1);
    expect(laid.focus).toEqual(['d_track#car_a']);
  });

  it('drops a point at a picture this beat does not show', () => {
    // Otherwise the tutor gestures at nothing and nobody finds out at runtime.
    const { laid } = layoutBeat(beat([{ do: 'point', ref: 'd_gone', part: 'car_a' }]));
    expect(laid.focus).toEqual([]);
  });
});

describe('the board fills up rather than clustering', () => {
  it('gives a lone picture the whole main band', () => {
    const { elements } = layoutBeat(beat([{ do: 'diagram', ref: 'd_track' }]));
    const d = elements[0] as Extract<Element, { kind: 'diagram' }>;
    expect(d.h).toBeCloseTo(BOARD.MAIN.h, 0);
    expect(d.w).toBe(CANVAS_W - BOARD.SIDE * 2);
  });

  it('shrinks the picture when something else needs room', () => {
    const alone = layoutBeat(beat([{ do: 'diagram', ref: 'd' }]));
    const shared = layoutBeat(
      beat([
        { do: 'diagram', ref: 'd' },
        { do: 'equation', text: 'v = s / t' },
      ]),
    );
    const h = (r: { elements: Element[] }) =>
      (r.elements.find((e) => e.kind === 'diagram') as Extract<Element, { kind: 'diagram' }>).h;
    expect(h(shared)).toBeLessThan(h(alone));
  });

  it('centres a short stack instead of leaving it at the top', () => {
    const { elements } = layoutBeat(beat([{ do: 'equation', text: 'v = s / t' }]));
    const f = elements[0] as Extract<Element, { kind: 'formula' }>;
    expect(f.y).toBeGreaterThan(BOARD.MAIN.y + 80);
    expect(f.y).toBeLessThan(BOARD.MAIN.y + BOARD.MAIN.h - 80);
  });

  it('produces nothing at all for an empty board', () => {
    const { elements, laid } = layoutBeat(beat([]));
    expect(elements).toEqual([]);
    expect(laid.show).toEqual([]);
  });
});
