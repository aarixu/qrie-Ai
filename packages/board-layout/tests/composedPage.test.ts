import { describe, expect, it } from 'vitest';
import { boxOf, CANVAS_H, CANVAS_W, PAGE_STRIDE, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import { ARRANGEMENTS, coverage, PAGE } from '../src/compose';
import type { Instruction } from '../src/types';

const beat = (board: Instruction[]) => ({ id: 'b1', topic: 't', narration: '', board });
const composed = (board: Instruction[], shapes = new Map<string, number>()) =>
  layoutBeat(beat(board), new Map(), shapes, { composed: true });
const inRegion = (el: Element, r: { x: number; y: number; w: number; h: number }): boolean => {
  const b = boxOf(el);
  return b.x >= r.x - 3 && b.y >= r.y - 3 && b.x + b.w <= r.x + r.w + 3 && b.y + b.h <= r.y + r.h + 3;
};

const FLOW_PAGE: Instruction[] = [
  { do: 'title', text: 'Digestion', path: ['Life processes', 'Digestion'] },
  { do: 'say', text: 'Food moves through four places.' },
  { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Small intestine' }, { label: 'Large intestine' }] },
  { do: 'say', text: 'Each place does one job.' },
  {
    do: 'list',
    heading: 'What each does',
    items: [
      { term: 'Mouth', meaning: 'chews and wets the food' },
      { term: 'Stomach', meaning: 'churns it with acid' },
    ],
  },
  { do: 'say', text: 'Most of it happens in the small intestine.' },
  { do: 'write', text: 'Most digestion: small intestine' },
  { do: 'say', text: 'So food is broken down, then taken in.' },
  { do: 'summary', text: 'Break it down, then absorb it' },
];

describe('a composed page', () => {
  it('writes the title in the header, with its path small above it', () => {
    const made = composed(FLOW_PAGE);
    const title = made.elements.find((e) => e.kind === 'title')!;
    const crumb = made.elements.find((e) => e.kind === 'text' && e.text.includes('›'))!;
    expect(crumb).toMatchObject({ text: 'Life processes › Digestion', muted: true });
    // Readable on a phone (12px on a 667px stage) in the pull-out, whose frame is the whole page
    // padded to 16:9: 1102 units wide.
    expect(((crumb as { size?: number }).size ?? 20) * (667 / 1102)).toBeGreaterThanOrEqual(12);
    expect(boxOf(crumb).y + boxOf(crumb).h).toBeLessThanOrEqual(boxOf(title).y);
    expect(boxOf(title).y + boxOf(title).h).toBeLessThanOrEqual(PAGE.top);
    expect(made.regions[title.id]).toBe('0/header');
    expect(made.regions[crumb.id]).toBe('0/header');
  });

  it('puts the flow on top, the notes left, the key point right and the summary in its place', () => {
    const made = composed(FLOW_PAGE);
    const regionOf = (kind: string) => made.elements.filter((e) => e.kind === kind).map((e) => made.regions[e.id]);
    expect(regionOf('flow')).toEqual(['0/main']);
    expect(regionOf('list')).toEqual(['0/left']);
    expect(regionOf('handwrite')).toEqual(['0/right']);
    expect(regionOf('box')).toEqual(['0/summary']);
    // The summary is written on the page's last line, the pull-out (1102 wide): it must read there.
    const summary = made.elements.filter((e) => e.kind === 'text' && made.regions[e.id] === '0/summary');
    for (const line of summary) expect(((line as { size?: number }).size ?? 20) * (667 / 1102)).toBeGreaterThanOrEqual(12);
    const process = ARRANGEMENTS.process;
    expect(inRegion(made.elements.find((e) => e.kind === 'list')!, process.regions[0])).toBe(true);
    expect(made.pages).toBe(1);
  });

  it('keeps everything on the board, and gives every element a region', () => {
    const made = composed(FLOW_PAGE);
    for (const el of made.elements) {
      const b = boxOf(el);
      expect(b.x, el.id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, el.id).toBeLessThanOrEqual(CANVAS_W);
      expect(b.y, el.id).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h, el.id).toBeLessThanOrEqual(CANVAS_H);
      expect(made.regions[el.id], el.id).toBeDefined();
    }
  });

  it('reports how full the page is and what is on it', () => {
    const made = composed(FLOW_PAGE);
    expect(made.sheets).toEqual([expect.objectContaining({ sheet: 0, main: true, notes: true, points: 1, summary: true })]);
    expect(made.sheets[0].coverage).toBeGreaterThan(0.2);
    expect(made.sheets[0].coverage).toBeLessThanOrEqual(1);
  });

  it('counts a column of key points as written from its first line to its last, not line by line', () => {
    const board: Instruction[] = [];
    for (let n = 0; n < 5; n += 1) board.push({ do: 'say', text: `Point ${n}.` }, { do: 'write', text: `Key point number ${n}` });
    const made = composed(board);
    const inkOnly = coverage(made.elements.map(boxOf), 0);
    expect(made.sheets[0].coverage).toBeGreaterThan(inkOnly);
  });

  it('writes key points from the left with a bullet, and a wrapped point under its own words (Aarav, 2026-10-04)', () => {
    const made = composed([
      { do: 'say', text: 'One.' },
      { do: 'write', text: 'Villi are tiny fingers' },
      { do: 'say', text: 'Two.' },
      { do: 'write', text: 'Whatever is not absorbed moves on to the large intestine, where water is taken back' },
    ]);
    const written = made.elements.filter((e) => e.kind === 'handwrite') as Extract<Element, { kind: 'handwrite' }>[];
    const bullets = made.elements.filter((e) => e.kind === 'text' && e.text === '•');
    expect(bullets).toHaveLength(2);
    // Every line, first or wrapped, starts at the same left edge, right of its bullet.
    const lefts = written.map((e) => Math.round(boxOf(e).x));
    expect(new Set(lefts).size).toBe(1);
    expect(written.length).toBeGreaterThan(2);
    for (const b of bullets) expect(boxOf(b).x + boxOf(b).w).toBeLessThanOrEqual(lefts[0]);
    // Each bullet sits level with the first line of its point.
    const first = written.filter((e) => !e.id.includes('_l'));
    expect(bullets.map((b) => (b as { y: number }).y)).toEqual(first.map((e) => e.y));
  });

  it('keeps key points centred, with no bullet, on a stacked board', () => {
    const made = layoutBeat(beat([{ do: 'say', text: 'One.' }, { do: 'write', text: 'Villi are tiny fingers' }]));
    expect(made.elements.some((e) => e.kind === 'text' && e.text === '•')).toBe(false);
  });

  it('writes key points smaller than a stacked board, because the camera comes close', () => {
    const made = composed([{ do: 'say', text: 'One.' }, { do: 'write', text: 'Villi are tiny fingers' }]);
    // 20, against a stacked board's 24 (both 0.9 of their Caveat sizes, 2026-10-07).
    expect(made.elements.filter((e) => e.kind === 'handwrite').map((e) => (e as { size?: number }).size)).toEqual([20]);
  });

  it('puts a picture with no names in the hero region, and its notes beside it', () => {
    const made = composed(
      [
        { do: 'say', text: 'This is the heart.' },
        { do: 'picture', ref: 'heart' },
        { do: 'say', text: 'It has four rooms.' },
        { do: 'list', heading: 'Chambers', items: [{ term: 'Atria', meaning: 'receive blood' }, { term: 'Ventricles', meaning: 'pump it out' }] },
        { do: 'say', text: 'The left side is thicker.' },
        { do: 'write', text: 'Left wall is thickest' },
      ],
      new Map([['heart', 1]]),
    );
    const image = made.elements.find((e) => e.kind === 'image')!;
    expect(made.regions[image.id]).toBe('0/hero');
    expect(inRegion(image, ARRANGEMENTS.figure.main!)).toBe(true);
    expect(made.regions[made.elements.find((e) => e.kind === 'list')!.id]).toBe('0/side');
    expect(made.regions[made.elements.find((e) => e.kind === 'handwrite')!.id]).toBe('0/bottom');
  });

  it('turns to a notes page when the regions are full, and says so', () => {
    const board: Instruction[] = [{ do: 'say', text: 'Look.' }, { do: 'picture', ref: 'heart' }];
    for (let n = 0; n < 16; n += 1) board.push({ do: 'say', text: `Point ${n}.` }, { do: 'write', text: `Key point number ${n} about the heart` });
    const made = composed(board, new Map([['heart', 1]]));
    expect(made.pages).toBe(2);
    expect(made.elements.some((e) => e.kind === 'handwrite' && boxOf(e).x >= PAGE_STRIDE)).toBe(true);
    expect(made.sheets.map((s) => [s.sheet, s.main])).toEqual([
      [0, true],
      [1, false],
    ]);
  });

  it('keeps a comparison narrow enough to read on a phone, on a page of its own', () => {
    const made = composed([
      { do: 'say', text: 'Compare the two.' },
      {
        do: 'compare',
        left: { heading: 'Without villi', points: ['a smooth inner wall', 'a small surface', 'slow absorption'] },
        right: { heading: 'With villi', points: ['millions of tiny fingers', 'a huge surface', 'fast absorption'] },
      },
    ]);
    const frame = made.elements.find((e) => e.kind === 'box')!;
    expect(made.regions[frame.id]).toBe('0/main');
    expect(boxOf(frame).w).toBeLessThanOrEqual(680);
  });

  it('does not turn the page at a newPage that comes before the main demonstration', () => {
    const made = composed(
      [
        { do: 'title', text: 'The heart' },
        { do: 'say', text: 'Now, a new idea.' },
        { do: 'newPage' },
        { do: 'picture', ref: 'heart' },
        { do: 'say', text: 'It has four rooms.' },
        { do: 'list', heading: 'Chambers', items: [{ term: 'Atria', meaning: 'receive blood' }, { term: 'Ventricles', meaning: 'pump it out' }] },
        { do: 'say', text: 'The left side is thicker.' },
        { do: 'write', text: 'Left wall is thickest' },
        { do: 'say', text: 'So the heart is a pump.' },
        { do: 'summary', text: 'The heart pumps blood' },
      ],
      new Map([['heart', 1]]),
    );
    expect(made.pages).toBe(1);
  });

  it('never drops a name written on something that is not a picture: that page is laid out as before', () => {
    const board: Instruction[] = [
      { do: 'say', text: 'Water moves through these steps.' },
      { do: 'flow', steps: [{ label: 'Root' }, { label: 'Stem' }, { label: 'Leaf' }] },
      { do: 'label', target: 'b1_1#root', text: 'Where it starts' },
    ];
    const stacked = layoutBeat(beat(board));
    const made = composed(board);
    const named = (m: typeof made) => m.elements.some((e) => e.kind === 'handwrite' && e.text === 'Where it starts');
    expect(named(stacked)).toBe(true);
    expect(named(made)).toBe(true);
  });

  it('lays a beat with two main demonstrations out as a stack, as before', () => {
    const board: Instruction[] = [
      { do: 'say', text: 'Two things.' },
      { do: 'flow', steps: [{ label: 'A' }, { label: 'B' }] },
      { do: 'chart', data: [{ label: 'x', value: 1 }, { label: 'y', value: 2 }] },
    ];
    const fallback = composed(board);
    expect(fallback.elements).toEqual(layoutBeat(beat(board)).elements);
    expect(fallback.regions).toEqual({});
    expect(fallback.sheets).toEqual([]);
  });

  it('leaves a stacked page exactly as it was', () => {
    const made = layoutBeat(beat(FLOW_PAGE));
    expect(made.regions).toEqual({});
    expect(made.sheets).toEqual([]);
    expect(made.elements.find((e) => e.kind === 'title')).toMatchObject({ y: 86 });
  });
});
