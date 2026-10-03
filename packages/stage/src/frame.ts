import {
  boxOf,
  flowHeight,
  noteBoxHeight,
  splitPartRef,
  union,
  CANVAS_H,
  CANVAS_W,
  PAGE_STRIDE,
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

/**
 * One canvas unit never renders wider than this many CSS pixels. The zoom that
 * makes a note readable on a phone would set banner text on a desktop — past
 * this density the camera simply stops coming closer. (The keep gate's
 * phone-readable rule reads it too.)
 */
export const MAX_UNIT_PX = 1.6;

/** Breathing room around the framed content, as a fraction of the frame's larger side. */
const PAD = 0.09;

/**
 * The most board the camera will ever show at once: one page.
 *
 * Not a comfort setting — it is what stops the board from paying for its own
 * length. Past one page the writing is smaller than it was authored to be, and
 * the fix for "there is more to show" is to move, not to widen.
 */
const WINDOW = { w: CANVAS_W, h: CANVAS_H };

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
  // From the board's own origin. The old form clamped into [0, w] because the
  // one board there was began at zero — a PAGE of an endless board does not,
  // and clamping a page-2 frame into page 0's range dragged the camera three
  // pages left of the thing it was framing.
  const x =
    rect.w >= board.w
      ? board.x - (rect.w - board.w) / 2
      : clamp(rect.x, board.x, board.x + board.w - rect.w);
  const y =
    rect.h >= board.h
      ? board.y - (rect.h - board.h) / 2
      : clamp(rect.y, board.y, board.y + board.h - rect.h);
  return { x, y, w: rect.w, h: rect.h };
}

/**
 * The box of the picture part she is pointing at — but only when that
 * picture is the newest thing in the frame. Then nothing she has written
 * is newer, and zooming cannot cut a note in half (the reason the camera
 * otherwise ignores focus). Only an `image` part has a box in the lesson
 * (fractions of the picture); a diagram's parts are ids inside its SVG, so
 * they light and dim as before and never zoom.
 */
function pointedPart(lesson: Lesson, visible: readonly string[], focus: readonly string[]): Rect | null {
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  const newest = [...visible].reverse().map((id) => byId.get(id)).find((el) => el !== undefined);
  if (!newest || newest.kind !== 'image' || !newest.parts) return null;
  for (const ref of focus) {
    const { elementId, part } = splitPartRef(ref);
    if (elementId !== newest.id || part === null) continue;
    const p = newest.parts.find((q) => q.name === part);
    if (p) return { x: newest.x + p.x * newest.w, y: newest.y + p.y * newest.h, w: p.w * newest.w, h: p.h * newest.h };
  }
  return null;
}

/**
 * The viewBox for this moment.
 *
 * @param visible the beat's full element set — this is what gets framed
 * @param focus   the beat's focus: a picture part named here is zoomed to when
 *                that picture is the newest ink (see pointedPart); everything
 *                else in focus is emphasis, not a camera decision — framing the
 *                focus alone once cut a note in half while the tutor was
 *                talking about it.
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
  const shape = (r: Rect, within: Rect = board): Rect =>
    clampInto(aspect ? toAspect(r, aspect) : r, within);

  /**
   * In the order they were DRAWN, so the last one is what she is working on
   * now. Reading them off `lesson.elements` instead sorted them by however the
   * lesson was written, which is not the same thing and is not what a camera
   * follows.
   */
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  const boxes = visible
    .map((id) => byId.get(id))
    .filter((el): el is NonNullable<typeof el> => el !== undefined)
    .map(boxOf);
  if (boxes.length === 0) return shape(board);

  const part = pointedPart(lesson, visible, focus);
  if (part) {
    const pad = Math.max(part.w, part.h) * 0.25;
    let zoom: Rect = { x: part.x - pad, y: part.y - pad, w: part.w + pad * 2, h: part.h + pad * 2 };
    const least = { w: CANVAS_W / MAX_ZOOM, h: CANVAS_H / MAX_ZOOM };
    if (zoom.w < least.w) zoom = { ...zoom, x: zoom.x - (least.w - zoom.w) / 2, w: least.w };
    if (zoom.h < least.h) zoom = { ...zoom, y: zoom.y - (least.h - zoom.h) / 2, h: least.h };
    if (minW && zoom.w < minW) {
      const scale = minW / zoom.w;
      zoom = { x: zoom.x - (zoom.w * (scale - 1)) / 2, y: zoom.y - (zoom.h * (scale - 1)) / 2, w: zoom.w * scale, h: zoom.h * scale };
    }
    const page = Math.floor((part.x + part.w / 2) / PAGE_STRIDE);
    return shape(zoom, { x: page * PAGE_STRIDE, y: 0, w: Math.min(CANVAS_W, board.w), h: board.h });
  }

  /**
   * THE CAMERA SCROLLS; IT DOES NOT ZOOM OUT.
   *
   * The board is endless, so there is always somewhere to put the next thing —
   * which means there is never a reason to make the last thing smaller. This
   * used to be `boxes.reduce(union)`: a frame that grew to hold everything it
   * was given, so a fuller board simply rendered at a smaller scale until the
   * writing was unreadable. Three pages of work came back as a frame 3327
   * units wide, every word at a third of its size.
   *
   * So the frame is built from the NEWEST backwards, taking as much of what
   * came before as fits the window and no more. What does not fit is not
   * shrunk — it is off to the side, and going back to it is a scroll, which is
   * what an endless board is for.
   */
  const anchor = boxes[boxes.length - 1];
  let frame = anchor;
  for (let i = boxes.length - 2; i >= 0; i -= 1) {
    const grown = union(frame, boxes[i]);
    if (grown.w > WINDOW.w || grown.h > WINDOW.h) break;
    frame = grown;
  }

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

  // Padding and the floors above can push past the window; the window wins,
  // and it stays over what she is drawing now.
  if (frame.w > WINDOW.w) {
    frame = { ...frame, x: anchor.x + anchor.w / 2 - WINDOW.w / 2, w: WINDOW.w };
  }
  if (frame.h > WINDOW.h) {
    frame = { ...frame, y: anchor.y + anchor.h / 2 - WINDOW.h / 2, h: WINDOW.h };
  }

  /**
   * And it never leaves the PAGE she is working on.
   *
   * Centred on the newest thing alone, the window followed a short wrapped
   * line to the left edge of its page and slid into the empty gutter between
   * pages — a student saw blank board on the left and the title cut off on
   * the right. A page is the unit of attention: the window moves along the
   * board page by page, and frames the gap between two pages never.
   */
  const page = Math.floor((anchor.x + anchor.w / 2) / PAGE_STRIDE);
  const pageRect: Rect = {
    x: page * PAGE_STRIDE,
    y: 0,
    w: Math.min(CANVAS_W, board.w),
    h: board.h,
  };
  return shape(frame, pageRect);
}
