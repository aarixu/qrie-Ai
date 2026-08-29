import { describe, expect, it } from 'vitest';
import { CANVAS_W, type Element } from '@ai-tutor/lesson-format';
import { BOARD, layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[], narration = 'n'): ScriptBeat => ({
  id: 'b1',
  topic: 't',
  narration,
  board,
});

const graphics = (elements: Element[]) =>
  elements.filter((e) => e.kind === 'graphic') as Extract<Element, { kind: 'graphic' }>[];

/** The element id a place with this author id ends up carrying, in beat b1. */
const placed = (authorId: string) => `b1__${authorId}`;

/**
 * The scene Aarav described: "imagine you and your friend going to school",
 * two figures appear, then the school, then the road between them.
 */
const walkToSchool: Instruction[] = [
  { do: 'say', text: 'Imagine you and your friend leaving home together.' },
  { do: 'place', id: 'you', noun: 'boy', label: 'you', group: 'pair' },
  { do: 'place', id: 'friend', noun: 'boy', label: 'your friend', group: 'pair' },
  { do: 'say', text: 'You are both walking to school.' },
  { do: 'place', id: 'school', noun: 'school', label: 'school' },
  { do: 'say', text: 'And the school is two kilometres away.' },
  { do: 'connect', from: 'you', to: 'school', label: '2 km', tone: 'accent' },
];

describe('a noun becomes a picture on the board', () => {
  it('places each noun as a graphic that names it', () => {
    const { elements } = layoutBeat(beat(walkToSchool));
    const g = graphics(elements);
    expect(g.map((e) => e.noun)).toEqual(['boy', 'boy', 'school']);
    expect(g.map((e) => e.label)).toEqual(['you', 'your friend', 'school']);
  });

  it('stands them all on one baseline', () => {
    // Figures floating at different heights read as a diagram of nothing.
    const { elements } = layoutBeat(beat(walkToSchool));
    const bottoms = graphics(elements).map((e) => e.y + e.h);
    for (const b of bottoms) expect(b).toBeCloseTo(bottoms[0], 6);
  });

  it('keeps a group together and pushes other things away from it', () => {
    const { elements } = layoutBeat(beat(walkToSchool));
    const [you, friend, school] = graphics(elements);
    const withinPair = friend.x - (you.x + you.w);
    const toSchool = school.x - (friend.x + friend.w);
    expect(withinPair).toBeLessThan(toSchool);
  });

  it('lays them left to right in the order the tutor said them', () => {
    const { elements } = layoutBeat(beat(walkToSchool));
    const xs = graphics(elements).map((e) => e.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('keeps the whole scene on the board', () => {
    const many: Instruction[] = Array.from({ length: 7 }, (_, n) => ({
      do: 'place' as const,
      id: `p${n}`,
      noun: 'boy',
    }));
    const { elements } = layoutBeat(beat(many));
    for (const g of graphics(elements)) {
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x + g.w).toBeLessThanOrEqual(CANVAS_W);
    }
  });
});

describe('the stroke between two things', () => {
  it('draws an arrow that starts and ends outside both pictures', () => {
    // A connector running under the pictures it joins reads as a scribble.
    const { elements } = layoutBeat(beat(walkToSchool));
    const arrow = elements.find((e) => e.kind === 'arrow') as Extract<
      Element,
      { kind: 'arrow' }
    >;
    const g = graphics(elements);
    const you = g.find((e) => e.id === placed('you'))!;
    const school = g.find((e) => e.id === placed('school'))!;

    expect(arrow.from.x).toBeGreaterThan(you.x + you.w);
    expect(arrow.to.x).toBeLessThan(school.x);
  });

  it('writes the connector label by hand, over the line', () => {
    const { elements } = layoutBeat(beat(walkToSchool));
    const label = elements.find((e) => e.kind === 'handwrite') as Extract<
      Element,
      { kind: 'handwrite' }
    >;
    expect(label.text).toBe('2 km');

    const arrow = elements.find((e) => e.kind === 'arrow') as Extract<
      Element,
      { kind: 'arrow' }
    >;
    expect(label.y).toBeLessThan(Math.max(arrow.from.y, arrow.to.y));
  });

  it('draws nothing when one end was never placed', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'place', id: 'you', noun: 'boy' },
        { do: 'connect', from: 'you', to: 'nowhere' },
      ]),
    );
    expect(elements.filter((e) => e.kind === 'arrow')).toHaveLength(0);
  });
});

