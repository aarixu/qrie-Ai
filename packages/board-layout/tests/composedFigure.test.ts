import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import { ARRANGEMENTS } from '../src/compose';
import { inksFor, paintInks } from '../src/ink';
import type { Instruction } from '../src/types';

const PARTS = new Map([
  [
    'villus',
    [
      { name: 'capillaries', x: 0.15, y: 0.3, w: 0.15, h: 0.4 },
      { name: 'lacteal', x: 0.45, y: 0.2, w: 0.1, h: 0.6 },
      { name: 'epithelium', x: 0.75, y: 0.3, w: 0.15, h: 0.5 },
      { name: 'microvilli', x: 0.35, y: 0.02, w: 0.3, h: 0.08 },
    ],
  ],
]);
const SHAPES = new Map([['villus', 0.75]]);

/** Indices matter: the tests below splice into this list. */
const VILLI: Instruction[] = [
  { do: 'title', text: 'Villi', path: ['Small intestine', 'Villi'] }, // 0
  { do: 'picture', ref: 'villus' }, // 1
  { do: 'say', text: 'Blood capillaries carry sugar away.' }, // 2
  { do: 'label', target: 'villus#capillaries', text: 'Capillaries' }, // 3
  { do: 'annotate', target: 'villus#capillaries', mark: 'circle' }, // 4
  { do: 'say', text: 'The lacteal takes the fats.' }, // 5
  { do: 'label', target: 'villus#lacteal', text: 'Lacteal' }, // 6
  { do: 'say', text: 'A thin skin lets food through.' }, // 7
  { do: 'label', target: 'villus#epithelium', text: 'Epithelium' }, // 8
  { do: 'say', text: 'Here is what each part does.' }, // 9
  {
    do: 'list',
    heading: 'What each part does',
    items: [
      { term: 'Capillaries', meaning: 'carry sugars and amino acids' },
      { term: 'Lacteal', meaning: 'carries fats' },
      { term: 'Epithelium', meaning: 'one cell thick' },
    ],
  }, // 10
  { do: 'say', text: 'Villi make the surface huge.' }, // 11
  { do: 'write', text: 'Villi increase surface area' }, // 12
  { do: 'summary', text: 'Villi absorb digested food fast' }, // 13
];

const lay = (board: Instruction[]) =>
  layoutBeat({ id: 'b2', topic: 'villi', narration: '', board }, PARTS, SHAPES, { composed: true });
const hero = ARRANGEMENTS.figure.main!;
const side = ARRANGEMENTS.figure.regions.find((r) => r.id === 'side')!;
const inside = (el: Element, r: { x: number; y: number; w: number; h: number }): boolean => {
  const b = boxOf(el);
  return b.x >= r.x - 3 && b.y >= r.y - 3 && b.x + b.w <= r.x + r.w + 3 && b.y + b.h <= r.y + r.h + 3;
};
const written = (made: ReturnType<typeof lay>, text: string) =>
  made.elements.find((e) => e.kind === 'handwrite' && e.text === text) as Extract<Element, { kind: 'handwrite' }>;

/**
 * A NAME WHOSE PART WAS LOOKED FOR AND NOT FOUND (small intestine, 2026-10-06).
 *
 * Written in the margin with no line, it floats beside the picture pointing at
 * nothing — every name on that class's villus did. Once the picture has been
 * looked at, a name it has no part for is written in a row under the picture,
 * a key to it, inside its own region: down the notes column it pushed the list
 * of the parts onto the next page (review, 2026-10-06). A margin no name is
 * written in is given back to the picture. Before anyone has looked (the
 * draft), names wait in the margin as they always have: the part may be found.
 */
