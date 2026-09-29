import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boxOf,
  CANVAS_H,
  CANVAS_W,
  PAGE_STRIDE,
  validateLesson,
  type Element,
  type Lesson,
  type Rect,
} from '@ai-tutor/lesson-format';
import { findOverlaps, layoutBeat } from '@ai-tutor/board-layout';
import {
  augmentLesson,
  emptyLiveState,
  layoutLiveTurn,
  nextTurn,
  parseBoardOps,
  type LiveState,
  type LiveTarget,
} from '@ai-tutor/live-board';

/**
 * layoutLiveTurn — T2.2's acceptance, as behaviour.
 *
 * "Held-ask ink goes into T1.5's work area. A page without one gets a fresh
 *  page. A doubt page opens with a copy of the element it refers to. Marks and
 *  arrows stay on one page, and lesson.canvas.w is widened."
 *
 * The demo the plan promises after T2 is the first test: a typed "why does
 * 7(3 - 2y) become 21 - 14y?" gets a fresh page that opens with that line,
 * marks it, and writes the expansion under it — on the real proof lesson.
 */

const fixture = path.resolve(process.cwd(), 'packages/live-board/tests/fixtures/lesson-substitution.json');
const load = (): Lesson => JSON.parse(readFileSync(fixture, 'utf8')) as Lesson;

const byId = (els: readonly Element[], id: string): Element => {
  const el = els.find((e) => e.id === id);
  if (!el) throw new Error(`no element ${id}`);
  return el;
};
const pageOf = (r: Rect): number => Math.floor((r.x + r.w / 2) / PAGE_STRIDE);
const inside = (r: Rect, outer: Rect): boolean =>
  r.x >= outer.x - 1e-6 && r.y >= outer.y - 1e-6 && r.x + r.w <= outer.x + outer.w + 1e-6 && r.y + r.h <= outer.y + outer.h + 1e-6;

/** Overlaps that involve live ink — the prepared lesson's own are not this package's to judge. */
const liveOverlaps = (lesson: Lesson, state: LiveState) =>
  findOverlaps(lesson.elements, { bonds: state.bonds }).filter((o) => o.a.startsWith('live') || o.b.startsWith('live'));

/** One turn, parsed the way the app will parse it: against what is on screen. */
function turn(lesson: Lesson, state: LiveState, json: unknown, target: LiveTarget, onScreen?: Iterable<string>) {
  const ids = new Set(onScreen ?? [...lesson.elements.map((e) => e.id), ...state.elements.map((e) => e.id)]);
  const parsed = parseBoardOps(json, ids, { turn: nextTurn(state) });
  return layoutLiveTurn(lesson, state, parsed.steps, target);
}

/** A one-beat lesson whose held question has a prepared work area, laid out by board-layout itself. */
function heldLesson(): Lesson {
  const laid = layoutBeat({
    id: 'q',
    topic: 'The first step',
    narration: '',
    board: [
      { do: 'title', text: 'Substitution' },
      { do: 'say', text: 'Here is the pair.' },
      { do: 'equation', text: 'x + 2y = 3' },
      { do: 'say', text: 'Which variable is easier to get on its own?' },
      { do: 'ask', question: 'Which variable is easier to get on its own?', expect: 'x, from x + 2y = 3' },
    ],
  });
  const held = laid.asks[0];
  if (!held?.workArea) throw new Error('the fixture beat should have a work area');
  return {
    formatVersion: 1,
    id: 'held',
    title: 'Held',
    language: 'en',
    canvas: { w: CANVAS_W + (laid.pages - 1) * PAGE_STRIDE, h: CANVAS_H },
    elements: laid.elements,
    beats: [
      {
        id: 'q',
        topic: 'The first step',
        narration: 'Which variable is easier to get on its own?',
        show: laid.laid.show,
        ask: held.ask,
        workArea: held.workArea,
      },
    ],
  };
}

