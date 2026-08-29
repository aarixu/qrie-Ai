import {
  boxOf,
  flowHeight,
  noteBoxHeight,
  union,
  CANVAS_H,
  CANVAS_W,
  type Lesson,
  type Rect,
} from '@ai-tutor/lesson-format';

/**
 * WHERE THE CAMERA POINTS.
 *
 * A lesson is authored on a board a thousand units wide, but a phone is 390px
 * wide. Fitting the whole board into that gives a scale of 0.39 — which renders
 * a note's 14.5px text at 5.7px. The content was always there; it was sub-pixel.
 *
 * So the board is not shown whole. Each beat is framed on what it is actually
 * teaching: every element the beat has on the board.
 *
 * Pure geometry, no DOM — the renderer asks where to point and does as it is
 * told, exactly like every other decision in this package.
 */

/**
 * Element geometry moved to `@ai-tutor/lesson-format`, so the layout engine can
 * see the same boxes this camera does. It used to live only here, which meant
 * layout could put two things on top of each other and nothing in the system
 * was able to notice. Re-exported because `Scene` asks this package for it.
 */
export { boxOf as bboxOf, flowHeight, noteBoxHeight, type Rect };
export { FLOW_STEP_H, FLOW_GAP } from '@ai-tutor/lesson-format';

/**
 * The board never zooms past this. Past ~3x a single small element fills the
 * screen with no surroundings, and a diagram with no context is not a diagram.
 */
const MAX_ZOOM = 3;

/** Breathing room around the framed content, as a fraction of the frame's larger side. */
const PAD = 0.09;

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

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

/**
 * Slide a rect back inside the board without shrinking it.
 *
 * A frame wider than the board is allowed to stay wider — clamping it would
 * change its aspect, and the renderer letterboxing a too-wide frame is a much
 * gentler failure than a board that squashes.
 */
function clampInto(rect: Rect, board: Rect): Rect {
  const x =
    rect.w >= board.w ? board.x - (rect.w - board.w) / 2 : clamp(rect.x, 0, board.w - rect.w);
  const y =
    rect.h >= board.h ? board.y - (rect.h - board.h) / 2 : clamp(rect.y, 0, board.h - rect.h);
  return { x, y, w: rect.w, h: rect.h };
}

/**
 * The viewBox for this moment.
 *
 * @param visible the beat's full element set — this is what gets framed
 * @param _focus  kept so every caller keeps passing the beat's focus, for when
 *                a beat gains an explicit zoom. Emphasis is not a camera
 *                decision: framing the focus alone once cut a note in half
 *                while the tutor was talking about it.
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
  _focus: readonly string[],
  aspect?: number,
  minW?: number,
): Rect {
  const board: Rect = { x: 0, y: 0, w: lesson.canvas.w, h: lesson.canvas.h };
  const shape = (r: Rect): Rect => clampInto(aspect ? toAspect(r, aspect) : r, board);

  const wanted = new Set(visible);
  const boxes = lesson.elements.filter((el) => wanted.has(el.id)).map(boxOf);
  if (boxes.length === 0) return shape(board);

  let frame = boxes.reduce(union);

  const pad = Math.max(frame.w, frame.h) * PAD;
  frame = { x: frame.x - pad, y: frame.y - pad, w: frame.w + pad * 2, h: frame.h + pad * 2 };

  // A lone arrow or a two-word label would otherwise zoom to a wall of text.
  // The floor is one PAGE over MAX_ZOOM, not the whole board: an endless board
  // grows to the right, and a floor that grew with it would eventually forbid
  // the camera from framing any single page at all.
  const min = { w: CANVAS_W / MAX_ZOOM, h: CANVAS_H / MAX_ZOOM };
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