describe('a name whose part could not be found in the picture', () => {
  const found = new Map([['villus', PARTS.get('villus')!.filter((p) => p.name !== 'lacteal')]]);
  const layWith = (parts: typeof PARTS, board = VILLI, shapes = SHAPES) =>
    layoutBeat({ id: 'b2', topic: 'villi', narration: '', board }, parts, shapes, { composed: true });
  const imageOf = (made: ReturnType<typeof lay>) => boxOf(made.elements.find((e) => e.kind === 'image')!);

  it('is written under the picture, at its own line, once the picture has been looked at', () => {
    const made = layWith(found);
    const lacteal = written(made, 'Lacteal');
    expect(made.regions[lacteal.id]).toBe('0/hero');
    expect(inside(lacteal, hero)).toBe(true);
    expect(boxOf(lacteal).y).toBeGreaterThanOrEqual(imageOf(made).y + imageOf(made).h);
    expect(made.elements.some((e) => e.id === `${lacteal.id}_line`)).toBe(false);
    // The names it found stay beside the picture, each with its line.
    expect(made.elements.some((e) => e.id === `${written(made, 'Capillaries').id}_line`)).toBe(true);
    // It arrives on the line that names it.
    const step = made.steps.findIndex((s) => s.show.includes(lacteal.id));
    expect(made.steps[step].narration).toBe('The lacteal takes the fats.');
  });

  it('gives the picture its margins back when none of the parts were found', () => {
    const wide = new Map([['villus', 1.6]]);
    const made = layWith(new Map([['villus', []]]), VILLI, wide);
    for (const name of ['Capillaries', 'Lacteal', 'Epithelium']) {
      expect(boxOf(written(made, name)).y, name).toBeGreaterThanOrEqual(imageOf(made).y + imageOf(made).h);
    }
    // Wider than the draft drew it between two margins of names (354 of 590 here).
    const draft = layWith(new Map(), VILLI, wide);
    expect(imageOf(made).w).toBeGreaterThan(imageOf(draft).w * 1.25);
  });

  it('keeps the list of the parts beside the picture, on one page', () => {
    const board: Instruction[] = [
      { do: 'say', text: 'Here is one villus.' },
      { do: 'picture', ref: 'villus' },
      { do: 'label', target: 'villus#microvilli', text: 'Microvilli' },
      { do: 'label', target: 'villus#capillaries', text: 'Blood capillaries' },
      { do: 'label', target: 'villus#epithelium', text: 'Single-cell epithelium' },
      { do: 'label', target: 'villus#lacteal', text: 'Central lacteal' },
      { do: 'say', text: 'Here is what each part does.' },
      {
        do: 'list',
        heading: 'How each part aids absorption',
        items: [
          { term: 'Microvilli', meaning: 'fold the edge to multiply the surface' },
          { term: 'Blood capillaries', meaning: 'carry sugars and amino acids away' },
          { term: 'Single-cell epithelium', meaning: 'a short path for food to cross' },
          { term: 'Central lacteal', meaning: 'takes in the fats' },
        ],
      },
      { do: 'say', text: 'Blood keeps flowing.' },
      { do: 'write', text: 'Flowing blood keeps absorption fast' },
      { do: 'say', text: 'So villi soak up food.' },
      { do: 'summary', text: 'Villi absorb food fast' },
    ];
    const made = layWith(new Map([['villus', []]]), board);
    expect(made.pages).toBe(1);
    expect(made.regions[made.elements.find((e) => e.kind === 'list')!.id]).toBe('0/side');
  });

  it('waits in the margin in the draft, before the picture has been looked at', () => {
    const made = layWith(new Map());
    for (const name of ['Capillaries', 'Lacteal', 'Epithelium']) expect(made.regions[written(made, name).id], name).toBe('0/hero');
  });
});

describe('a labelled picture on a composed page', () => {
  const made = lay(VILLI);

  it('draws the picture and its names inside the hero region', () => {
    const image = made.elements.find((e) => e.kind === 'image')!;
    expect(made.regions[image.id]).toBe('0/hero');
    expect(inside(image, hero)).toBe(true);
    for (const name of ['Capillaries', 'Lacteal', 'Epithelium']) {
      expect(made.regions[written(made, name).id], name).toBe('0/hero');
      expect(inside(written(made, name), hero), name).toBe(true);
    }
  });

  it('writes the notes beside it, the key point under it and the summary in its place', () => {
    expect(made.regions[made.elements.find((e) => e.kind === 'list')!.id]).toBe('0/side');
    expect(made.regions[written(made, 'Villi increase surface area').id]).toBe('0/bottom');
    expect(made.regions[made.elements.find((e) => e.kind === 'box')!.id]).toBe('0/summary');
  });

  it('gives each named part one colour, carried by its name, its line, its mark and its notes item', () => {
    const name = written(made, 'Capillaries');
    const line = made.elements.find((e) => e.id === `${name.id}_line`) as Extract<Element, { kind: 'arrow' }>;
    const mark = made.elements.find((e) => e.kind === 'mark') as Extract<Element, { kind: 'mark' }>;
    const list = made.elements.find((e) => e.kind === 'list') as Extract<Element, { kind: 'list' }>;
    expect(name.ink).toBeDefined();
    expect(line.ink).toBe(name.ink);
    expect(mark.ink).toBe(name.ink);
    expect(list.items.find((it) => it.term === 'Capillaries')!.ink).toBe(name.ink);
    expect(new Set(['Capillaries', 'Lacteal', 'Epithelium'].map((t) => written(made, t).ink)).size).toBe(3);
    expect(written(made, 'Villi increase surface area').ink).toBeUndefined();
  });

  it('lets a wide picture fill most of the hero, with its names beside it', () => {
    const wide = layoutBeat({ id: 'b2', topic: 'villi', narration: '', board: VILLI }, PARTS, new Map([['villus', 1.25]]), { composed: true });
    const image = boxOf(wide.elements.find((e) => e.kind === 'image')!);
    expect(image.w).toBeGreaterThanOrEqual(hero.w * 0.55);
    for (const name of ['Capillaries', 'Lacteal', 'Epithelium']) expect(inside(written(wide, name), hero), name).toBe(true);
  });

  it('reports the page whole', () => {
    expect(made.sheets).toEqual([expect.objectContaining({ sheet: 0, main: true, notes: true, points: 1, summary: true })]);
  });

  it('a name whose part is unknown is written, uncoloured, and moves no other colour', () => {
    const odd = lay([...VILLI.slice(0, 4), { do: 'label', target: 'villus#nucleus', text: 'Nucleus' }, ...VILLI.slice(4)]);
    const nucleus = written(odd, 'Nucleus');
    expect(nucleus).toBeDefined();
    expect(nucleus.ink).toBeUndefined();
    expect(odd.elements.some((e) => e.id === `${nucleus.id}_line`)).toBe(false);
    for (const t of ['Capillaries', 'Lacteal', 'Epithelium']) expect(written(odd, t).ink).toBe(written(made, t).ink);
  });
});

