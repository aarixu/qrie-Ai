import type { Element } from './types';

/**
 * HOW BIG IS THIS ELEMENT.
 *
 * A property of the element, so it lives with the element. It used to live only
 * in the renderer's camera, where the layout engine could not see it — which
 * meant layout could place two things on top of each other and nothing in the
 * system was able to notice.
 *
 * Pure, and with no DOM: the same answer on a server, in a test and in a
 * browser. Two different answers would frame a note that is not the size it
 * renders at, or let a solver believe an overlap it cannot see.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Advance-width estimates, in ems. Text has no measurable width without a DOM,
 * so it is estimated — generously. An over-wide estimate spaces things slightly
 * far apart; an under-wide one lets two labels touch, which is much worse.
 */
const EM_SANS = 0.58;
const EM_MONO = 0.62;

/**
 * Mirrors the renderer's note layout: the card wraps at roughly this many
 * characters and every wrapped line is 21 units tall, over a 60-unit allowance
 * for padding.
 */
export function noteBoxHeight(text: string, w: number): number {
  const charsPerLine = Math.max(6, Math.floor((w - 26) / 7));
  return Math.ceil(text.length / charsPerLine) * 21 + 60;
}

/** One step's box in a flow, and the gap to the next. */
export const FLOW_STEP_H = 118;
export const FLOW_GAP = 40;

/** How tall a flow is, from its step count alone. */
export function flowHeight(steps: number, direction: 'row' | 'column' = 'row'): number {
  if (steps <= 0) return 0;
  if (direction === 'row') return FLOW_STEP_H;
  return steps * FLOW_STEP_H + (steps - 1) * FLOW_GAP;
}

/** How wide one line of text will be drawn at this size. */
export function textWidth(text: string, size: number, mono = false): number {
  return text.length * size * (mono ? EM_MONO : EM_SANS);
}

/**
 * The largest size at which this text still fits the width it is given.
 *
 * Anything that can be longer than its container must ASK rather than hope. A
 * card's body line spilled into the neighbouring card, and a connector's label
 * was written across both pictures it ran between — the same mistake twice,
 * because two different places each guessed.
 *
 * Never returns less than `min`: past that the text is unreadable, and text
 * nobody can read is not a smaller problem than text that overlaps.
 */
export function fitText(
  text: string,
  maxWidth: number,
  preferred: number,
  min = 12,
  mono = false,
): number {
  if (text.length === 0 || maxWidth <= 0) return preferred;
  const em = mono ? EM_MONO : EM_SANS;
  return Math.max(min, Math.min(preferred, maxWidth / (text.length * em)));
}

/**
 * How big a graphic's label is written, and therefore how wide it is.
 *
 * One function, used by the renderer that draws the label, the camera that
 * frames it and the layout that spaces neighbours around it. Three separate
 * guesses is how two icons ended up standing politely apart while their labels
 * lay printed across each other.
 *
 * Capped at 1.8x the icon's width: past that the label dominates the picture
 * it names, and a long name should shrink rather than shout.
 */
export function graphicLabelSize(iconW: number, label: string): number {
  return fitText(label, iconW * 1.8, 26, 14);
}

/** A rect around a centred single line of text. */
function centredText(x: number, y: number, text: string, size: number, em: number): Rect {
  const w = text.length * size * em;
  return { x: x - w / 2, y: y - size, w, h: size * 1.35 };
}

function fromPoints(points: readonly { x: number; y: number }[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Do these two boxes share any area? Touching edges do not count. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The box an element occupies on the board, in canvas units. */
export function boxOf(el: Element): Rect {
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
    case 'handwrite':
      return centredText(el.x, el.y, el.text, el.size ?? 26, EM_SANS);
    case 'note':
      return { x: el.x, y: el.y, w: el.w, h: noteBoxHeight(el.text, el.w) };
    case 'box':
    case 'image':
    case 'diagram':
    case 'chart':
    case 'mark':
    case 'model3d':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    // A graphic's label hangs below its box and is part of the element: the
    // camera has to know about it, and so does anything trying not to sit on
    // it. The label is usually WIDER than the icon — "Overhead Tank (Roof)"
    // under a small picture — and a box that ignored that let other labels be
    // pushed onto it by a solver that could not see it was there.
    case 'graphic': {
      const labelW = el.label ? textWidth(el.label, graphicLabelSize(el.w, el.label)) : 0;
      const w = Math.max(el.w, labelW);
      return {
        x: el.x + el.w / 2 - w / 2,
        y: el.y,
        w,
        h: el.h + (el.label ? 34 : 0),
      };
    }
    case 'doc':
      return { x: el.x, y: el.y, w: el.w, h: el.h + (el.label ? 26 : 0) };
    case 'flow':
      return { x: el.x, y: el.y, w: el.w, h: flowHeight(el.steps.length, el.direction) };
    case 'arrow':
      return fromPoints([el.from, el.to]);
    case 'pen':
      return fromPoints(el.points);
  }
}
