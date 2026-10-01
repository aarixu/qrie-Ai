import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  boxOf,
  CANVAS_H,
  CANVAS_W,
  PAGE_STRIDE,
  type Lesson,
  type Rect,
} from '@ai-tutor/lesson-format';
import { layoutBeat } from '@ai-tutor/board-layout';
import { emptyLiveState, parseBoardOps, type LiveStep } from '@ai-tutor/live-board';
import { BoardSession, layTurn } from '../src/lib/boardSession';
import { createSessionHalt } from '../src/lib/sessionHalt';

/**
 * T2.3 — THE BOARD SESSION: live ink beside the class, never inside it.
 *
 * The plan's acceptance, as behaviour:
 *   - the augmented lesson goes to Scene only, and the catalogue lesson — the
 *     one the player was built from — is never replaced or changed;
 *   - `visible` is the class beat's show set plus the live ids, so ending a
 *     doubt re-animates nothing that was already on the board;
 *   - during a doubt the camera frames the live doubt page, and after it the
 *     class resumes on the same beat;
 *   - live pages stay for the session, and none of it is saved (TD13).
 */

const fixture = path.resolve(process.cwd(), 'packages/live-board/tests/fixtures/lesson-substitution.json');
const load = (): Lesson => JSON.parse(readFileSync(fixture, 'utf8')) as Lesson;
const beatIndex = (lesson: Lesson, id: string): number => lesson.beats.findIndex((b) => b.id === id);
const pageOf = (r: Rect): number => Math.floor((r.x + r.w / 2) / PAGE_STRIDE);

/**
 * Scene's own rule for what draws in (packages/stage/src/Scene.tsx, `isNew`):
 * an id in the new visible set that was not in the PREVIOUS DISTINCT set is
 * animated. Replayed here over the sequence of sets the room hands Scene.
 */
function animatedAlong(sets: readonly string[][]): string[][] {
  const out: string[][] = [];
  let prev: Set<string> | null = null;
  let key: string | null = null;
  for (const set of sets) {
    const k = set.join('\u0000');
    if (k === key) {
      out.push([]);
      continue;
    }
    out.push(prev === null ? [...set] : set.filter((id) => !prev!.has(id)));
    prev = new Set(set);
    key = k;
  }
  return out;
}

/** The T2 demo turn: mark b3_2, then open the bracket in three lines. */
const EXPANSION = {
  steps: [
    { say: 'Look at this part.', ink: [{ op: 'mark', targetId: 'b3_2', shape: 'underline', span: '7(3 - 2y)' }] },
    {
      say: 'Seven multiplies each term inside.',
      ink: [
        {
          op: 'work',
          steps: [
            { say: 'Seven times three is twenty-one.', line: '7 × 3 = 21' },
            { say: 'Seven times two y is fourteen y.', line: '7 × 2y = 14y' },
            { say: 'So the bracket opens to twenty-one minus fourteen y.', line: '7(3 - 2y) = 21 - 14y' },
          ],
        },
      ],
    },
  ],
};

function doubtTurn(session: BoardSession, at: number) {
  const onScreen = new Set(session.canvas(at).visible);
  const parsed = parseBoardOps(EXPANSION, onScreen, { turn: session.state.turns + 1 });
  const laid = layTurn(session.lesson, session.state, parsed.steps, { kind: 'doubtPage', copyOf: 'b3_2' });
  if (!laid.ok) throw new Error(laid.reason);
  return laid.turn;
}

/**
 * A one-beat lesson whose held question has a work area, as a class kept before
 * 2026-10-01 carries one: board-layout no longer reserves it (an ask writes
 * nothing), but the live board still writes into one where a kept class has it.
 */
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
        workArea: { id: 'q_work', x: 60, y: 400, w: 880, h: 130 },
      },
      {
        id: 'next',
        topic: 'Next',
        narration: 'On we go.',
        show: laid.laid.show,
      },
    ],
  };
}

describe('the lesson Scene gets, and the one the player keeps', () => {
  it('hands Scene the lesson with live ink laid over it, and never changes the catalogue lesson', () => {
    const lesson = load();
    const before = JSON.stringify(lesson);
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    session.beginDoubt();
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });

    expect(session.lesson).toBe(lesson);
    expect(JSON.stringify(lesson)).toBe(before);
    const scene = session.sceneLesson;
    expect(scene).not.toBe(lesson);
    expect(scene.canvas.w).toBe(lesson.canvas.w + PAGE_STRIDE);
    for (const id of turn.placed) expect(scene.elements.some((el) => el.id === id)).toBe(true);
    // Same object on every read until the ink changes: Scene is not handed a
    // new lesson on every render.
    expect(session.sceneLesson).toBe(scene);
  });

  it('with no live ink at all, Scene gets the catalogue lesson itself', () => {
    const lesson = load();
    expect(new BoardSession(lesson).sceneLesson).toBe(lesson);
  });
});