describe("the teacher's mark", () => {
  it('loops around the thing it is marking, a little larger than it', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'place', id: 'school', noun: 'school' },
        { do: 'annotate', target: 'school', mark: 'circle', tone: 'accent' },
      ]),
    );
    const g = graphics(elements)[0];
    const mark = elements.find((e) => e.kind === 'mark') as Extract<Element, { kind: 'mark' }>;
    expect(mark.shape).toBe('circle');
    expect(mark.x).toBeLessThan(g.x);
    expect(mark.w).toBeGreaterThan(g.w);
  });

  it('marks nothing that is not there', () => {
    const { elements } = layoutBeat(beat([{ do: 'annotate', target: 'gone', mark: 'tick' }]));
    expect(elements.filter((e) => e.kind === 'mark')).toHaveLength(0);
  });
});

describe('the board fills in with the words', () => {
  it('gives one moment per spoken line', () => {
    const { steps } = layoutBeat(beat(walkToSchool));
    expect(steps.map((s) => s.narration)).toEqual([
      'Imagine you and your friend leaving home together.',
      'You are both walking to school.',
      'And the school is two kilometres away.',
    ]);
  });

  it('shows each thing on the line that names it, and never before', () => {
    const { steps } = layoutBeat(beat(walkToSchool));
    expect(steps[0].show).toContain(placed('you'));
    expect(steps[0].show).toContain(placed('friend'));
    expect(steps[0].show).not.toContain(placed('school'));

    expect(steps[1].show).toContain(placed('school'));
    expect(steps[2].show.length).toBeGreaterThan(steps[1].show.length);
  });

  it('accumulates, because a board does not empty itself between sentences', () => {
    const { steps } = layoutBeat(beat(walkToSchool));
    for (let i = 1; i < steps.length; i += 1) {
      for (const id of steps[i - 1].show) expect(steps[i].show).toContain(id);
    }
  });

  it('holds the title from the first word, not from the sentence after it', () => {
    const { steps } = layoutBeat(
      beat([
        { do: 'title', text: 'Speed' },
        { do: 'say', text: 'First line.' },
        { do: 'place', id: 'you', noun: 'boy' },
        { do: 'say', text: 'Second line.' },
      ]),
    );
    const titleId = steps[0].show.find((id) => id.endsWith('_0'));
    expect(titleId).toBeDefined();
    for (const step of steps) expect(step.show).toContain(titleId);
  });

  it('is one moment when the beat is one breath', () => {
    const { steps } = layoutBeat(
      beat([{ do: 'title', text: 'Speed' }], 'The whole thing in one go.'),
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].narration).toBe('The whole thing in one go.');
  });
});

describe('a scene shares the board with everything else', () => {
  it('keeps the figures inside the main band, under a title', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'title', text: 'Speed' },
        { do: 'place', id: 'you', noun: 'boy' },
        { do: 'caption', text: 'Two kilometres.' },
      ]),
    );
    for (const g of graphics(elements)) {
      expect(g.y).toBeGreaterThanOrEqual(BOARD.MAIN.y);
      expect(g.y + g.h).toBeLessThanOrEqual(BOARD.MAIN.y + BOARD.MAIN.h);
    }
  });
});

describe('two arrows to the same place do not become one', () => {
  // A real lesson drew "you to school" and "friend to school" and the board
  // read "1000 m1000 m" with the two lines exactly on top of each other.
  const both: Instruction[] = [
    { do: 'place', id: 'you', noun: 'boy' },
    { do: 'place', id: 'friend', noun: 'boy' },
    { do: 'place', id: 'school', noun: 'school' },
    { do: 'connect', from: 'you', to: 'school', label: '1000 m' },
    { do: 'connect', from: 'friend', to: 'school', label: '1000 m' },
  ];

  it('separates the lines', () => {
    const { elements } = layoutBeat(beat(both));
    const arrows = elements.filter((e) => e.kind === 'arrow') as Extract<
      Element,
      { kind: 'arrow' }
    >[];
    expect(arrows).toHaveLength(2);
    expect(Math.abs(arrows[0].to.y - arrows[1].to.y)).toBeGreaterThan(15);
  });

  it('separates their labels, so neither is written over the other', () => {
    const { elements } = layoutBeat(beat(both));
    const labels = elements.filter((e) => e.kind === 'handwrite') as Extract<
      Element,
      { kind: 'handwrite' }
    >[];
    expect(labels).toHaveLength(2);
    expect(Math.abs(labels[0].y - labels[1].y)).toBeGreaterThan(15);
  });
});