describe('a comparison on a picture page', () => {
  const made = lay([
    ...VILLI.slice(0, 11),
    { do: 'say', text: 'Compare a smooth tube with one full of villi.' },
    {
      do: 'compare',
      left: { heading: 'Without villi', points: ['smooth wall', 'small surface', 'slow absorption'] },
      right: { heading: 'With villi', points: ['millions of fingers', 'huge surface', 'fast absorption'] },
    },
    ...VILLI.slice(11),
  ]);

  it('is written under the picture as a section of the page, and the picture keeps the hero', () => {
    const frame = made.elements.find((e) => e.kind === 'box' && e.id === 'b2_12')!;
    expect(made.regions[frame.id]).toBe('0/bottom');
    const image = made.elements.find((e) => e.kind === 'image')!;
    expect(made.regions[image.id]).toBe('0/hero');
    expect(made.pages).toBe(1);
  });
});

describe('a zoom inset on a composed page', () => {
  const made = lay([
    ...VILLI.slice(0, 9),
    { do: 'say', text: 'And each cell has tiny folds.' },
    { do: 'sketch', ref: 'microvilli', from: 'villus#microvilli' },
    ...VILLI.slice(9),
  ]);

  it('sits at the top of the notes column, with the notes under it', () => {
    const inset = made.elements.find((e) => e.kind === 'diagram' && e.id === 'microvilli')!;
    expect(made.regions[inset.id]).toBe('0/side');
    expect(boxOf(inset)).toMatchObject({ x: side.x, y: side.y, w: side.w });
    const list = made.elements.find((e) => e.kind === 'list')!;
    expect(boxOf(list).y).toBeGreaterThanOrEqual(boxOf(inset).y + boxOf(inset).h);
  });

  it('is joined to its part by a box round the part and two dashed lines', () => {
    expect(made.elements.filter((e) => e.kind === 'arrow' && e.dashed)).toHaveLength(2);
    expect(made.elements.some((e) => e.kind === 'mark' && e.shape === 'box')).toBe(true);
  });

  it('keeps every name left of the picture, so no dashed line crosses one', () => {
    const image = boxOf(made.elements.find((e) => e.kind === 'image')!);
    for (const t of ['Capillaries', 'Lacteal', 'Epithelium']) {
      expect(boxOf(written(made, t)).x + boxOf(written(made, t)).w, t).toBeLessThanOrEqual(image.x);
    }
  });
});

describe('the inks', () => {
  it('go round the palette in the order parts are first named, and a label finds its part', () => {
    const inkOf = inksFor([
      { part: 'lacteal', text: 'Lacteal' },
      { part: 'capillaries', text: 'Blood capillaries' },
      { part: 'lacteal', text: 'Lacteal' },
    ]);
    expect(inkOf('lacteal')).toBe('red');
    expect(inkOf('Blood capillaries')).toBe('blue');
    expect(inkOf(' CAPILLARIES ')).toBe('blue');
    expect(inkOf('villus')).toBeUndefined();
    const seven = inksFor(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p) => ({ part: p, text: p })));
    expect(seven('g')).toBe('red');
  });

  it('paint only what belongs to a part, and a notes item by its term', () => {
    const els: Element[] = [
      { kind: 'handwrite', id: 'n', x: 0, y: 0, text: 'Lacteal' },
      { kind: 'handwrite', id: 'k', x: 0, y: 0, text: 'A key point' },
      { kind: 'list', id: 'l', x: 0, y: 0, w: 200, items: [{ term: 'Lacteal' }, { term: 'Vein' }] },
    ];
    const painted = paintInks(els, inksFor([{ part: 'lacteal', text: 'Lacteal' }]), new Map([['n', 'lacteal']]));
    expect((painted[0] as { ink?: string }).ink).toBe('red');
    expect(painted[1]).toBe(els[1]);
    expect((painted[2] as Extract<Element, { kind: 'list' }>).items.map((it) => it.ink)).toEqual(['red', undefined]);
  });
});
