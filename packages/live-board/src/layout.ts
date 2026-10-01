import {
  boxOf,
  handWidth,
  overlaps,
  textWidth,
  union,
  wrapHand,
  wrapLines,
  writeMs,
  CANVAS_H,
  CANVAS_W,
  PAGE_STRIDE,
  type Beat,
  type Element,
  type Lesson,
  type Rect,
  type Tone,
} from '@ai-tutor/lesson-format';
import { annotateElement, BOARD, connectElements, type Bond, type Placed } from '@ai-tutor/board-layout';
import type { BoardOp, Cursor, Dropped, LiveState, LiveStep, LiveTarget, MarkShape, Reveal } from './types';

/**
 * layoutLiveTurn — where live ink goes, decided by code and never by a model.
 *
 * APPEND MODE. The prepared layout (board-layout's `layoutBeat`) lays a whole
 * beat out at once, centres a stack that has nothing flexible in it, and lets
 * its solver nudge handwriting after the fact. All three are right for a
 * lesson prepared in advance and all three are wrong for a board being written
 * on in front of a child: the line she wrote a sentence ago would slide when
 * the next one arrived. So this places ink the way a hand does:
 *
 *   - TOP-ANCHORED. The first line of a region starts at its top. Nothing is
 *     ever centred vertically, so nothing waits on what comes after it.
 *   - ONE PASS, IN ORDER. Each block is placed at the next free row, checked
 *     against everything already on the board (prepared and live), and moved
 *     DOWN past anything it would sit on. Nothing placed is ever moved again,
 *     by this turn or any later one — which is why the ink of steps 1..k-1 is
 *     identical whether or not step k arrives (the property test checks it).
 *   - A PAGE IS THE UNIT. When ink no longer fits its region it goes to a new
 *     page to the right of everything, and `canvas.w` grows by one page. The
 *     camera's window is exactly one page (stage/src/frame.ts), so a region
 *     that ran past its page would be ink nobody sees.
 *
 * WHERE A TURN WRITES (`LiveTarget`, types.ts):
 *
 *   - a held question's prepared work area, falling back to a fresh page when
 *     the beat has none (the classes prepared before T1.5) or when it is full;
 *   - a doubt page, which OPENS with a copy of the element the doubt is about,
 *     so the mark and the working share one frame. Marks, arrows and points
 *     that name the original are redrawn on the copy.
 *
 * MARKS AND ARROWS STAY ON ONE PAGE: a mark whose target, or an arrow whose
 * end, is not on the page this turn is writing on is dropped — the camera
 * would either miss it or jump away from the working to show it.
 *
 * Sizes come from the same rulers Scene, the camera and board-layout's own
 * overlap gate use (`boxOf`, `textWidth`, `wrapLines` in lesson-format; marks
 * and arrows from board-layout's `annotateElement` and `connectElements`), so
 * "no overlap" here is the same claim the prep gate makes. It is an estimate
 * all the same: Scene's own note (renderHandwrite) says the handwriting face
 * runs wider than the ruler, so a long handwritten line can draw a little past
 * its measured box — by how much on a real phone is UNVERIFIED, exactly as it
 * is for prepared ink. Every element is an existing lesson-format kind; a turn
 * adds no new kind for the renderer to learn.
 *
 * Pure and deterministic: no DOM, no clock, no randomness, no model.
 */

