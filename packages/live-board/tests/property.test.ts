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
} from '@ai-tutor/lesson-format';
import { findOverlaps, layoutBeat } from '@ai-tutor/board-layout';
import {
  emptyLiveState,
  layoutLiveTurn,
  nextTurn,
  parseBoardOps,
  type LiveState,
  type LiveTarget,
} from '@ai-tutor/live-board';

/**
 * THE PROPERTY TEST T2.2 NAMES: 200 random sequences of live turns, and over
 * every one of them
 *
 *   - 0 unbonded overlaps involving live ink,
 *   - 0 validation errors on the augmented lesson,
 *   - the boxes of steps 1..k-1 do not change when step k lands,
 *
 * plus two the canvas protocol implies: every live element sits inside one
 * page (the camera's window is exactly one page, stage/src/frame.ts), and
 * ink placed by an earlier turn is never moved by a later one.
 *
 * The turns are what a careless or hostile model could send, not what a good
 * one would: lines over the cap, unknown ops, coordinates, references to ids
 * that do not exist or live on another page, copies of pictures and titles,
 * newPage twice in a row, a mark on a card frame. Seeded, so a failure names
 * a sequence that can be replayed.
 */

const fixture = path.resolve(process.cwd(), 'packages/live-board/tests/fixtures/lesson-substitution.json');
const substitution = (): Lesson => JSON.parse(readFileSync(fixture, 'utf8')) as Lesson;

/**
 * The substitution lesson with a work area the prep gate would have refused:
 * it sits over b3_7 and b3_12 on the held question's page. class-prep keeps
 * prepared ink out of a work area, but the live board does not get to assume
 * that — so the random turns here have to step down past prepared ink.
 */
function crowded(): Lesson {
  const lesson = substitution();
  const beat = lesson.beats.find((b) => b.id === 'b3_4')!;
  beat.workArea = { id: 'b3_4_work', x: 4 * PAGE_STRIDE + 70, y: 400, w: 860, h: 180 };
  return lesson;
}

function held(): Lesson {
  const laid = layoutBeat({
    id: 'q',
    topic: 'The first step',
    narration: '',
    board: [
      { do: 'title', text: 'Substitution' },
      { do: 'say', text: 'Here is the pair.' },
      { do: 'equation', text: 'x + 2y = 3' },
      { do: 'say', text: 'Which variable is easier to get on its own?' },
      { do: 'ask', question: 'Which variable is easier to get on its own?', expect: 'x' },
    ],
  });
  const ask = laid.asks[0];
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
        ask: ask.ask,
        // As a class kept before 2026-10-01 carries it; an ask writes nothing now.
        workArea: { id: 'q_work', x: 60, y: 400, w: 880, h: 130 },
      },
    ],
  };
}

