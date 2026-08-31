import { describe, expect, it } from 'vitest';
import { boxOf, listBoxHeight, overlaps, type Element } from '@ai-tutor/lesson-format';
import { BOARD, layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * The board can write a list.
 *
 * Four chambers of a heart are four things with four meanings. Said as a card
 * they arrive as one paragraph; said as four `write` lines they lose the
 * heading that binds them. A notes page writes them as a numbered list, and
 * until now this board could not.
 */

const items = [
  { term: 'Right atrium', meaning: 'receives deoxygenated blood from the body' },
  { term: 'Right ventricle', meaning: 'pumps deoxygenated blood to the lungs' },
  { term: 'Left atrium', meaning: 'receives oxygenated blood from the lungs' },
  { term: 'Left ventricle', meaning: 'pumps oxygenated blood to the whole body' },
];

const board: Instruction[] = [
  { do: 'title', text: 'Inside the Heart' },
  { do: 'say', text: 'The heart has four chambers.' },
  { do: 'list', heading: 'Chambers of the heart', items },
  { do: 'caption', text: 'Four rooms, two pumps.' },
];

const beat: ScriptBeat = { id: 'c', topic: 'heart', narration: '', board };
const laid = layoutBeat(beat);
const list = laid.elements.find((el) => el.kind === 'list') as Extract<Element, { kind: 'list' }>;

describe('a list on the board', () => {
  it('is drawn as a list, with every item the tutor named', () => {
    expect(list).toBeDefined();
    expect(list.items.map((i) => i.term)).toEqual([
      'Right atrium',
      'Right ventricle',
      'Left atrium',
      'Left ventricle',
    ]);
    expect(list.heading).toBe('Chambers of the heart');
  });

  it('is given a width to wrap into, and no height of its own', () => {
    // Height is the items' business, measured in one place.
    expect(list.w).toBeGreaterThan(200);
    expect((list as unknown as { h?: number }).h).toBeUndefined();
    expect(boxOf(list).h).toBe(listBoxHeight(list.items, list.heading, list.w, list.size));
  });

  it('stays inside the teaching band, clear of the heading and the caption', () => {
    const box = boxOf(list);
    expect(box.y).toBeGreaterThanOrEqual(BOARD.MAIN.y);
    expect(box.y + box.h).toBeLessThanOrEqual(BOARD.BOTTOM.y);
  });

  it('sits on nothing else', () => {
    for (const other of laid.elements) {
      if (other.id === list.id) continue;
      expect(overlaps(boxOf(list), boxOf(other))).toBe(false);
    }
  });

  it('arrives on the line that introduces it', () => {
    expect(laid.steps[0].show).toContain(list.id);
  });
});

describe('a list beside a picture', () => {
  // The shape of a real notes page: the figure, and the parts written out.
  const parts = new Map([['heart', [{ name: 'left ventricle', x: 0.6, y: 0.55, w: 0.2, h: 0.2 }]]]);
  const withPicture: Instruction[] = [
    { do: 'title', text: 'Inside the Heart' },
    { do: 'picture', ref: 'heart' },
    { do: 'say', text: 'These are the four chambers.' },
    { do: 'list', heading: 'Chambers', items },
  ];
  const both = layoutBeat({ id: 'p', topic: 'heart', narration: '', board: withPicture }, parts);
  const picture = both.elements.find((el) => el.kind === 'image')!;
  const theList = both.elements.find((el) => el.kind === 'list')!;

  it('draws both, and neither on the other', () => {
    expect(picture).toBeDefined();
    expect(theList).toBeDefined();
    expect(overlaps(boxOf(picture), boxOf(theList))).toBe(false);
  });

  it('leaves the picture worth looking at', () => {
    expect(boxOf(picture).h).toBeGreaterThanOrEqual(140);
  });
});

describe('a list on a beat whose picture is already labelled', () => {
  /**
   * The arrangement the new prompt will ask for constantly: the figure with its
   * parts named in the margins, and underneath, those same parts written out
   * with what each one does.
   *
   * The labelled-picture branch used to end by emptying the block list, which
   * silently threw away anything it had not placed itself. A list written into
   * that beat simply never appeared — no error, no gap, just a board missing
   * the half a student was meant to copy.
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
  const board: Instruction[] = [
    { do: 'title', text: 'Inside the Heart' },
    { do: 'picture', ref: 'heart' },
    { do: 'say', text: 'Blood arrives in the top-right chamber.' },
    { do: 'annotate', target: 'heart#right atrium', mark: 'circle' },
    { do: 'label', target: 'heart#right atrium', text: 'Right atrium' },
    { do: 'label', target: 'heart#left ventricle', text: 'Left ventricle' },
    { do: 'say', text: 'Each chamber has one job.' },
    { do: 'list', heading: 'What each chamber does', items },
    { do: 'write', text: 'The right side handles used blood' },
  ];
  const laid = layoutBeat({ id: 'q', topic: 'heart', narration: '', board }, parts);
  const picture = laid.elements.find((el) => el.kind === 'image')!;
  const theList = laid.elements.find((el) => el.kind === 'list') as
    | Extract<Element, { kind: 'list' }>
    | undefined;

  it('draws the list rather than dropping it', () => {
    expect(theList).toBeDefined();
    expect(theList!.items).toHaveLength(4);
  });

  it('puts it under the figure, or on the next page — never over it', () => {
    const list = boxOf(theList!);
    const pic = boxOf(picture);
    const samePage = Math.floor(list.x / 1260) === Math.floor(pic.x / 1260);
    if (samePage) expect(list.y).toBeGreaterThanOrEqual(pic.y + pic.h);
    else expect(list.x).toBeGreaterThan(pic.x + pic.w);
  });

  it('keeps the names in the margins either side of the picture', () => {
    const left = laid.elements.find((el) => el.id === 'q_4')!;
    expect(boxOf(left).x).toBeLessThan(boxOf(picture).x);
  });

  it('still writes the key point, and not on top of the list', () => {
    const point = laid.elements.find((el) => el.id === 'q_8')!;
    expect(point).toBeDefined();
    expect(overlaps(boxOf(point), boxOf(theList!))).toBe(false);
  });

  it('keeps everything on the board', () => {
    const bottom = boxOf(theList!).y + boxOf(theList!).h;
    expect(bottom).toBeLessThanOrEqual(BOARD.h);
  });
});

describe('a flow, a list and two key points on one board', () => {
  /**
   * The arrangement a real class produced on its last page: the two circuits
   * as a flow, the same two written out as a list, and two sentences worth
   * remembering. Three things that are all READ, on one board.
   */
  const board: Instruction[] = [
    { do: 'title', text: 'Double Circulation' },
    { do: 'say', text: 'Blood goes through the heart twice.' },
    {
      do: 'flow',
      steps: [
        { label: 'Body' },
        { label: 'Right side' },
        { label: 'Lungs' },
        { label: 'Left side' },
      ],
    },
    {
      do: 'list',
      heading: 'The two circuits',
      items: [
        { term: 'Pulmonary circuit', meaning: 'heart to lungs and back, to pick up oxygen' },
        { term: 'Systemic circuit', meaning: 'heart to the body and back, to deliver oxygen' },
      ],
    },
    { do: 'say', text: 'And this is why it matters.' },
    { do: 'write', text: 'Double circulation maintains high blood pressure across the body' },
    { do: 'write', text: 'Complete separation meets the energy needs of a warm-blooded animal' },
  ];
  const laid = layoutBeat({ id: 'd', topic: 'circulation', narration: '', board });

  it('leaves nothing sitting on anything else', () => {
    const bonded = new Set(laid.bonds.map((b) => `${b.a}|${b.b}`));
    const clash: string[] = [];
    for (let i = 0; i < laid.elements.length; i += 1) {
      for (let j = i + 1; j < laid.elements.length; j += 1) {
        const a = laid.elements[i];
        const b = laid.elements[j];
        if (bonded.has(`${a.id}|${b.id}`) || bonded.has(`${b.id}|${a.id}`)) continue;
        if (overlaps(boxOf(a), boxOf(b))) clash.push(`${a.kind}:${a.id} over ${b.kind}:${b.id}`);
      }
    }
    expect(clash).toEqual([]);
  });

  it('keeps one key point together, rather than interleaving it with the next', () => {
    const first = laid.elements.filter((el) => el.id.startsWith('d_5'));
    const second = laid.elements.filter((el) => el.id.startsWith('d_6'));
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    const lastOfFirst = Math.max(...first.map((el) => boxOf(el).y));
    const firstOfSecond = Math.min(...second.map((el) => boxOf(el).y));
    expect(firstOfSecond).toBeGreaterThan(lastOfFirst);
  });
});

describe('a long flow is not squeezed into a column', () => {
  /**
   * The board that produced the mess: five steps of the path of light, and a
   * list beside them. The flow counts as the beat's figure, so it was handed
   * the narrow column — forty-two units per step — and its labels overhung
   * into each other until five notes read as one stripe.
   *
   * A picture can be shrunk. A row of five boxes cannot: past a point the
   * words simply do not fit at any size a person reads. So a flow this long
   * takes the width, and what would have sat beside it goes underneath.
   */
  const board: Instruction[] = [
    { do: 'title', text: 'Path of Light Through the Eye' },
    { do: 'say', text: 'Light takes one road through the eye.' },
    {
      do: 'flow',
      steps: [
        { label: 'Cornea', note: 'primary refraction' },
        { label: 'Pupil', note: 'light regulation' },
        { label: 'Lens', note: 'focus adjustment' },
        { label: 'Retina', note: 'inverted image' },
        { label: 'Optic nerve', note: 'signal to the brain' },
      ],
    },
    {
      do: 'list',
      heading: 'What each part does',
      items: [
        { term: 'Cornea', meaning: 'bends the light as it enters' },
        { term: 'Iris', meaning: 'opens and closes the pupil' },
        { term: 'Lens', meaning: 'fine-tunes the focus' },
      ],
    },
  ];
  const laid = layoutBeat({ id: 'e', topic: 'eye', narration: '', board });
  const flow = laid.elements.find((el) => el.kind === 'flow') as Extract<
    Element,
    { kind: 'flow' }
  >;
  const theList = laid.elements.find((el) => el.kind === 'list')!;

  it('gives the flow room for its steps', () => {
    // Five steps and four gaps: below this each step is too narrow to hold a
    // word like "refraction" at a readable size.
    const stepW = (flow.w - 4 * 40) / 5;
    expect(stepW).toBeGreaterThanOrEqual(100);
  });

  it('puts the list under it rather than beside it', () => {
    expect(boxOf(theList).y).toBeGreaterThanOrEqual(boxOf(flow).y + boxOf(flow).h);
  });

  it('still keeps a short flow beside its list, where that fits', () => {
    const short: Instruction[] = [
      { do: 'title', text: 'Two circuits' },
      { do: 'flow', steps: [{ label: 'Heart' }, { label: 'Lungs' }] },
      {
        do: 'list',
        heading: 'The circuits',
        items: [{ term: 'Pulmonary', meaning: 'to the lungs and back' }],
      },
    ];
    const two = layoutBeat({ id: 'f', topic: 'x', narration: '', board: short });
    const f = two.elements.find((el) => el.kind === 'flow')!;
    const l = two.elements.find((el) => el.kind === 'list')!;
    expect(boxOf(l).x).toBeGreaterThan(boxOf(f).x + boxOf(f).w - 1);
  });
});
