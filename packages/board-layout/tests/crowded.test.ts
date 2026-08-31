import { describe, expect, it } from 'vitest';
import { boxOf, overlaps, type Element } from '@ai-tutor/lesson-format';
import { BOARD, layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * A scene, a list and two key points on one beat.
 *
 * The board that broke: three cells placed in a row with connectors between
 * them, the four tissue types written out beside, and two sentences under. The
 * list took two hundred and seventy-three units, the key points took more, and
 * the scene was handed what was left — which was nothing. Its icons came out
 * 141 by 26, meaning the picture inside each was of NEGATIVE height, and the
 * whole scene landed above the band it belonged to, on top of the title.
 *
 * Six overlapping pairs on one board. The engine shrank when it should have
 * turned the page.
 */

const board: Instruction[] = [
  { do: 'title', text: 'Division of Labour: Cells to Tissues', sub: 'Groups of similar cells performing a dedicated function' },
  { do: 'say', text: 'One cell cannot do every job in the body.' },
  { do: 'place', id: 'muscle', noun: 'muscle', label: 'Muscle cell' },
  { do: 'place', id: 'blood', noun: 'blood', label: 'Blood cell' },
  { do: 'place', id: 'nerve', noun: 'nerve', label: 'Nerve cell' },
  { do: 'connect', from: 'muscle', to: 'blood', label: 'coordinated teamwork' },
  { do: 'connect', from: 'blood', to: 'nerve', label: 'vital support' },
  { do: 'say', text: 'Animals build four kinds of tissue out of them.' },
  {
    do: 'list',
    heading: 'The Four Primary Animal Tissues',
    items: [
      { term: 'Epithelial', meaning: 'covers surfaces and lines the inner cavities' },
      { term: 'Connective', meaning: 'binds and supports other tissues; blood and bone' },
      { term: 'Muscular', meaning: 'contracts to produce movement' },
      { term: 'Nervous', meaning: 'carries signals between parts of the body' },
    ],
  },
  { do: 'write', text: 'Tissue = a cluster of similar cells performing one function' },
  { do: 'write', text: 'Structure of each tissue is strictly adapted to its job' },
  { do: 'caption', text: 'Four tissues, one body.' },
];

const laid = layoutBeat({ id: 'x', topic: 'tissues', narration: '', board } as ScriptBeat);

const marks = new Set(laid.elements.filter((el) => el.kind === 'mark').map((el) => el.id));
const bonded = new Set(laid.bonds.flatMap((b) => [`${b.a}|${b.b}`, `${b.b}|${b.a}`]));

describe('a crowded board', () => {
  it('puts nothing on top of anything else', () => {
    const clashes: string[] = [];
    for (let i = 0; i < laid.elements.length; i += 1) {
      for (let j = i + 1; j < laid.elements.length; j += 1) {
        const a = laid.elements[i];
        const b = laid.elements[j];
        if (marks.has(a.id) || marks.has(b.id)) continue;
        if (bonded.has(`${a.id}|${b.id}`)) continue;
        if (overlaps(boxOf(a), boxOf(b))) clashes.push(`${a.kind}:${a.id} over ${b.kind}:${b.id}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('draws the placed things big enough to recognise', () => {
    // 141 by 26 was the real output, and a graphic's box is its picture plus
    // 34 units for the name written under it — so the picture was negative.
    const graphics = laid.elements.filter((el) => el.kind === 'graphic') as Extract<
      Element,
      { kind: 'graphic' }
    >[];
    expect(graphics.length).toBeGreaterThan(0);
    for (const g of graphics) expect(g.h).toBeGreaterThanOrEqual(56);
  });

  it('keeps everything inside its own band', () => {
    for (const el of laid.elements) {
      if (el.kind === 'title' || el.kind === 'text') continue;
      const b = boxOf(el);
      expect(b.y, `${el.kind}:${el.id} starts above the teaching band`).toBeGreaterThanOrEqual(
        BOARD.MAIN.y - 1,
      );
    }
  });

  it('writes nothing under the caption', () => {
    for (const el of laid.elements) {
      if (el.kind === 'text') continue;
      const b = boxOf(el);
      expect(b.y + b.h, `${el.kind}:${el.id} runs past the caption band`).toBeLessThanOrEqual(
        BOARD.BOTTOM.y,
      );
    }
  });
});

describe('a labelled picture carrying more than it can hold', () => {
  /**
   * The other road into the same fault. A picture with its parts named in the
   * margins puts the key points and the lists in a band UNDERNEATH it, and that
   * band borrows the empty strip below the teaching band. Borrowing has a
   * limit: the caption lives at 548, and the band was walking straight through
   * it.
   */
  const parts = new Map([
    [
      'heart',
      [
        { name: 'right atrium', x: 0.15, y: 0.2, w: 0.18, h: 0.18 },
        { name: 'left ventricle', x: 0.6, y: 0.55, w: 0.2, h: 0.2 },
      ],
    ],
  ]);
  const crowded: Instruction[] = [
    { do: 'title', text: 'Inside the Heart' },
    { do: 'picture', ref: 'heart' },
    { do: 'say', text: 'Blood arrives here.' },
    { do: 'label', target: 'heart#right atrium', text: 'Right atrium' },
    { do: 'label', target: 'heart#left ventricle', text: 'Left ventricle' },
    { do: 'write', text: 'The right side handles blood that has already been used by the body' },
    { do: 'write', text: 'The left side pushes fresh blood out to every organ you have' },
    { do: 'write', text: 'Valves stop any of it from running backwards between beats' },
    {
      do: 'list',
      heading: 'What each chamber does',
      items: [
        { term: 'Right atrium', meaning: 'receives deoxygenated blood from the body' },
        { term: 'Right ventricle', meaning: 'pumps that blood to the lungs' },
        { term: 'Left atrium', meaning: 'receives oxygenated blood from the lungs' },
        { term: 'Left ventricle', meaning: 'pumps it to the whole body' },
      ],
    },
    { do: 'caption', text: 'One heartbeat, two pumps.' },
  ];
  const laid = layoutBeat({ id: 'h', topic: 'heart', narration: '', board: crowded }, parts);

  it('writes nothing under the caption', () => {
    for (const el of laid.elements) {
      if (el.kind === 'text' || el.kind === 'title') continue;
      const b = boxOf(el);
      expect(b.y + b.h, `${el.kind}:${el.id} runs past the caption band`).toBeLessThanOrEqual(
        BOARD.BOTTOM.y,
      );
    }
  });

  it('still draws every key point and the list', () => {
    expect(laid.elements.some((el) => el.kind === 'list')).toBe(true);
    const written = laid.elements.filter((el) => el.kind === 'handwrite');
    expect(written.length).toBeGreaterThan(4);
  });
});