describe('what is visible', () => {
  it('is the beat show set plus the live ids REVEALED so far — ink laid out but not yet spoken is not on the board', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    session.beginDoubt();
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });

    const show = lesson.beats[at].show;
    expect(session.canvas(at).visible).toEqual(show);
    session.reveal(turn.revealBySay[0].ink, turn.pageIds);
    expect(session.canvas(at).visible).toEqual([...show, ...turn.revealBySay[0].ink]);
  });

  it('during a doubt with ink, the camera frames the doubt page and nothing is dimmed', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    session.beginDoubt();
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });
    session.reveal(turn.revealBySay[0].ink, turn.pageIds);

    const canvas = session.canvas(at);
    expect(canvas.frame).toEqual(turn.pageIds);
    expect(canvas.focus).toEqual([]);
    const byId = new Map(session.sceneLesson.elements.map((el) => [el.id, el]));
    const pages = new Set(canvas.frame!.map((id) => pageOf(boxOf(byId.get(id)!))));
    expect([...pages]).toEqual([9]);
  });

  it('outside a doubt the camera follows the beat, never the live pages — even though they stay on the board', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    session.beginDoubt();
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });
    session.reveal(turn.placed, turn.pageIds);
    session.endDoubt();

    const canvas = session.canvas(at);
    expect(canvas.frame).toEqual(lesson.beats[at].frame);
    // TD13: kept for the session, recallable — still on the board.
    for (const id of turn.placed) expect(canvas.visible).toContain(id);
    // A beat with no frame of its own is framed on its own show set, not on
    // the live ink its visible set now carries.
    const noFrame = structuredClone(lesson);
    delete noFrame.beats[at].frame;
    const s2 = new BoardSession(noFrame);
    s2.beginDoubt();
    const t2 = doubtTurn(s2, at);
    s2.commit(t2, 'tutor', { subject: 'b3_2' });
    s2.reveal(t2.placed, t2.pageIds);
    s2.endDoubt();
    expect(s2.canvas(at).frame).toEqual(noFrame.beats[at].show);
  });
});

describe('a doubt ends and the class resumes: nothing prepared draws in again', () => {
  it('a recall during the doubt keeps the beat on the board, so ending it re-animates 0 prepared elements', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    const prepared = new Set(lesson.elements.map((el) => el.id));
    const sets: string[][] = [];
    const snap = () => sets.push(session.canvas(at).visible);

    snap(); // the class, playing b3_2
    session.beginDoubt();
    snap();
    // b3_1's show lacks b3_4: before BoardSession, a recall REPLACED visible
    // with it, and b3_4 drew in again when the doubt ended.
    session.recall('b3_1');
    snap();
    expect(session.canvas(at).frame).toEqual(lesson.beats[beatIndex(lesson, 'b3_1')].frame);
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });
    for (const reveal of turn.revealBySay) {
      session.reveal(reveal.ink, turn.pageIds);
      snap();
    }
    session.endDoubt();
    snap(); // the class, back on b3_2

    const animated = animatedAlong(sets);
    const reAnimated = animated.slice(1).flat().filter((id) => prepared.has(id));
    expect(reAnimated).toEqual([]);
    // What did draw in during the doubt is exactly the live ink, in order.
    expect(animated.slice(1).flat()).toEqual(turn.placed);
    expect(session.canvas(at).frame).toEqual(lesson.beats[at].frame);
  });

  it('a recall is dropped from the frame when the doubt writes: the newest thing is what the camera follows', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    session.beginDoubt();
    session.recall('b3_1');
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });
    session.reveal(turn.revealBySay[0].ink, turn.pageIds);
    expect(session.canvas(at).frame).toEqual(turn.pageIds);
    session.recall('b3_1');
    expect(session.canvas(at).frame).toEqual(lesson.beats[beatIndex(lesson, 'b3_1')].frame);
  });

  it('knows whether this doubt has a page yet, and what it is about, so its next turn continues it', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    session.beginDoubt();
    expect(session.doubt).toEqual({ hasPage: false });
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });
    expect(session.doubt).toEqual({ hasPage: true, subject: 'b3_2' });
    session.endDoubt();
    expect(session.doubt).toBeNull();
    session.beginDoubt();
    expect(session.doubt).toEqual({ hasPage: false });
  });
});