/** Handwriting sizes, largest first. 26 is `boxOf`'s default, and the work area is sized for three lines of it. */
const HAND_SIZES = [26, 22, 18, 14] as const;
/** Printed equations: what `boxOf` measures a `formula` at. */
const FORMULA_SIZE = 24;
/** Between two blocks. More than a boxing frame's widest stand-off (BOX_PADS), so a frame never reaches the next block. */
const GAP = 12;
/** Between two wrapped lines of one block: board-layout's `handLead` clearance. */
const LINE_GAP = 10;
/** A note and a list are read, not glanced at; a line the width of the board is one the eye loses. */
const NOTE_MAX_W = 600;
const LIST_MAX_W = 705;
/** A card: its padding, and the sizes its heading and body may be written at. */
const CARD_MAX_W = 620;
const CARD_PAD_X = 12;
const CARD_PAD_Y = 14;
const CARD_HEAD_SIZES = [19, 17, 15, 13];
const CARD_BODY_SIZES = [16, 14, 12];
/** How far a boxing frame may stand off what it boxes, tried in order until one is clear. */
const BOX_PADS = [8, 6, 4, 2, 0];
/** A tick or a cross beside a line: its side, and the gap before it. */
const TICK_MAX = 48;
const TICK_GAP = 10;
/** How far past the arrow an arrow's label may be written before it stops reading as the arrow's. */
const LABEL_REACH = 240;

/** The writing room of a fresh page: the board's side margins, and from its top band to its bottom band. */
const PAGE_TOP = BOARD.TOP.y;
const PAGE_BOTTOM = BOARD.BOTTOM.y + BOARD.BOTTOM.h;
const EPS = 1e-6;

const excused = (el: Element): boolean => el.kind === 'mark' || el.kind === 'arrow';
const pageOfBox = (r: Rect): number => Math.floor((r.x + r.w / 2) / PAGE_STRIDE);
const pageOfEl = (el: Element): number => pageOfBox(boxOf(el));
const extent = (els: readonly Element[]): Rect => els.map(boxOf).reduce(union);

/** How long each wrapped line waits: until every line above it has been written (board-layout's rule). */
const afterLines = (lines: readonly string[], n: number): number =>
  lines.slice(0, n).reduce((sum, l) => sum + writeMs(l), 0);

/**
 * How many pages the prepared lesson already uses — from its canvas, and from
 * its ink, whichever says more. The first live page goes after both.
 */
function lessonPageCount(lesson: Lesson): number {
  const byCanvas = Math.max(1, Math.ceil((lesson.canvas.w - CANVAS_W) / PAGE_STRIDE) + 1);
  let right = 0;
  for (const el of lesson.elements) {
    const b = boxOf(el);
    right = Math.max(right, b.x + b.w);
  }
  const byInk = Math.floor(Math.max(0, right - 1) / PAGE_STRIDE) + 1;
  return Math.max(byCanvas, byInk);
}

/** A live session that has written nothing yet. */
export function emptyLiveState(): LiveState {
  return { turns: 0, pages: [], areas: {}, doubt: null, elements: [], bonds: [] };
}

/** The turn number the next turn's ids should carry: pass it to `parseBoardOps` as `turn`. */
export function nextTurn(state: LiveState): number {
  return state.turns + 1;
}

/**
 * The catalogue lesson with this session's live ink laid over it, as a NEW
 * object — for the renderer only (TD13: never saved, never shared).
 *
 * The canvas grows to take the last live page; the beats are untouched, so a
 * live id is on the board without being in any beat's `show`, and a caller
 * adds the live ids to `visible` itself (BoardSession, T2.3).
 */
export function augmentLesson(lesson: Lesson, state: LiveState): Lesson {
  const last = state.pages.length > 0 ? Math.max(...state.pages) : -1;
  const w = last >= 0 ? Math.max(lesson.canvas.w, last * PAGE_STRIDE + CANVAS_W) : lesson.canvas.w;
  return { ...lesson, canvas: { ...lesson.canvas, w }, elements: [...lesson.elements, ...state.elements] };
}

/**
 * Handwritten lines that fit a column: wrapped on words at the largest size
 * whose every line fits, left-aligned at `x`, top at `top`.
 *
 * Left-aligned because working is written down a board from one margin; a
 * centred line reads as a caption. The x a `handwrite` carries is its centre
 * (that is how `boxOf` and Scene read it), so each line's centre is its own
 * half-width in from the margin.
 */