describe('the T2 demo: a doubt about 7(3 - 2y), on the real substitution lesson', () => {
  const lesson = load();
  const before = JSON.stringify(lesson);
  const state0 = emptyLiveState();
  const onScreen = lesson.beats.find((b) => b.id === 'b3_4')!.show;
  const out = turn(
    lesson,
    state0,
    {
      steps: [
        { say: 'Look at this part.', ink: [{ op: 'mark', targetId: 'b3_2', shape: 'underline', span: '7(3 - 2y)' }] },
        {
          say: 'Let us open the bracket together.',
          ink: [
            {
              op: 'work',
              steps: [
                { say: 'Seven times three is twenty-one.', line: '7 × 3 = 21' },
                { say: 'Seven times minus two y is minus fourteen y.', line: '7 × (−2y) = −14y' },
                { say: 'So the bracket opens to twenty-one minus fourteen y.', line: '7(3 − 2y) = 21 − 14y' },
              ],
            },
          ],
        },
      ],
    },
    { kind: 'doubtPage', copyOf: 'b3_2' },
    onScreen,
  );
  const copy = byId(out.elements, 'live1_copy');
  const copyBox = boxOf(copy);
  const livePage = 9; // the lesson has pages 0..8

  it('opens a fresh page to the right of the whole lesson, and widens the canvas by one page', () => {
    expect(out.lesson.canvas.w).toBe(lesson.canvas.w + PAGE_STRIDE);
    expect(out.state.pages).toEqual([livePage]);
    for (const el of out.elements) expect(pageOf(boxOf(el))).toBe(livePage);
  });

  it('opens with a copy of b3_2 at the top of that page', () => {
    const original = byId(lesson.elements, 'b3_2');
    expect(copy).toMatchObject({ kind: 'formula', text: (original as { text: string }).text });
    expect(out.elements[0].id).toBe('live1_copy');
    // Top-anchored: the first thing on the page starts at the top of the writing room.
    expect(copyBox.y).toBeCloseTo(56, 0);
    expect(copyBox.x).toBeCloseTo(livePage * PAGE_STRIDE + 70, 0);
  });

  it('draws the mark on the copy, under just the part the doubt is about', () => {
    const mark = byId(out.elements, 'live1_0');
    expect(mark).toMatchObject({ kind: 'mark', shape: 'underline' });
    const r = boxOf(mark);
    expect(pageOf(r)).toBe(livePage);
    expect(r.x).toBeGreaterThanOrEqual(copyBox.x - 1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(copyBox.x + copyBox.w + 1e-6);
    // "7(3 - 2y)" is 9 of the 19 characters of "7(3 - 2y) - 15y = 2".
    expect(r.w).toBeCloseTo((copyBox.w * 9) / 19, 3);
  });

  it('writes the three lines of working under the copy, in order, left-aligned, one per sentence', () => {
    const lines = ['live1_1_s0', 'live1_1_s1', 'live1_1_s2'].map((id) => boxOf(byId(out.elements, id)));
    expect(lines[0].y).toBeGreaterThan(copyBox.y + copyBox.h);
    expect(lines[1].y).toBeGreaterThan(lines[0].y + lines[0].h);
    expect(lines[2].y).toBeGreaterThan(lines[1].y + lines[1].h);
    for (const r of lines) expect(r.x).toBeCloseTo(copyBox.x, 6);
    expect(out.revealBySay).toEqual([
      { say: 'Look at this part.', ink: ['live1_copy', 'live1_0'], point: [] },
      { say: 'Let us open the bracket together.', ink: [], point: [] },
      { say: 'Seven times three is twenty-one.', ink: ['live1_1_s0'], point: [] },
      { say: 'Seven times minus two y is minus fourteen y.', ink: ['live1_1_s1'], point: [] },
      { say: 'So the bracket opens to twenty-one minus fourteen y.', ink: ['live1_1_s2'], point: [] },
    ]);
  });

  it('frames exactly the doubt page', () => {
    expect(out.pageIds).toEqual(['live1_copy', 'live1_0', 'live1_1_s0', 'live1_1_s1', 'live1_1_s2']);
  });

  it('passes validateLesson and the overlap gate, and never touches the catalogue lesson (TD13)', () => {
    expect(validateLesson(out.lesson)).toMatchObject({ ok: true });
    expect(liveOverlaps(out.lesson, out.state)).toEqual([]);
    expect(JSON.stringify(lesson)).toBe(before);
    expect(out.lesson).not.toBe(lesson);
    expect(out.lesson.elements).toHaveLength(lesson.elements.length + out.elements.length);
    expect(augmentLesson(lesson, out.state)).toEqual(out.lesson);
    expect(state0).toEqual(emptyLiveState());
  });
});

describe('a doubt page, turn after turn', () => {
  it('a circle with no span loops round the whole copy', () => {
    const out = turn(load(), emptyLiveState(), [{ say: 'This one.', ink: [{ op: 'mark', targetId: 'b3_2', shape: 'circle' }] }], {
      kind: 'doubtPage',
      copyOf: 'b3_2',
    });
    const mark = boxOf(byId(out.elements, 'live1_0'));
    expect(inside(boxOf(byId(out.elements, 'live1_copy')), mark)).toBe(true);
  });

  it('continues on the same page below the last turn, with the first turn left exactly where it was', () => {
    const lesson = load();
    const one = turn(lesson, emptyLiveState(), [{ say: 'First.', ink: [{ op: 'write', text: 'x = 3 - 2y' }] }], {
      kind: 'doubtPage',
      copyOf: 'b3_2',
    });
    const two = turn(
      lesson,
      one.state,
      [{ say: 'Again.', ink: [{ op: 'write', text: 'y = 19/29' }, { op: 'mark', targetId: 'b3_2', shape: 'circle' }] }],
      { kind: 'doubtPage', continue: true },
    );
    expect(two.state.pages).toEqual([9]);
    expect(two.lesson.canvas.w).toBe(one.lesson.canvas.w);
    expect(two.state.elements.slice(0, one.state.elements.length)).toEqual(one.state.elements);
    const first = boxOf(byId(one.elements, 'live1_0'));
    const second = boxOf(byId(two.elements, 'live2_0'));
    expect(second.y).toBeGreaterThan(first.y + first.h);
    // The mark on b3_2 still lands on the copy, which is on this page.
    expect(pageOf(boxOf(byId(two.elements, 'live2_1')))).toBe(9);
  });

  it('a new doubt opens a new page, further right', () => {
    const lesson = load();
    const one = turn(lesson, emptyLiveState(), [{ say: 'First.', ink: [{ op: 'write', text: 'a' }] }], { kind: 'doubtPage' });
    const two = turn(lesson, one.state, [{ say: 'Second.', ink: [{ op: 'write', text: 'b' }] }], { kind: 'doubtPage' });
    expect(two.state.pages).toEqual([9, 10]);
    expect(two.lesson.canvas.w).toBe(lesson.canvas.w + 2 * PAGE_STRIDE);
    expect(pageOf(boxOf(byId(two.elements, 'live2_0')))).toBe(10);
  });

  it('opens no page, and widens nothing, when every op in the turn was dropped', () => {
    const lesson = load();
    const out = layoutLiveTurn(lesson, emptyLiveState(), [], { kind: 'doubtPage', copyOf: 'b3_2' });
    expect(out.elements).toEqual([]);
    expect(out.lesson.canvas.w).toBe(lesson.canvas.w);
    expect(out.state.pages).toEqual([]);
    expect(out.pageIds).toEqual([]);
  });

  it('drops a copy of something that is not on the board, and still opens the page for the working', () => {
    const out = turn(load(), emptyLiveState(), [{ say: 'Here.', ink: [{ op: 'write', text: 'x = 1' }] }], {
      kind: 'doubtPage',
      copyOf: 'nope',
    });
    expect(out.elements.map((e) => e.id)).toEqual(['live1_0']);
    expect(out.dropped).toEqual([{ at: 'target.copyOf', reason: expect.stringContaining('nope') }]);
  });

  it('copies a list that shares nothing with the catalogue lesson', () => {
    const lesson = load();
    const out = turn(lesson, emptyLiveState(), [{ say: 'The four steps.', ink: [] }], { kind: 'doubtPage', copyOf: 'b4_2' });
    const copy = byId(out.elements, 'live1_copy') as Extract<Element, { kind: 'list' }>;
    const original = byId(lesson.elements, 'b4_2') as Extract<Element, { kind: 'list' }>;
    expect(copy.items).toEqual(original.items);
    copy.items[0].term = 'changed on the live page';
    expect(original.items[0].term).not.toBe('changed on the live page');
  });

  it('copies a card with its heading and body, bonded to their frame', () => {
    const lesson = load();
    const out = turn(lesson, emptyLiveState(), [{ say: 'Remember this rule.', ink: [] }], {
      kind: 'doubtPage',
      copyOf: 'b2_10_c0',
    });
    expect(out.elements.map((e) => e.kind)).toEqual(['box', 'text', 'text']);
    expect(liveOverlaps(out.lesson, out.state)).toEqual([]);
    expect(validateLesson(out.lesson)).toMatchObject({ ok: true });
  });
});

describe('marks and arrows stay on one page', () => {
  it('drops a mark or an arrow whose target is on another page', () => {
    const out = turn(
      load(),
      emptyLiveState(),
      [
        {
          say: 'Look back.',
          ink: [
            { op: 'write', id: 'w', text: 'x = 49/29' },
            { op: 'mark', targetId: 'b3_2', shape: 'circle' },
            { op: 'arrow', fromId: 'b3_2', toId: 'w' },
            { op: 'point', ids: ['b3_2', 'w'] },
          ],
        },
      ],
      { kind: 'doubtPage' },
    );
    expect(out.elements.map((e) => e.id)).toEqual(['live1_0']);
    expect(out.dropped.map((d) => d.at)).toEqual(['steps[0].ink[1]', 'steps[0].ink[2]']);
    for (const d of out.dropped) expect(d.reason).toMatch(/page/);
    expect(out.revealBySay[0].point).toEqual(['live1_0']);
  });

  it('draws an arrow between two lines on the same page, its label beside them when the middle is on ink', () => {
    const out = turn(
      load(),
      emptyLiveState(),
      [
        {
          say: 'From this line to that one.',
          ink: [
            { op: 'write', id: 'a', text: '7(3 - 2y) - 15y = 2' },
            { op: 'write', id: 'b', text: '21 - 14y - 15y = 2' },
            { op: 'arrow', fromId: 'a', toId: 'b', label: 'open it' },
          ],
        },
      ],
      { kind: 'doubtPage' },
    );
    expect(byId(out.elements, 'live1_2')).toMatchObject({ kind: 'arrow' });
    const label = boxOf(byId(out.elements, 'live1_2_label'));
    const a = boxOf(byId(out.elements, 'live1_0'));
    const b = boxOf(byId(out.elements, 'live1_1'));
    expect(label.x).toBeGreaterThan(Math.max(a.x + a.w, b.x + b.w));
    expect(out.revealBySay[0].ink).toEqual(['live1_0', 'live1_1', 'live1_2', 'live1_2_label']);
    expect(out.dropped).toEqual([]);
    expect(liveOverlaps(out.lesson, out.state)).toEqual([]);
    expect(validateLesson(out.lesson)).toMatchObject({ ok: true });
  });

  it('draws the arrow without its label when there is no clear room for the words', () => {
    const out = turn(
      load(),
      emptyLiveState(),
      [
        {
          say: 'Two lines.',
          ink: [
            { op: 'write', id: 'a', text: '7(3 - 2y) - 15y = 2' },
            { op: 'note', text: 'Something written right across the board in between the two lines, wide.' },
            { op: 'write', id: 'b', text: '21 - 14y - 15y = 2' },
            { op: 'arrow', fromId: 'a', toId: 'b', label: 'open it' },
          ],
        },
      ],
      { kind: 'doubtPage' },
    );
    expect(out.elements.filter((e) => e.kind === 'arrow')).toHaveLength(1);
    expect(out.elements.some((e) => e.id.endsWith('_label'))).toBe(false);
    expect(out.dropped).toEqual([{ at: 'steps[0].ink[3]', reason: expect.stringMatching(/arrow label/) }]);
    expect(liveOverlaps(out.lesson, out.state)).toEqual([]);
  });

  it('opens nothing for a newPage with no ink after it', () => {
    const out = turn(
      load(),
      emptyLiveState(),
      [{ say: 'One.', ink: [{ op: 'write', text: 'a' }, { op: 'newPage' }] }],
      { kind: 'doubtPage' },
    );
    expect(out.state.pages).toEqual([9]);
    expect(out.lesson.canvas.w).toBe(load().canvas.w + PAGE_STRIDE);
  });

  it('puts ink after newPage on the next page', () => {
    const out = turn(
      load(),
      emptyLiveState(),
      [{ say: 'One.', ink: [{ op: 'write', text: 'a' }, { op: 'newPage' }, { op: 'write', text: 'b' }] }],
      { kind: 'doubtPage' },
    );
    expect(out.state.pages).toEqual([9, 10]);
    expect(pageOf(boxOf(byId(out.elements, 'live1_0')))).toBe(9);
    expect(pageOf(boxOf(byId(out.elements, 'live1_1')))).toBe(10);
    expect(out.pageIds).toEqual(['live1_1']);
  });

  it('boxes a line with a frame bonded to it, and ticks beside a line rather than across it', () => {
    const out = turn(
      load(),
      emptyLiveState(),
      [
        {
          say: 'This one is right.',
          ink: [
            { op: 'write', id: 'a', text: 'y = 19/29' },
            { op: 'mark', targetId: 'a', shape: 'box' },
            { op: 'mark', targetId: 'a', shape: 'tick' },
          ],
        },
      ],
      { kind: 'doubtPage' },
    );
    const line = boxOf(byId(out.elements, 'live1_0'));
    const frame = byId(out.elements, 'live1_1');
    expect(frame).toMatchObject({ kind: 'box', label: '' });
    expect(inside(line, boxOf(frame))).toBe(true);
    expect(out.state.bonds).toContainEqual({ a: 'live1_1', b: 'live1_0' });
    const tick = boxOf(byId(out.elements, 'live1_2'));
    expect(tick.x).toBeGreaterThan(line.x + line.w);
    expect(liveOverlaps(out.lesson, out.state)).toEqual([]);
  });
});

describe('a held question writes into its prepared work area', () => {
  it('lands inside the area, top-anchored, without widening the canvas', () => {
    const lesson = heldLesson();
    const area = lesson.beats[0].workArea!;
    const out = turn(lesson, emptyLiveState(), [{ say: 'Write it here.', ink: [{ op: 'write', text: 'x = 3 - 2y' }] }], {
      kind: 'workArea',
      beatId: 'q',
    });
    const r = boxOf(byId(out.elements, 'live1_0'));
    expect(inside(r, area)).toBe(true);
    expect(r.y).toBeCloseTo(area.y, 6);
    expect(out.lesson.canvas.w).toBe(lesson.canvas.w);
    expect(out.state.pages).toEqual([]);
    // The camera frames the question's page: what the beat shows there, plus the new line.
    expect(out.pageIds).toEqual([...lesson.beats[0].show, 'live1_0']);
    expect(liveOverlaps(out.lesson, out.state)).toEqual([]);
  });

  it('marks the prepared equation on the same page', () => {
    const lesson = heldLesson();
    const eq = lesson.elements.find((e) => e.kind === 'formula')!;
    const out = turn(lesson, emptyLiveState(), [{ say: 'This one.', ink: [{ op: 'mark', targetId: eq.id, shape: 'circle' }] }], {
      kind: 'workArea',
      beatId: 'q',
    });
    expect(out.elements).toHaveLength(1);
    expect(inside(boxOf(eq), boxOf(out.elements[0]))).toBe(true);
  });

  it('continues below the last turn, and turns to a fresh page when the area is full', () => {
    const lesson = heldLesson();
    const area = lesson.beats[0].workArea!;
    let state = emptyLiveState();
    const placed: Element[][] = [];
    for (let n = 0; n < 5; n += 1) {
      const out = turn(lesson, state, [{ say: `Line ${n}.`, ink: [{ op: 'write', text: `step ${n}: x = ${n}` }] }], {
        kind: 'workArea',
        beatId: 'q',
      });
      placed.push(out.elements);
      // Nothing written earlier ever moves.
      expect(out.state.elements.slice(0, state.elements.length)).toEqual(state.elements);
      state = out.state;
    }
    const boxes = placed.map((els) => boxOf(els[0]));
    const inArea = boxes.filter((r) => inside(r, area));
    expect(inArea.length).toBeGreaterThanOrEqual(2);
    expect(inArea.length).toBeLessThan(5);
    const overflow = boxes.slice(inArea.length);
    const firstLivePage = Math.ceil((lesson.canvas.w - CANVAS_W) / PAGE_STRIDE) + 1;
    for (const r of overflow) expect(pageOf(r)).toBe(firstLivePage);
    expect(state.pages).toEqual([firstLivePage]);
    const final = augmentLesson(lesson, state);
    expect(validateLesson(final)).toMatchObject({ ok: true });
    expect(liveOverlaps(final, state)).toEqual([]);
  });

  it('steps down past prepared ink inside a work area rather than writing over it', () => {
    // A work area the prep gate would have refused: over b3_7 and b3_12. The
    // live board does not get to assume the gate ran.
    const lesson = load();
    lesson.beats.find((b) => b.id === 'b3_4')!.workArea = { id: 'w', x: 4 * PAGE_STRIDE + 70, y: 420, w: 860, h: 160 };
    const out = turn(lesson, emptyLiveState(), [{ say: 'Try.', ink: [{ op: 'write', text: 'x = 3 - 2y, so substitute it into (1)' }] }], {
      kind: 'workArea',
      beatId: 'b3_4',
    });
    const r = boxOf(byId(out.elements, 'live1_0'));
    const b3_12 = boxOf(byId(lesson.elements, 'b3_12'));
    // At the top of the area it would sit on b3_7 and b3_12, so it starts below both.
    expect(pageOf(r)).toBe(4);
    expect(r.y).toBeGreaterThan(420);
    expect(r.y).toBeGreaterThanOrEqual(b3_12.y + b3_12.h);
    expect(liveOverlaps(out.lesson, out.state)).toEqual([]);
  });

  it('opens a fresh page for a held question with no work area, and keeps using it', () => {
    const lesson = load(); // prepared before T1.5: no beat carries a work area
    const one = turn(lesson, emptyLiveState(), [{ say: 'Try it.', ink: [{ op: 'write', text: 'x = 3 - 2y' }] }], {
      kind: 'workArea',
      beatId: 'b3_4',
    });
    const two = turn(lesson, one.state, [{ say: 'Next.', ink: [{ op: 'write', text: 'y = 19/29' }] }], {
      kind: 'workArea',
      beatId: 'b3_4',
    });
    expect(two.state.pages).toEqual([9]);
    expect(pageOf(boxOf(byId(two.elements, 'live2_0')))).toBe(9);
  });
});

describe('ids', () => {
  it('drops ink whose id is already on the board, rather than drawing a duplicate', () => {
    const lesson = load();
    const one = turn(lesson, emptyLiveState(), [{ say: 'a', ink: [{ op: 'write', text: 'first' }] }], { kind: 'doubtPage' });
    // Parsed as turn 1 again: the caller forgot to move the turn on.
    const stale = parseBoardOps([{ say: 'b', ink: [{ op: 'write', text: 'second' }] }], new Set(), { turn: 1 });
    const two = layoutLiveTurn(lesson, one.state, stale.steps, { kind: 'doubtPage', continue: true });
    expect(two.elements).toEqual([]);
    expect(two.dropped[0].reason).toMatch(/already on the board/);
    expect(validateLesson(two.lesson)).toMatchObject({ ok: true });
  });

  it('reads no id off an object prototype: a beat called "constructor" is just an unknown beat', () => {
    const out = turn(load(), emptyLiveState(), [{ say: 'a', ink: [{ op: 'write', text: 'x = 1' }] }], {
      kind: 'workArea',
      beatId: 'constructor',
    });
    expect(out.dropped).toEqual([{ at: 'target.beatId', reason: expect.stringContaining('constructor') }]);
    expect(pageOf(boxOf(byId(out.elements, 'live1_0')))).toBe(9);
  });

  it('moves the turn number on', () => {
    const one = turn(load(), emptyLiveState(), [{ say: 'a', ink: [{ op: 'write', text: 'x' }] }], { kind: 'doubtPage' });
    expect(nextTurn(emptyLiveState())).toBe(1);
    expect(nextTurn(one.state)).toBe(2);
  });
});
