import { describe, expect, it } from 'vitest';
import { boxOf, CANVAS_H, CANVAS_W, type Element, type Lesson, type Rect } from '@ai-tutor/lesson-format';
import { computeFrame } from '../src/frame';

/**
 * A TITLE IS SHOWN WHOLE, OR NOT AT ALL (small intestine, 2026-10-07).
 *
 * Zoomed onto a scene under it, the camera's frame — padded and shaped to the
 * 16:9 stage — reached up into the header and cut the long title at both
 * edges: "hemical Digestion in Small Intestin". And a first line that wrote
 * only the title zoomed onto it alone: a huge title on an empty board.
 */

const title: Element = { kind: 'title', id: 't', x: 500, y: 72, text: 'Chemical Digestion in the Small Intestine' };
const crumb: Element = { kind: 'text', id: 'c', x: 500, y: 20, text: 'Life Processes › Digestion', size: 20 };
const icon = (id: string, x: number, y: number): Element => ({ kind: 'box', id, x, y, w: 90, h: 90, label: id });

const lesson = (elements: Element[]): Lesson => ({
  formatVersion: 1,
  id: 'c',
  title: 'Camera',
  language: 'en',
  canvas: { w: CANVAS_W, h: CANVAS_H },
  elements,
  beats: [{ id: 'b', topic: 't', narration: 'n', show: elements.map((e) => e.id) }],
});

const cuts = (r: Rect, f: Rect): boolean => {
  const meets = r.x < f.x + f.w && f.x < r.x + r.w && r.y < f.y + f.h && f.y < r.y + r.h;
  const inside = r.x >= f.x - 0.5 && r.y >= f.y - 0.5 && r.x + r.w <= f.x + f.w + 0.5 && r.y + r.h <= f.y + f.h + 0.5;
  return meets && !inside;
};

describe('the camera and a page title', () => {
  it('never cuts the title when it frames what is under it', () => {
    const l = lesson([crumb, title, icon('liver', 280, 110), icon('pancreas', 560, 110)]);
    const frame = computeFrame(l, ['liver', 'pancreas'], [], 16 / 9, 737);
    expect(cuts(boxOf(title), frame)).toBe(false);
    // And what it framed is still on screen.
    for (const id of ['liver', 'pancreas']) expect(cuts(boxOf(l.elements.find((e) => e.id === id)!), frame)).toBe(false);
  });

  it('never cuts a diagram on the board when it frames the key point under it (human heart, 2026-10-07)', () => {
    const diagram: Element = { kind: 'diagram', id: 'loops', x: 150, y: 110, w: 700, h: 300, src: 'x.svg', alt: 'loops', parts: [] };
    const point: Element = { kind: 'handwrite', id: 'kp', x: 500, y: 470, text: 'Pulmonary loop: right ventricle to lungs', size: 22 };
    const l = lesson([crumb, title, diagram, point]);
    const frame = computeFrame(l, ['kp'], [], 16 / 9, 737, ['c', 't', 'loops', 'kp']);
    expect(cuts(boxOf(diagram), frame)).toBe(false);
    expect(cuts(boxOf(point), frame)).toBe(false);
  });

  it('frames the page, not the title alone, on a line that has written only the title', () => {
    const l = lesson([crumb, title]);
    const frame = computeFrame(l, ['c', 't'], [], 16 / 9);
    expect(frame.w).toBeGreaterThanOrEqual(CANVAS_W);
  });
});