function handLines(text: string, id: string, x: number, top: number, w: number): Element[] | string {
  for (const size of HAND_SIZES) {
    // Measured as her handwriting (Caveat), as `boxOf` measures a handwrite.
    const lines = wrapHand(text, w, size);
    if (!lines.every((l) => handWidth(l, size) <= w + EPS)) continue;
    const lead = size * 1.35 + LINE_GAP;
    return lines.map((l, n) => ({
      kind: 'handwrite' as const,
      id: n === 0 ? id : `${id}_l${n}`,
      x: x + handWidth(l, size) / 2,
      y: top + size + n * lead,
      text: l,
      size,
      ...(n > 0 ? { after: afterLines(lines, n) } : {}),
    }));
  }
  return 'too wide for the board, even written small';
}

/** The largest size in `sizes` at which `text` wraps to `w` with every line fitting. */
function fitLines(text: string, w: number, sizes: readonly number[]): { lines: string[]; size: number } | null {
  for (const size of sizes) {
    const lines = wrapLines(text, w, size);
    if (lines.every((l) => textWidth(l, size) <= w + EPS)) return { lines, size };
  }
  return null;
}

/** A built block: its elements, and the pairs among them that are meant to overlap. */
interface Built {
  elements: Element[];
  bonds: Bond[];
}

/**
 * A card: a frame, a heading and a body, each wrapped inside the frame.
 *
 * The same shape board-layout draws (an empty-labelled `box` with `text` over
 * it, bonded), but its height follows its words: a live body is whatever the
 * model wrote, and a fixed-height card with a long body ran its text out of
 * the frame.
 */
function cardBlock(op: Extract<BoardOp, { op: 'card' }>, x: number, top: number, w: number): Built | string {
  const cw = Math.min(w, CARD_MAX_W);
  const inner = cw - CARD_PAD_X * 2;
  const head = fitLines(op.title, inner, CARD_HEAD_SIZES);
  const body = fitLines(op.body, inner, CARD_BODY_SIZES);
  if (!head || !body) return 'card text too wide for its frame';
  const cx = x + cw / 2;
  const texts: Element[] = [];
  let y = top + CARD_PAD_Y;
  head.lines.forEach((l, n) => {
    texts.push({ kind: 'text', id: n === 0 ? `${op.id}_h` : `${op.id}_h${n}`, x: cx, y: y + head.size, text: l, size: head.size });
    y += head.size * 1.35 + 4;
  });
  y += 6;
  body.lines.forEach((l, n) => {
    texts.push({ kind: 'text', id: n === 0 ? `${op.id}_b` : `${op.id}_b${n}`, x: cx, y: y + body.size, text: l, size: body.size });
    y += body.size * 1.35 + 4;
  });
  const bottom = Math.max(...texts.map((t) => boxOf(t).y + boxOf(t).h));
  const frame: Element = { kind: 'box', id: op.id, x, y: top, w: cw, h: bottom + CARD_PAD_Y - top, label: '', as: 'box' };
  return { elements: [frame, ...texts], bonds: texts.map((t) => ({ a: op.id, b: t.id })) };
}

/**
 * A creating op as a block at (x, top) in a column `w` wide — or why it cannot be.
 * A work op is placed line by line by the caller, not here.
 */
function buildBlock(op: BoardOp, x: number, top: number, w: number): Built | string {
  switch (op.op) {
    case 'write': {
      const els = handLines(op.text, op.id, x, top, w);
      return typeof els === 'string' ? els : { elements: els, bonds: [] };
    }
    case 'equation': {
      // Printed when it fits on one line; written by hand, wrapped, when it
      // does not — an equation printed past the margin is off the page.
      const tw = textWidth(op.text, FORMULA_SIZE, true);
      if (tw <= w + EPS) {
        return { elements: [{ kind: 'formula', id: op.id, x: x + tw / 2, y: top + FORMULA_SIZE, text: op.text }], bonds: [] };
      }
      const els = handLines(op.text, op.id, x, top, w);
      return typeof els === 'string' ? els : { elements: els, bonds: [] };
    }
    case 'note':
      return {
        elements: [
          { kind: 'note', id: op.id, x, y: top, w: Math.min(w, NOTE_MAX_W), text: op.text, ...(op.tone ? { tone: op.tone } : {}) },
        ],
        bonds: [],
      };
    case 'list':
      return {
        elements: [
          {
            kind: 'list',
            id: op.id,
            x,
            y: top,
            w: Math.min(w, LIST_MAX_W),
            ...(op.heading ? { heading: op.heading } : {}),
            items: op.items.map((it) => ({ ...it })),
          },
        ],
        bonds: [],
      };
    case 'card':
      return cardBlock(op, x, top, w);
    default:
      return `${op.op} is not a block`;
  }
}