/** mulberry32: small, fast, and the same numbers on every machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'x', 'y', '=', '3', '-', '2y', '7(3 - 2y)', '21', '14y', 'minus', 'so', 'the', 'bracket', 'opens',
  '19/29', '49/29', 'substitute', 'equation', '(1)', 'dekho', 'yahan', 'matlab', 'twenty-one', 'into',
  'x=3-2(19/29)=(87-38)/29=49/29', 'both', 'sides', 'LHS', 'RHS',
];

function generator(seed: number) {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const text = (maxWords: number) => Array.from({ length: int(1, maxWords) }, () => pick(WORDS)).join(' ');
  return { r, int, pick, text };
}

function randomTurn(seed: number, known: readonly string[], beats: readonly string[]): unknown {
  const { r, int, pick, text } = generator(seed);
  const local: string[] = [];
  // Mostly ink written earlier in this turn — which is on this page, so marks
  // and arrows get drawn — sometimes anything on the board, sometimes nothing.
  const ref = () => {
    const roll = r();
    if (roll < 0.1) return `ghost${int(0, 9)}`;
    if (local.length > 0 && roll < 0.7) return pick(local);
    return pick(known);
  };
  const named = () => {
    if (r() < 0.2) return {};
    const id = r() < 0.1 ? pick(known) : `n${local.length}`;
    local.push(id);
    return { id };
  };
  const op = (): unknown => {
    switch (int(0, 15)) {
      case 0:
      case 1:
        return { op: 'write', text: text(r() < 0.1 ? 40 : 10), ...named(), ...(r() < 0.2 ? { x: 5, y: 5 } : {}) };
      case 2:
        return { op: 'equation', text: text(r() < 0.1 ? 50 : 8), ...named() };
      case 3:
        return { op: 'note', text: text(30) + (r() < 0.3 ? '\n\n' + text(10) : ''), tone: pick(['good', 'bad', 'pink']), ...named() };
      case 4:
        return {
          op: 'list',
          ...(r() < 0.5 ? { heading: text(4) } : {}),
          items: Array.from({ length: int(1, 9) }, () => (r() < 0.5 ? text(3) : { term: text(2), meaning: text(12) })),
          ...named(),
        };
      case 5:
        return { op: 'card', title: text(r() < 0.1 ? 20 : 5), body: text(r() < 0.2 ? 40 : 12), ...named() };
      case 6:
        return {
          op: 'work',
          steps: Array.from({ length: int(1, 5) }, () => ({ say: text(8), line: text(6), ...named() })),
        };
      case 7:
      case 8:
        return {
          op: 'mark',
          targetId: ref(),
          shape: pick(['circle', 'underline', 'box', 'cross', 'tick', 'star']),
          ...(r() < 0.4 ? { span: pick(WORDS) } : {}),
        };
      case 9:
      case 10:
      case 15:
        return { op: 'arrow', fromId: ref(), toId: ref(), ...(r() < 0.6 ? { label: text(3) } : {}) };
      case 11:
        return { op: 'point', ids: [ref(), ref()] };
      case 12:
        return { op: 'recall', beatId: pick([...beats, 'nowhere']) };
      case 13:
        return { op: 'newPage' };
      case 14:
      default:
        return { op: pick(['erase', 'svg', 'move']), targetId: ref(), x: 10, y: 10 };
    }
  };
  return {
    steps: Array.from({ length: int(1, 6) }, () => ({
      say: text(12),
      ink: Array.from({ length: int(0, 4) }, op),
    })),
  };
}

function randomTarget(seed: number, lesson: Lesson): LiveTarget {
  const { r, pick } = generator(seed);
  const roll = r();
  // Mostly a beat that has a work area, when the lesson has one; sometimes any beat.
  const withArea = lesson.beats.filter((b) => b.workArea).map((b) => b.id);
  const beats = withArea.length > 0 && r() < 0.75 ? withArea : lesson.beats.map((b) => b.id);
  if (roll < 0.35) return { kind: 'workArea', beatId: pick(beats) };
  if (roll < 0.55) return { kind: 'doubtPage', continue: true };
  if (roll < 0.9) return { kind: 'doubtPage', copyOf: pick(lesson.elements.map((e) => e.id)) };
  return { kind: 'doubtPage' };
}

const isLive = (id: string) => id.startsWith('live');
const pageOf = (el: Element) => {
  const b = boxOf(el);
  return Math.floor((b.x + b.w / 2) / PAGE_STRIDE);
};

function liveProblems(lesson: Lesson, state: LiveState): string[] {
  const problems: string[] = [];
  const valid = validateLesson(lesson);
  if (!valid.ok) problems.push(...valid.errors);
  for (const o of findOverlaps(lesson.elements, { bonds: state.bonds })) {
    if (isLive(o.a) || isLive(o.b)) problems.push(`overlap ${o.a} over ${o.b}`);
  }
  for (const el of state.elements) {
    const b = boxOf(el);
    const left = pageOf(el) * PAGE_STRIDE;
    const eps = 1e-6;
    if (b.x < left - eps || b.x + b.w > left + CANVAS_W + eps || b.y < -eps || b.y + b.h > CANVAS_H + eps) {
      problems.push(`${el.id} leaves its page: ${JSON.stringify(b)}`);
    }
  }
  return problems;
}

describe('layoutLiveTurn over 200 random sequences', () => {
  it('never overlaps, always validates, keeps every page one page, and never moves placed ink', () => {
    const tally = { elements: 0, kinds: new Map<string, number>(), pagesOpened: 0, dropped: 0, labels: 0 };
    for (let seq = 0; seq < 200; seq += 1) {
      const lesson = seq % 4 === 3 ? crowded() : seq % 2 === 0 ? substitution() : held();
      const pristine = JSON.stringify(lesson);
      const beats = lesson.beats.map((b) => b.id);
      let state = emptyLiveState();
      const turns = 1 + (seq % 3);
      for (let t = 0; t < turns; t += 1) {
        const seed = seq * 97 + t * 13 + 1;
        const known = [...lesson.elements.map((e) => e.id), ...state.elements.map((e) => e.id)];
        const parsed = parseBoardOps(randomTurn(seed, known, beats), new Set(known), {
          turn: nextTurn(state),
          beatIds: new Set(beats),
        });
        const target = randomTarget(seed + 7, lesson);

        // Steps 1..k, for every k: what step k lands never moves steps 1..k-1.
        let previous: Element[] = [];
        let out = layoutLiveTurn(lesson, state, [], target);
        for (let k = 1; k <= parsed.steps.length; k += 1) {
          out = layoutLiveTurn(lesson, state, parsed.steps.slice(0, k), target);
          const now = new Map(out.elements.map((el) => [el.id, el]));
          for (const el of previous) {
            const same = now.get(el.id);
            expect(same, `seq ${seq} turn ${t}: ${el.id} vanished when step ${k} landed`).toBeDefined();
            expect(boxOf(same!), `seq ${seq} turn ${t}: ${el.id} moved when step ${k} landed`).toEqual(boxOf(el));
            expect(same).toEqual(el);
          }
          previous = out.elements;
          expect(liveProblems(out.lesson, out.state), `seq ${seq} turn ${t} step ${k}`).toEqual([]);
        }

        // An earlier turn's ink is exactly where it was.
        expect(out.state.elements.slice(0, state.elements.length)).toEqual(state.elements);
        tally.dropped += out.dropped.length + parsed.dropped.length;
        tally.pagesOpened += out.state.pages.length - state.pages.length;
        state = out.state;
      }
      for (const el of state.elements) tally.kinds.set(el.kind, (tally.kinds.get(el.kind) ?? 0) + 1);
      tally.labels += state.elements.filter((el) => el.id.endsWith('_label')).length;
      tally.elements += state.elements.length;
      expect(JSON.stringify(lesson), `seq ${seq}: the catalogue lesson was mutated`).toBe(pristine);
    }

    // The sequences really exercised the board, not an empty loop.
    expect(tally.elements).toBeGreaterThan(1000);
    for (const kind of ['handwrite', 'formula', 'note', 'list', 'box', 'text', 'mark', 'arrow']) {
      expect(tally.kinds.get(kind) ?? 0, `too few ${kind} were placed`).toBeGreaterThan(20);
    }
    expect(tally.labels, 'too few arrow labels were placed').toBeGreaterThan(3);
    expect(tally.pagesOpened).toBeGreaterThan(50);
    expect(tally.dropped).toBeGreaterThan(50);
  });
});
