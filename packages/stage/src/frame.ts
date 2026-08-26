import type { Element, Lesson } from '@ai-tutor/lesson-format';

/**
 * WHERE THE CAMERA POINTS.
 *
 * A lesson is authored on a board a thousand units wide, but a phone is 390px
 * wide. Fitting the whole board into that gives a scale of 0.39 — which renders
 * a note's 14.5px text at 5.7px. The content was always there; it was sub-pixel.
 *
 * So the board is not shown whole. Each beat is framed on what it is actually
 * teaching: the focused elements if the beat named any, otherwise everything
 * visible. That is the same thing a teacher does when she stops talking about
 * the whole diagram and points at one corner of it.
 *
 * Pure geometry, no DOM — the renderer asks where to point and does as it is
 * told, exactly like every other decision in this package.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The board never zooms past this. Past ~3x a single small element fills the
 * screen with no surroundings, and a diagram with no context is not a diagram.
 */
const MAX_ZOOM = 3;

/** Breathing room around the framed content, as a fraction of the frame's larger side. */
const PAD = 0.09;

/**
 * Advance-width estimates, in ems. Text has no measurable width without a DOM,
 * and the frame must be identical on the server, in a test and in a browser —
 * so it is estimated, generously. An over-wide estimate zooms out slightly;
 * an under-wide one clips a word, which is much worse.
 */
const EM_SANS = 0.58;
const EM_MONO = 0.62;

/**
 * Mirrors Scene's note layout: the card wraps at roughly this many characters
 * and every wrapped line is 21px tall, over a 60px allowance for padding.
 *
 * Exported because Scene sizes the real foreignObject with it — two different
 * answers here would frame a note that is not the size it renders at.
 */
export function noteBoxHeight(text: string, w: number): number {
  const charsPerLine = Math.max(6, Math.floor((w - 26) / 7));
  return Math.ceil(text.length / charsPerLine) * 21 + 60;
}

/** A rect around a centred single line of text. */
function centredText(x: number, y: number, text: string, size: number, em: number): Rect {
  const w = text.length * size * em;
  return { x: x - w / 2, y: y - size, w, h: size * 1.35 };
}

/** The box an element occupies on the board, in canvas units. */
export function bboxOf(el: Element): Rect {
  switch (el.kind) {
    case 'title': {
      const head = centredText(el.x, el.y, el.text, 44, EM_SANS);
      if (!el.sub) return head;
      return union(head, centredText(el.x, el.y + 38, el.sub, 19, EM_SANS));
    }
    case 'text':
      return centredText(el.x, el.y, el.text, el.size ?? 20, EM_SANS);
    case 'formula':
      return centredText(el.x, el.y, el.text, 24, EM_MONO);
    case 'note':
      return { x: el.x, y: el.y, w: el.w, h: noteBoxHeight(el.text, el.w) };
    case 'box':
    case 'image':
    case 'diagram':
    case 'model3d':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'doc':
      // The label sits below the page and is part of the element.
      return { x: el.x, y: el.y, w: el.w, h: el.h + (el.label ? 26 : 0) };
    case 'arrow':
      return fromPoints([el.from, el.to]);
    case 'pen':
      return fromPoints(el.points);
  }
}

function fromPoints(points: readonly { x: number; y: number }[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * Grow a rect to `aspect` (w/h) about its own centre. The renderer letterboxes
 * whatever it is given, so handing it a frame that already matches the screen
 * is the difference between a board that fills the phone and one that floats
 * in two grey bands.
 */
function toAspect(rect: Rect, aspect: number): Rect {
  const current = rect.w / rect.h;
  if (!Number.isFinite(aspect) || aspect <= 0) return rect;
  if (Math.abs(current - aspect) < 0.001) return rect;
  if (current < aspect) {
    const w = rect.h * aspect;
    return { x: rect.x - (w - rect.w) / 2, y: rect.y, w, h: rect.h };
  }
  const h = rect.w / aspect;
  return { x: rect.x, y: rect.y - (h - rect.h) / 2, w: rect.w, h };
}

/**
 * Slide a rect back inside the board without shrinking it.
 *
 * A frame wider than the board is allowed to stay wider — clamping it would
 * change its aspect, and the renderer letterboxing a too-wide frame is a much
 * gentler failure than a board that squashes.
 */
function clampInto(rect: Rect, board: Rect): Rect {
  const x = rect.w >= board.w ? board.x - (rect.w - board.w) / 2 : clamp(rect.x, 0, board.w - rect.w);
  const y = rect.h >= board.h ? board.y - (rect.h - board.h) / 2 : clamp(rect.y, 0, board.h - rect.h);
  return { x, y, w: rect.w, h: rect.h };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

/**
 * The viewBox for this moment.
 *
 * @param focus   the beat's focused ids — the beat is *about* these
 * @param visible the beat's full element set, the fallback when nothing is focused
 * @param aspect  the renderer's w/h, so the frame comes back pre-shaped to the
 *                screen. Omitted (in a test, or before the first measure) it
 *                stays at the content's own shape.
 * @param minW    a floor on the frame's width, in canvas units. The renderer
 *                derives it from its real pixel width so that one canvas unit
 *                never exceeds a sane number of screen pixels — the zoom that
 *                rescues a phone would print banner text on a desktop.
 */
export function computeFrame(
  lesson: Lesson,
  visible: readonly string[],
  focus: readonly string[],
  aspect?: number,
  minW?: number,
): Rect {
  const board: Rect = { x: 0, y: 0, w: lesson.canvas.w, h: lesson.canvas.h };
  const shape = (r: Rect): Rect => clampInto(aspect ? toAspect(r, aspect) : r, board);

  const wanted = new Set(focus.length > 0 ? focus : visible);
  const boxes = lesson.elements.filter((el) => wanted.has(el.id)).map(bboxOf);
  if (boxes.length === 0) return shape(board);

  let frame = boxes.reduce(union);

  const pad = Math.max(frame.w, frame.h) * PAD;
  frame = { x: frame.x - pad, y: frame.y - pad, w: frame.w + pad * 2, h: frame.h + pad * 2 };

  // A lone arrow or a two-word label would otherwise zoom to a wall of text.
  const min = { w: board.w / MAX_ZOOM, h: board.h / MAX_ZOOM };
  if (frame.w < min.w) frame = { ...frame, x: frame.x - (min.w - frame.w) / 2, w: min.w };
  if (frame.h < min.h) frame = { ...frame, y: frame.y - (min.h - frame.h) / 2, h: min.h };

  // The renderer's pixel floor, grown about the centre with the shape kept.
  if (minW && frame.w < minW) {
    const scale = minW / frame.w;
    frame = {
      x: frame.x - (frame.w * (scale - 1)) / 2,
      y: frame.y - (frame.h * (scale - 1)) / 2,
      w: frame.w * scale,
      h: frame.h * scale,
    };
  }

  return shape(frame);
}