/** Kinds a doubt page can open with. A diagram is not one: its artwork is keyed by its own id. */
const COPYABLE: ReadonlySet<Element['kind']> = new Set([
  'title',
  'text',
  'formula',
  'handwrite',
  'note',
  'list',
  'box',
  'graphic',
  'image',
  'chart',
  'flow',
]);

/**
 * A copy of a positioned element, renamed and moved by (dx, dy). Only kinds in
 * COPYABLE reach here, and every one of them is placed by its own x and y.
 * Cloned all the way down, so nothing in the copy — a list's items, a chart's
 * data — is shared with the catalogue lesson it came from (TD13).
 */
function moved(el: Element, id: string, dx: number, dy: number): Element {
  const copy = structuredClone(el) as Element & { x: number; y: number };
  copy.id = id;
  copy.x += dx;
  copy.y += dy;
  return copy;
}

/** A sub-rectangle of a single line of text: where `span` is drawn inside it. */
function spanBox(el: Element, span: string): Rect | null {
  if (el.kind !== 'handwrite' && el.kind !== 'formula' && el.kind !== 'text') return null;
  const mono = el.kind === 'formula';
  const size = el.kind === 'formula' ? FORMULA_SIZE : el.kind === 'handwrite' ? (el.size ?? 26) : (el.size ?? 20);
  // Matched with spaces ignored, so "7(3-2y)" finds "7(3 - 2y)" — then
  // measured on the text as it is written, spaces and all. Case counts: x
  // and X are different letters in an equation.
  const compact: number[] = [];
  for (let i = 0; i < el.text.length; i += 1) if (!/\s/.test(el.text[i])) compact.push(i);
  const hay = compact.map((i) => el.text[i]).join('');
  const needle = span.replace(/\s+/g, '');
  const at = needle ? hay.indexOf(needle) : -1;
  if (at < 0) return null;
  const start = compact[at];
  const end = compact[at + needle.length - 1] + 1;
  const whole = boxOf(el);
  // The same ruler `boxOf` used for the whole line, or the span drifts off it.
  const measure = (t: string): number =>
    el.kind === 'handwrite' ? handWidth(t, size) : textWidth(t, size, mono);
  return {
    x: whole.x + measure(el.text.slice(0, start)),
    y: whole.y,
    w: measure(el.text.slice(start, end)),
    h: whole.h,
  };
}

const MARK_TONE: Record<MarkShape, Tone> = { circle: 'accent', underline: 'accent', box: 'accent', tick: 'good', cross: 'bad' };