describe('the scene fills the board it was given', () => {
  // Two figures drawn at their natural 132 in a 330-high band left a lesson on
  // Newton's third law looking mostly empty.
  it('draws a small scene large enough to use the band', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'place', id: 'hand', noun: 'hand' },
        { do: 'place', id: 'wall', noun: 'wall' },
      ]),
    );
    const g = graphics(elements);
    const tallest = Math.max(...g.map((e) => e.h));
    expect(tallest).toBeGreaterThan(BOARD.MAIN.h * 0.55);
  });

  it('still never grows past the band', () => {
    const { elements } = layoutBeat(beat([{ do: 'place', id: 'one', noun: 'boy' }]));
    const g = graphics(elements)[0];
    expect(g.y).toBeGreaterThanOrEqual(BOARD.MAIN.y);
    expect(g.y + g.h).toBeLessThanOrEqual(BOARD.MAIN.y + BOARD.MAIN.h);
  });

  it('keeps a crowded scene inside the width, shrinking instead', () => {
    const many: Instruction[] = Array.from({ length: 8 }, (_, n) => ({
      do: 'place' as const,
      id: `p${n}`,
      noun: 'boy',
    }));
    const { elements } = layoutBeat(beat(many));
    for (const g of graphics(elements)) {
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x + g.w).toBeLessThanOrEqual(CANVAS_W);
    }
  });
});

describe('a connector label stays over its own arrow', () => {
  // "push on wall" and "push on hand" were written across the hand and the
  // wall, because a full-size label is wider than a short arrow.
  const closeTogether: Instruction[] = [
    { do: 'place', id: 'hand', noun: 'hand' },
    { do: 'place', id: 'wall', noun: 'wall' },
    { do: 'connect', from: 'hand', to: 'wall', label: 'push on wall' },
    { do: 'connect', from: 'wall', to: 'hand', label: 'push on hand' },
  ];

  it('shrinks a label that would be wider than the arrow it sits on', () => {
    const { elements } = layoutBeat(beat(closeTogether));
    const labels = elements.filter((e) => e.kind === 'handwrite') as Extract<
      Element,
      { kind: 'handwrite' }
    >[];
    const arrows = elements.filter((e) => e.kind === 'arrow') as Extract<
      Element,
      { kind: 'arrow' }
    >[];
    const run = Math.hypot(
      arrows[0].to.x - arrows[0].from.x,
      arrows[0].to.y - arrows[0].from.y,
    );
    for (const label of labels) {
      const width = label.text.length * (label.size ?? 30) * 0.5;
      expect(width).toBeLessThanOrEqual(run * 1.15);
    }
  });

  it('separates two labels far enough that neither is written on the other', () => {
    const { elements } = layoutBeat(beat(closeTogether));
    const labels = elements.filter((e) => e.kind === 'handwrite') as Extract<
      Element,
      { kind: 'handwrite' }
    >[];
    expect(labels).toHaveLength(2);
    const apart = Math.abs(labels[0].y - labels[1].y);
    const tallest = Math.max(labels[0].size ?? 30, labels[1].size ?? 30);
    expect(apart).toBeGreaterThan(tallest);
  });
});

describe('the same noun in two beats is two pictures', () => {
  // A planner naturally writes place: person in two different beats and means
  // two different pictures. Before the ids were namespaced this produced a
  // duplicate element id, and a real run spent a whole repair round fixing
  // something no author had got wrong.
  it('namespaces a place id by its beat', () => {
    const board: Instruction[] = [{ do: 'place', id: 'person', noun: 'boy' }];
    const one = layoutBeat({ id: 'b1', topic: 't', narration: 'n', board });
    const two = layoutBeat({ id: 'b2', topic: 't', narration: 'n', board });

    expect(graphics(one.elements)[0].id).not.toBe(graphics(two.elements)[0].id);
  });

  it('still lets connect and annotate name the author\u2019s id inside the beat', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'place', id: 'person', noun: 'boy' },
        { do: 'place', id: 'boat', noun: 'canoe' },
        { do: 'connect', from: 'person', to: 'boat', label: 'push' },
        { do: 'annotate', target: 'boat', mark: 'circle' },
      ]),
    );
    expect(elements.filter((e) => e.kind === 'arrow')).toHaveLength(1);
    expect(elements.filter((e) => e.kind === 'mark')).toHaveLength(1);
  });
});
