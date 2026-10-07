import { describe, expect, it } from 'vitest';
import { boxOf, CANVAS_W, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * One picture, taught on.
 *
 * This is the shape of a real board when a teacher is working on one figure:
 * the drawing stays big, she circles a part of it, and what she says goes up
 * the side as she says it. No second image, no slide change.
 */

const beat = (board: Instruction[], id = 'k'): ScriptBeat => ({
  id,
  topic: 't',
  narration: 'n',
  board,
});

const parts = new Map([
  [
    'kidney',
    [
      { name: 'cortex', x: 0.1, y: 0.12, w: 0.3, h: 0.3 },
      { name: 'renal pelvis', x: 0.45, y: 0.4, w: 0.2, h: 0.2 },
    ],
  ],
]);

const board: Instruction[] = [
  { do: 'title', text: 'Inside the Kidney' },
  { do: 'picture', ref: 'kidney' },
  { do: 'say', text: 'The outer layer is the cortex.' },
  { do: 'annotate', target: 'kidney#cortex', mark: 'circle', tone: 'accent' },
  { do: 'write', text: 'cortex — filters the blood' },
  { do: 'say', text: 'Everything drains into the funnel.' },
  { do: 'annotate', target: 'kidney#renal pelvis', mark: 'circle' },
  { do: 'write', text: 'pelvis — collects the urine' },
  { do: 'caption', text: 'Cortex to medulla to pelvis' },
];

const laid = layoutBeat(beat(board), parts);
const byId = new Map(laid.elements.map((el) => [el.id, el]));
const picture = laid.elements.find((el) => el.kind === 'image')!;

describe('a picture keeps the board while its points go up the side', () => {
  it('places the picture large, down the full height of the band', () => {
    const r = boxOf(picture);
    expect(r.w).toBeGreaterThan(400);
    expect(r.h).toBeGreaterThan(300);
  });

  it('writes the key points beside it, not underneath', () => {
    const pic = boxOf(picture);
    const written = laid.elements.filter((el) => el.kind === 'handwrite');
    expect(written.length).toBeGreaterThanOrEqual(2);
    for (const w of written) {
      expect(boxOf(w).x).toBeGreaterThan(pic.x + pic.w);
      expect(boxOf(w).x + boxOf(w).w).toBeLessThanOrEqual(CANVAS_W + 2);
    }
  });

  it('wraps a long point onto more lines rather than shrinking it away', () => {
    // A key point squeezed to one line of a narrow column comes out too small
    // to read from a desk, which is the one thing a key point may not be.
    // Long enough for any ruler her lines have had: measured as Caveat
    // (2026-10-02), the two short points above fit on one line.
    const long = layoutBeat(
      beat([
        ...board.slice(0, 7),
        { do: 'write', text: 'pelvis — collects the urine from every nephron and sends it down the ureter to the bladder' },
      ]),
      parts,
    );
    const written = long.elements.filter((el) => el.kind === 'handwrite');
    for (const w of written) expect(('size' in w ? w.size : 0) ?? 0).toBeGreaterThanOrEqual(24);
    expect(written.some((w) => /_l\d+$/.test(w.id))).toBe(true);
  });

  it('stacks the points in the order they were said, from the top', () => {
    // The first line of the first point, against the first line of the second.
    const first = laid.elements.find((el) => el.id === 'k_4')!;
    const second = laid.elements.find((el) => el.id === 'k_7')!;
    expect(boxOf(first).y).toBeLessThan(boxOf(second).y);
    // And the column starts at the top of the band, not centred in it.
    expect(boxOf(first).y).toBeLessThan(220);
  });
});

describe('marks land on the part they name', () => {
  const marks = laid.elements.filter((el) => el.kind === 'mark');

  it('draws one mark per annotation', () => {
    expect(marks).toHaveLength(2);
  });

  it('puts each mark inside the picture, where its part is', () => {
    const pic = boxOf(picture);
    for (const m of marks) {
      const r = boxOf(m);
      expect(r.x).toBeGreaterThan(pic.x - 20);
      expect(r.x + r.w).toBeLessThan(pic.x + pic.w + 20);
      expect(r.y).toBeGreaterThan(pic.y - 20);
    }
    // The cortex is up and to the left of the pelvis, and the marks agree.
    expect(boxOf(marks[0]).x).toBeLessThan(boxOf(marks[1]).x);
    expect(boxOf(marks[0]).y).toBeLessThan(boxOf(marks[1]).y);
  });

  it('draws no mark at all for a part nobody could find', () => {
    // A circle drawn because we guessed teaches the wrong thing with complete
    // confidence. Better to leave the picture unmarked.
    const missing = layoutBeat(
      beat([
        { do: 'picture', ref: 'kidney' },
        { do: 'annotate', target: 'kidney#nephron', mark: 'circle' },
      ]),
      parts,
    );
    expect(missing.elements.filter((el) => el.kind === 'mark')).toHaveLength(0);
  });
});

describe('the arrangement stays narrow on purpose', () => {
  it('falls back to the ordinary stack when the beat is a mixture', () => {
    // Anything other than one figure and its written points is a beat the
    // plain stack already handles well.
    const mixed = layoutBeat(
      beat([
        { do: 'picture', ref: 'kidney' },
        { do: 'write', text: 'a point' },
        { do: 'note', text: 'and an aside worth pausing on' },
      ]),
      parts,
    );
    const pic = mixed.elements.find((el) => el.kind === 'image')!;
    // Full width, because it is sharing the column rather than the row.
    expect(boxOf(pic).w).toBeGreaterThan(700);
  });

  it('gives a lone picture the whole band', () => {
    const alone = layoutBeat(beat([{ do: 'picture', ref: 'kidney' }]), parts);
    const pic = alone.elements.find((el) => el.kind === 'image')!;
    expect(boxOf(pic).w).toBeGreaterThan(700);
    expect(boxOf(pic).h).toBeGreaterThan(300);
  });
});

describe('a picture carries its parts so a lesson can be replayed', () => {
  it('keeps the named regions on the element', () => {
    const el = byId.get('kidney') as Extract<Element, { kind: 'image' }>;
    expect(el.parts?.map((p) => p.name)).toEqual(['cortex', 'renal pelvis']);
  });
});