export function layoutLiveTurn(
  lesson: Lesson,
  state: LiveState,
  steps: readonly LiveStep[],
  target: LiveTarget,
): {
  /** The elements this turn placed, in drawing order. */
  elements: Element[];
  /**
   * What the camera should frame once the turn is drawn: every element on the
   * page the turn's last ink landed on — the held question's page shows what
   * its beat shows there, then the live ink — newest last, which is the order
   * `computeFrame` follows. Empty when the turn placed nothing.
   */
  pageIds: string[];
  /** One entry per spoken line, with the ink that appears while it is said. */
  revealBySay: Reveal[];
  /** The session after this turn. The state passed in is not changed. */
  state: LiveState;
  /** `augmentLesson(lesson, state)`: the lesson to hand to Scene, and only to Scene. */
  lesson: Lesson;
  /** Ops the layout refused, by path into `steps`. */
  dropped: Dropped[];
} {
  if (steps.length === 0) {
    const same = { ...state, areas: { ...state.areas }, elements: [...state.elements], bonds: [...state.bonds], pages: [...state.pages] };
    return { elements: [], pageIds: [], revealBySay: [], state: same, lesson: augmentLesson(lesson, same), dropped: [] };
  }

  const dropped: Dropped[] = [];
  const placed: Element[] = [];
  const bonds: Bond[] = [];
  const opened: number[] = [];
  const firstLive = lessonPageCount(lesson);

  /** Every element on the board, by id: prepared, earlier turns, and this turn so far. */
  const all = new Map<string, Element>();
  for (const el of lesson.elements) all.set(el.id, el);
  for (const el of state.elements) all.set(el.id, el);
  /** What new ink must not sit on: every element that is not a mark or an arrow. */
  const obstacles: { id: string; box: Rect }[] = [...all.values()].filter((el) => !excused(el)).map((el) => ({ id: el.id, box: boxOf(el) }));

  /** The beat whose held question this turn writes for, when it does. */
  let beat: Beat | null = null;
  /** Where the next ink goes. Replaced, never rewound, when the page turns. */
  let cursor: Cursor;
  /** The region the turn last put ink in; what the session resumes from. */
  let lastInked: Cursor | null = null;
  /** The element a fresh doubt page opens with. */
  let copyOf: string | undefined;

  const commit = (els: readonly Element[], bs: readonly Bond[]): void => {
    for (const el of els) {
      placed.push(el);
      all.set(el.id, el);
      if (!excused(el)) obstacles.push({ id: el.id, box: boxOf(el) });
    }
    bonds.push(...bs);
    if (cursor.fresh) {
      cursor.fresh = false;
      opened.push(cursor.page);
    }
    // The cursor itself, not a copy: it keeps moving down while it is the
    // current one, and a page it leaves keeps the row it stopped at.
    lastInked = cursor;
  };

  const freshPage = (): Cursor => {
    const page = Math.max(firstLive, ...state.pages.map((p) => p + 1), ...opened.map((p) => p + 1));
    const x = page * PAGE_STRIDE + BOARD.SIDE;
    return { page, x, w: CANVAS_W - BOARD.SIDE * 2, top: PAGE_TOP, bottom: PAGE_BOTTOM, y: PAGE_TOP, live: true, fresh: true, redirects: {} };
  };

  // --- where this turn starts writing ---
  if (target.kind === 'workArea') {
    beat = lesson.beats.find((b) => b.id === target.beatId) ?? null;
    const kept = Object.hasOwn(state.areas, target.beatId) ? state.areas[target.beatId] : undefined;
    const area = beat?.workArea;
    if (!beat) dropped.push({ at: 'target.beatId', reason: `no beat "${target.beatId}"; writing on a fresh page` });
    if (kept) cursor = { ...kept, redirects: { ...kept.redirects } };
    else if (area) {
      cursor = {
        page: pageOfBox(area),
        x: area.x,
        w: area.w,
        top: area.y,
        bottom: area.y + area.h,
        y: area.y,
        live: false,
        fresh: false,
        redirects: {},
      };
    } else cursor = freshPage();
  } else if (target.continue && state.doubt) {
    cursor = { ...state.doubt, redirects: { ...state.doubt.redirects } };
  } else {
    cursor = freshPage();
    copyOf = target.copyOf;
  }

  const taken = (els: readonly Element[]): string | null => els.find((el) => all.has(el.id))?.id ?? null;
  const drop = (at: string, reason: string): void => {
    dropped.push({ at, reason });
  };

  /**
   * Place one block at the next free row, turning the page when it does not
   * fit and stepping down past anything it would sit on. Returns the ids it
   * placed, or null when it was dropped.
   */
  const place = (build: (x: number, top: number, w: number) => Built | string, at: string): string[] | null => {
    for (let guard = 0; guard < 500; guard += 1) {
      const built = build(cursor.x, cursor.y, cursor.w);
      if (typeof built === 'string') {
        drop(at, built);
        return null;
      }
      const clash = taken(built.elements);
      if (clash) {
        drop(at, `id ${clash} is already on the board`);
        return null;
      }
      const r = extent(built.elements);
      const left = cursor.page * PAGE_STRIDE;
      if (r.x < left - EPS || r.x + r.w > left + CANVAS_W + EPS) {
        drop(at, 'too wide for one page');
        return null;
      }
      if (r.y + r.h > cursor.bottom + EPS) {
        if (cursor.fresh) {
          drop(at, 'too tall for one page');
          return null;
        }
        cursor = freshPage();
        continue;
      }
      const mine = built.elements.filter((el) => !excused(el)).map(boxOf);
      const hits = obstacles.filter((o) => mine.some((m) => overlaps(m, o.box)));
      if (hits.length > 0) {
        cursor.y = Math.max(cursor.y + 1, ...hits.map((h) => h.box.y + h.box.h + GAP));
        continue;
      }
      commit(built.elements, built.bonds);
      cursor.y = r.y + r.h + GAP;
      return built.elements.map((el) => el.id);
    }
    drop(at, 'found no room');
    return null;
  };

  /**
   * An id as it stands on THIS page: a doubt page's copy stands in for its
   * original. Own keys only, so an id such as `constructor` is never read off
   * the object's prototype.
   */
  const onPage = (id: string): string => (Object.hasOwn(cursor.redirects, id) ? cursor.redirects[id] : id);
  const here = (id: string): Element | null => {
    const el = all.get(onPage(id));
    return el && pageOfEl(el) === cursor.page ? el : null;
  };

  const reveal: Reveal[] = [];

  // --- a doubt page opens with a copy of what the doubt is about ---
  const copyIds: string[] = [];
  if (copyOf !== undefined) {
    const orig = all.get(copyOf);
    if (!orig) drop('target.copyOf', `"${copyOf}" is not on the board`);
    else if (!COPYABLE.has(orig.kind)) drop('target.copyOf', `a ${orig.kind} cannot be copied onto a page`);
    else {
      // Numbered from the session alone, never from the steps, so the copy's
      // id is the same however many steps of the turn have arrived.
      const n0 = state.turns + 1;
      let copyId = `live${n0}_copy`;
      for (let n = 2; all.has(copyId); n += 1) copyId = `live${n0}_copy${n}`;
      // A card is its frame and its words; a wrapped line is its first line
      // and the lines under it. The copy takes the whole of it.
      const parts: [Element, string][] = [[orig, copyId]];
      const card = /^(.*)_c(\d+)$/.exec(orig.id);
      if (orig.kind === 'box' && card) {
        for (const [part, suffix] of [[`${card[1]}_h${card[2]}`, '_h'], [`${card[1]}_b${card[2]}`, '_b']] as const) {
          const el = all.get(part);
          if (el) parts.push([el, `${copyId}${suffix}`]);
        }
      }
      if (orig.kind === 'handwrite') {
        for (let n = 1; all.has(`${orig.id}_l${n}`); n += 1) parts.push([all.get(`${orig.id}_l${n}`)!, `${copyId}_l${n}`]);
      }
      const g = extent(parts.map(([el]) => el));
      const ids = place((x, top, w) => {
        if (g.w > w + EPS) return `"${copyOf}" is too wide to copy onto a page`;
        return {
          elements: parts.map(([el, id]) => moved(el, id, x - g.x, top - g.y)),
          bonds: orig.kind === 'box' ? parts.slice(1).map(([, id]) => ({ a: copyId, b: id })) : [],
        };
      }, 'target.copyOf');
      if (ids) {
        copyIds.push(...ids);
        for (const [el, id] of parts) cursor.redirects[el.id] = id;
      }
    }
  }

  // --- the turn, step by step ---
  steps.forEach((step, i) => {
    let current: Reveal = { say: step.say, ink: i === 0 ? [...copyIds] : [], point: [] };
    reveal.push(current);
    step.ink.forEach((op, j) => {
      const at = `steps[${i}].ink[${j}]`;
      switch (op.op) {
        case 'write':
        case 'equation':
        case 'note':
        case 'list':
        case 'card': {
          const ids = place((x, top, w) => buildBlock(op, x, top, w), at);
          if (ids) current.ink.push(...ids);
          break;
        }
        case 'work': {
          // One line per sentence: each is its own moment of the turn, and ink
          // after the working in the same step arrives with its last line.
          op.steps.forEach((ws, k) => {
            current = { say: ws.say, ink: [], point: [] };
            reveal.push(current);
            const ids = place((x, top, w) => {
              const els = handLines(ws.line, ws.id, x, top, w);
              return typeof els === 'string' ? els : { elements: els, bonds: [] };
            }, `${at}.steps[${k}]`);
            if (ids) current.ink.push(...ids);
          });
          break;
        }
        case 'mark': {
          const marked = here(op.targetId);
          if (!marked) {
            drop(at, all.has(onPage(op.targetId)) ? `mark target ${op.targetId} is on another page` : `mark target ${op.targetId} was not placed`);
            break;
          }
          const box = (op.span ? spanBox(marked, op.span) : null) ?? boxOf(marked);
          const tone = MARK_TONE[op.shape];
          const left = cursor.page * PAGE_STRIDE;
          let made: Built;
          if (op.shape === 'circle' || op.shape === 'underline') {
            const placedBox: Placed = { id: 't', elementId: marked.id, ...box };
            made = { elements: annotateElement({ do: 'annotate', target: 't', mark: op.shape, tone }, new Map([['t', placedBox]]), op.id), bonds: [] };
          } else if (op.shape === 'tick' || op.shape === 'cross') {
            // Beside the line, the way a teacher ticks an answer — across a
            // whole line a tick is a slash through the working.
            const s = Math.min(TICK_MAX, box.h + 8);
            let x = box.x + box.w + TICK_GAP;
            if (x + s > left + CANVAS_W - 4) x = box.x + box.w - s;
            made = { elements: [{ kind: 'mark', id: op.id, x, y: box.y + box.h / 2 - s / 2, w: s, h: s, shape: op.shape, tone }], bonds: [] };
          } else {
            // A frame is a `box`, which the overlap gate does not excuse the
            // way it excuses a mark. So it is bonded to what it frames, and
            // stands off it only as far as there is clear board to do so.
            const inner = obstacles.filter((o) => o.id === marked.id || overlaps(o.box, box)).map((o) => o.id);
            let frame: Rect = box;
            for (const pad of BOX_PADS) {
              const r = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
              const inPage = r.x >= left && r.x + r.w <= left + CANVAS_W && r.y >= 0 && r.y + r.h <= CANVAS_H;
              if (inPage && !obstacles.some((o) => !inner.includes(o.id) && overlaps(o.box, r))) {
                frame = r;
                break;
              }
            }
            made = {
              elements: [{ kind: 'box', id: op.id, ...frame, label: '', tone, as: 'box' }],
              bonds: [...new Set([marked.id, ...inner])].map((b) => ({ a: op.id, b })),
            };
          }
          const clash = taken(made.elements);
          if (clash) {
            drop(at, `id ${clash} is already on the board`);
            break;
          }
          commit(made.elements, made.bonds);
          current.ink.push(...made.elements.map((el) => el.id));
          break;
        }
        case 'arrow': {
          const from = here(op.fromId);
          const to = here(op.toId);
          if (!from || !to) {
            drop(at, `arrow ${op.fromId} to ${op.toId}: both ends must be on this page`);
            break;
          }
          const ends = new Map<string, Placed>([
            ['a', { id: 'a', elementId: from.id, ...boxOf(from) }],
            ['b', { id: 'b', elementId: to.id, ...boxOf(to) }],
          ]);
          let made = connectElements({ do: 'connect', from: 'a', to: 'b', tone: 'accent', ...(op.label ? { label: op.label } : {}) }, ends, op.id);
          /**
           * The label goes over the arrow's middle, where board-layout puts
           * it. Between two lines written one under the other that middle is
           * always on ink, so the one other place tried is just past the
           * right-hand end of the two things the arrow joins, level with the
           * middle — near enough to read as the arrow's, and only within
           * LABEL_REACH of it. Neither clear: the arrow is drawn without it.
           */
          const left = cursor.page * PAGE_STRIDE;
          const clearAt = (r: Rect): boolean =>
            r.x >= left && r.x + r.w <= left + CANVAS_W && r.y >= 0 && r.y + r.h <= CANVAS_H && !obstacles.some((o) => overlaps(o.box, r));
          const arrow = made.find((el) => el.kind === 'arrow');
          made = made.flatMap((el) => {
            if (excused(el) || el.kind !== 'handwrite' || !arrow || arrow.kind !== 'arrow') return [el];
            if (clearAt(boxOf(el))) return [el];
            const r = boxOf(el);
            const reach = Math.max(arrow.from.x, arrow.to.x);
            const edge = Math.max(boxOf(from).x + boxOf(from).w, boxOf(to).x + boxOf(to).w) + TICK_GAP;
            const beside: Element = { ...el, x: edge + r.w / 2 };
            if (edge - reach <= LABEL_REACH && clearAt(boxOf(beside))) return [beside];
            drop(at, 'no clear room for the arrow label; the arrow is drawn without it');
            return [];
          });
          if (made.length === 0) {
            drop(at, 'the arrow had nothing to draw');
            break;
          }
          const clash = taken(made);
          if (clash) {
            drop(at, `id ${clash} is already on the board`);
            break;
          }
          commit(made, []);
          current.ink.push(...made.map((el) => el.id));
          break;
        }
        case 'point': {
          const ids = op.ids.map(here).filter((el): el is Element => el !== null).map((el) => el.id);
          if (ids.length === 0) drop(at, 'point names nothing on this page');
          else current.point.push(...ids);
          break;
        }
        case 'recall': {
          if (lesson.beats.some((b) => b.id === op.beatId)) current.recall = op.beatId;
          else drop(at, `recall names no beat "${op.beatId}"`);
          break;
        }
        case 'newPage': {
          // A clean page — unless this one is already clean.
          if (!cursor.fresh) cursor = freshPage();
          break;
        }
      }
    });
  });

  // --- what the session remembers ---
  // The turn count moves on by one, or up to the highest turn number the
  // parser minted, so the next turn's ids cannot collide with these.
  const mintedTurns = steps.flatMap((s) =>
    s.ink.flatMap((op) => ('id' in op ? [Number(/^live(\d+)_/.exec(op.id)?.[1] ?? 0)] : [])),
  );
  const turns = Math.max(state.turns + 1, ...mintedTurns);
  const inked = lastInked as Cursor | null;
  const saved = inked ? { ...inked, redirects: { ...inked.redirects } } : null;
  const next: LiveState = {
    turns,
    pages: [...state.pages, ...opened],
    areas: { ...state.areas },
    doubt: state.doubt,
    elements: [...state.elements, ...placed],
    bonds: [...state.bonds, ...bonds],
  };
  if (target.kind === 'workArea') {
    if (saved) next.areas[target.beatId] = saved;
  } else {
    next.doubt = saved ?? (target.continue ? state.doubt : null);
  }

  // --- what the camera frames ---
  let pageIds: string[] = [];
  if (saved) {
    const page = saved.page;
    const prepared = (beat?.show ?? []).filter((id) => {
      const el = lesson.elements.find((e) => e.id === id);
      return el !== undefined && pageOfEl(el) === page;
    });
    pageIds = [...prepared, ...next.elements.filter((el) => pageOfEl(el) === page).map((el) => el.id)];
  }

  return { elements: placed, pageIds, revealBySay: reveal, state: next, lesson: augmentLesson(lesson, next), dropped };
}
