import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * A labelled picture.
 *
 * The move every labelled diagram in every textbook is made of, and the one
 * the tutor could not make: she could circle a part, but could not say WHICH
 * part it was anywhere the student could connect to the circle.
 */

const parts = new Map([
  [
    'heart',
    [
      { name: 'right atrium', x: 0.15, y: 0.2, w: 0.2, h: 0.2 },
      { name: 'left ventricle', x: 0.6, y: 0.55, w: 0.25, h: 0.25 },
    ],
  ],
]);

const board: Instruction[] = [
  { do: 'title', text: 'Inside the Heart' },
  { do: 'picture', ref: 'heart' },
  { do: 'say', text: 'Blood arrives here.' },
  { do: 'label', target: 'heart#right atrium', text: 'Right atrium' },
  { do: 'say', text: 'And leaves here.' },
  { do: 'label', target: 'heart#left ventricle', text: 'Left ventricle: thickest wall' },
];

const beat: ScriptBeat = { id: 'h', topic: 't', narration: 'n', board };
const laid = layoutBeat(beat, parts);
const picture = laid.elements.find((el) => el.kind === 'image')!;
const pic = boxOf(picture);
const arrows = laid.elements.filter((el) => el.kind === 'arrow') as Extract<
  Element,
  { kind: 'arrow' }
>[];

describe('names go to the side their part is on', () => {
  it('centres the picture so there is a margin either side', () => {
    expect(pic.x).toBeGreaterThan(200);
    expect(pic.x + pic.w).toBeLessThan(800);
  });

  it('writes a left-hand part on the left and a right-hand part on the right', () => {
    const left = laid.elements.find((el) => el.id === 'h_3')!;
    const right = laid.elements.find((el) => el.id === 'h_5')!;
    expect(boxOf(left).x + boxOf(left).w).toBeLessThanOrEqual(pic.x);
    expect(boxOf(right).x).toBeGreaterThanOrEqual(pic.x + pic.w);
  });
});

describe('the line runs from the name to the part', () => {
  it('draws one line per label', () => {
    expect(arrows).toHaveLength(2);
  });

  it('lands on the near edge of the part, not the middle of the picture', () => {
    const [toAtrium, toVentricle] = arrows;
    // Right atrium sits at 0.15..0.35 across; the line reaches its left edge.
    expect(toAtrium.to.x).toBeCloseTo(pic.x + 0.15 * pic.w, 0);
    // Left ventricle at 0.6..0.85; the line comes in from the right.
    expect(toVentricle.to.x).toBeCloseTo(pic.x + 0.85 * pic.w, 0);
  });

  it('runs nearly level, because the name is written beside its own part', () => {
    // A name at the top of the margin for a part halfway down draws a long
    // diagonal, and three of those make a cat's cradle of the diagram.
    for (const a of arrows) expect(Math.abs(a.to.y - a.from.y)).toBeLessThan(30);
  });

  it('starts at the writing rather than somewhere near it', () => {
    const left = boxOf(laid.elements.find((el) => el.id === 'h_3')!);
    expect(arrows[0].from.x).toBeGreaterThanOrEqual(left.x);
    expect(Math.abs(arrows[0].from.y - (left.y + left.h / 2))).toBeLessThan(20);
  });
});

describe('a name the picture cannot place', () => {
  it('is still written, but without a line pointing nowhere', () => {
    const laidOut = layoutBeat(
      {
        ...beat,
        id: 'x',
        board: [
          { do: 'picture', ref: 'heart' },
          { do: 'label', target: 'heart#aorta', text: 'Aorta' },
        ],
      },
      parts,
    );
    expect(laidOut.elements.some((el) => el.kind === 'handwrite')).toBe(true);
    expect(laidOut.elements.filter((el) => el.kind === 'arrow')).toHaveLength(0);
  });
});

describe('a name stays where its line expects it', () => {
  it('is leashed tightly to where it was written', () => {
    const leash = laid.leashes.find((l) => l.id === 'h_3');
    expect(leash).toBeDefined();
    expect(leash!.region.w).toBeLessThan(60);
  });
});

describe('a name sits close to the thing it names', () => {
  /**
   * On a real board — the human eye — "Cornea" and "Iris" were written at the
   * far left of the margin with a long line reaching across to the picture.
   * The name was being centred in the MARGIN rather than placed against the
   * picture, so the wider the margin, the further the name drifted from what
   * it was pointing at.
   *
   * A person writing on a board puts the word as close to the thing as the
   * room allows and draws a short line. The margin is where there is space,
   * not where the writing belongs.
   */
  // SHORT names, which is where the fault shows: the shorter the word, the
  // further a margin's centre is from the picture's edge. "Cornea" drifted
  // further out than "Left ventricle: thickest wall" ever did.
  const eye = new Map([
    [
      'eye',
      [
        { name: 'cornea', x: 0.08, y: 0.42, w: 0.12, h: 0.16 },
        { name: 'retina', x: 0.72, y: 0.44, w: 0.14, h: 0.16 },
      ],
    ],
  ]);
  const short: Instruction[] = [
    { do: 'picture', ref: 'eye' },
    { do: 'say', text: 'Light enters through the cornea.' },
    { do: 'label', target: 'eye#cornea', text: 'Cornea' },
    { do: 'label', target: 'eye#retina', text: 'Retina' },
  ];
  const board2 = layoutBeat({ id: 'e', topic: 'eye', narration: '', board: short }, eye);
  const picture = boxOf(board2.elements.find((el) => el.kind === 'image')!);

  const gapToPicture = (id: string): number => {
    const box = boxOf(board2.elements.find((el) => el.id === id)!);
    return box.x < picture.x ? picture.x - (box.x + box.w) : box.x - (picture.x + picture.w);
  };

  it('leaves only a short gap between the writing and the picture', () => {
    expect(gapToPicture('e_2')).toBeLessThan(40);
    expect(gapToPicture('e_3')).toBeLessThan(40);
  });

  it('still keeps the writing clear of the picture', () => {
    expect(gapToPicture('e_2')).toBeGreaterThan(0);
    expect(gapToPicture('e_3')).toBeGreaterThan(0);
  });

  it('draws the line from the writing, not from somewhere out in the margin', () => {
    const lines = board2.elements.filter((el) => el.kind === 'arrow') as Extract<
      Element,
      { kind: 'arrow' }
    >[];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const name = board2.elements.find((el) => `${el.id}_line` === line.id);
      if (!name) continue;
      const box = boxOf(name);
      const nearer = Math.min(
        Math.abs(line.from.x - box.x),
        Math.abs(line.from.x - (box.x + box.w)),
      );
      expect(nearer).toBeLessThan(20);
    }
  });
});