describe('who wrote what', () => {
  it('records the author of every live element; prepared ink is the lesson\'s', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    session.beginDoubt();
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });
    for (const id of turn.placed) expect(session.authorOf(id)).toBe('tutor');
    expect(session.authorOf('b3_2')).toBe('lesson');
  });
});

describe('the board at a held ask (T2.5 writes through this)', () => {
  it('writes into the prepared work area, reveals at once, and frames that page while the question holds', () => {
    const lesson = heldLesson();
    const session = new BoardSession(lesson);
    const area = lesson.beats[0].workArea!;
    const written = session.writeHeld('q', [
      { author: 'student', steps: [{ say: '', ink: [{ op: 'write', text: 'Your answer: y' }] }] },
    ]);
    expect(written.length).toBeGreaterThan(0);
    const els = session.sceneLesson.elements.filter((el) => written.includes(el.id));
    for (const el of els) {
      const b = boxOf(el);
      expect(b.x).toBeGreaterThanOrEqual(area.x - 1e-6);
      expect(b.y).toBeGreaterThanOrEqual(area.y - 1e-6);
      expect(b.x + b.w).toBeLessThanOrEqual(area.x + area.w + 1e-6);
      expect(b.y + b.h).toBeLessThanOrEqual(area.y + area.h + 1e-6);
    }
    for (const id of written) expect(session.canvas(0).visible).toContain(id);
    expect(session.canvas(0).frame).toEqual(expect.arrayContaining(written));
    expect(session.authorOf(written[0])).toBe('student');
    // The class moves on: the next beat is framed as authored.
    expect(session.canvas(1).frame).toEqual(lesson.beats[1].show);
  });

  it('an ask with no work area (every class prepared before T1.5) writes nothing, and the camera stays on the question', () => {
    // It used to write on a fresh page and frame THAT: a wrong tap moved the
    // camera off the question onto a blank page (overnight review #13).
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b1_4');
    const before = session.canvas(at);
    const written = session.writeHeld('b1_4', [
      { author: 'student', steps: [{ say: '', ink: [{ op: 'write', text: 'Your answer: add them' }] }] },
    ]);
    expect(written).toEqual([]);
    expect(session.canvas(at).frame).toEqual(before.frame);
    expect(session.canvas(at).visible).toEqual(before.visible);
  });
});

describe('the gate every turn passes before it reaches the board', () => {
  it('refuses a turn whose ink would not validate, and places none of it', () => {
    const lesson = load();
    // Built by hand, past the parser, which would never let an empty line through.
    const bad: LiveStep[] = [{ say: 'x', ink: [{ op: 'write', id: 'live1_0', text: '' }] }];
    const out = layTurn(lesson, emptyLiveState(), bad, { kind: 'doubtPage' });
    expect(out.ok).toBe(false);
  });

  it('passes the demo turn with 0 live overlaps', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    session.beginDoubt();
    expect(() => doubtTurn(session, beatIndex(lesson, 'b3_2'))).not.toThrow();
  });
});

describe('a halted class writes nothing more', () => {
  it('haltSession freezes the board: no commit, no reveal, no held ink, no recall', () => {
    const lesson = load();
    const session = new BoardSession(lesson);
    const at = beatIndex(lesson, 'b3_2');
    session.beginDoubt();
    const turn = doubtTurn(session, at);
    session.commit(turn, 'tutor', { subject: 'b3_2' });

    const halt = createSessionHalt({
      tts: { speak: async () => undefined, cancel: () => undefined },
      player: { pause: () => undefined },
      ear: { close: () => undefined },
      doubt: { halt: () => undefined },
      board: { freeze: () => session.freeze() },
      showSupport: () => undefined,
    });
    halt.haltSession('model-reply', 'support');

    const version = session.version;
    const listener = vi.fn();
    session.subscribe(listener);
    session.reveal(turn.placed, turn.pageIds);
    session.recall('b3_1');
    expect(session.commit(turn, 'tutor')).toBe(false);
    expect(session.writeHeld('b3_4', [{ author: 'student', steps: [{ say: '', ink: [{ op: 'write', text: 'x' }] }] }])).toEqual([]);
    expect(session.version).toBe(version);
    expect(listener).not.toHaveBeenCalled();
    expect(session.canvas(at).visible).toEqual(lesson.beats[at].show);
  });
});
