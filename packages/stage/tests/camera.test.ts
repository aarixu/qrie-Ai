import { describe, expect, it } from 'vitest';
import { CANVAS_H, CANVAS_W, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { computeFrame } from '../src/frame';

/**
 * THE CAMERA SCROLLS. IT DOES NOT ZOOM OUT.
 *
 * The board is endless, so there is always somewhere to put the next thing —
 * which means there is never a reason to make the last thing smaller. The
 * camera used to grow its frame to hold everything it was given, so a fuller
 * board simply rendered at a smaller scale until the writing was unreadable.
 *
 * The rule now: the window is a fixed size, and it MOVES. Anything that does
 * not fit is not shrunk, it is off to the side — and going back to it is a
 * scroll, which is what an endless board is for.
 */

const PAGE = 1260;

/** Boxes on an endless board, in the order they were drawn. */
const el = (id: string, x: number, y: number, w: number, h: number): Element => ({
  kind: 'box',
  id,
  x,
  y,
  w,
  h,
  label: id,
});

const lesson = (elements: Element[]): Lesson => ({
  formatVersion: 1,
  id: 'c',
  title: 'Camera',
  language: 'en',
  canvas: { w: PAGE * 3 + CANVAS_W, h: CANVAS_H },
  elements,
  beats: [{ id: 'b', topic: 't', narration: 'n', show: elements.map((e) => e.id) }],
});

describe('the window never grows past one page', () => {
  const across = lesson([
    el('first', 60, 200, 300, 200),
    el('second', PAGE + 60, 200, 300, 200),
    el('third', PAGE * 2 + 60, 200, 300, 200),
  ]);

  it('stays one page wide however much has been drawn', () => {
    const frame = computeFrame(across, ['first', 'second', 'third'], []);
    expect(frame.w).toBeLessThanOrEqual(CANVAS_W + 1);
  });

  it('shows the newest work, not an average of everything', () => {
    // Scrolled to where she is writing NOW. The first page is behind her.
    const frame = computeFrame(across, ['first', 'second', 'third'], []);
    expect(frame.x).toBeGreaterThan(PAGE);
  });

  it('scrolls back when an earlier page is asked for again', () => {
    const frame = computeFrame(across, ['first'], []);
    expect(frame.x).toBeLessThan(PAGE);
  });
});

describe('what it does on an ordinary page', () => {
  const one = lesson([
    el('title', 70, 60, 860, 70),
    el('picture', 300, 160, 400, 220),
    el('note', 70, 420, 860, 90),
  ]);

  it('frames the whole page when the page is what is being taught', () => {
    const frame = computeFrame(one, ['title', 'picture', 'note'], []);
    expect(frame.y).toBeLessThan(160);
    expect(frame.y + frame.h).toBeGreaterThan(420);
  });

  it('still refuses to zoom past three times on one small thing', () => {
    const frame = computeFrame(one, ['picture'], []);
    expect(frame.w).toBeGreaterThanOrEqual(CANVAS_W / 3 - 1);
  });

  it('never returns a frame taller than the board', () => {
    const frame = computeFrame(one, ['title', 'picture', 'note'], []);
    expect(frame.h).toBeLessThanOrEqual(CANVAS_H + 1);
  });
});

describe('the window stays on the page it is looking at', () => {
  /**
   * Seen live, on a real class: the newest thing on the page was a short
   * wrapped line at the LEFT edge, the window centred itself on it, and half
   * the window slid off the page into the empty gutter between pages — so the
   * student saw blank board on the left and the title cut off on the right.
   *
   * A page is the unit of attention. The window may move along the board, but
   * at any moment it frames ONE page, not the gap between two.
   */
  const page2 = PAGE * 2;
  const board = lesson([
    el('title2', page2 + 60, 60, 880, 70),
    el('figure2', page2 + 260, 160, 480, 240),
    // The newest thing: a short line at the far left, the anchor that used to
    // drag the window off the page.
    el('note2', page2 + 60, 430, 120, 40),
  ]);

  it('does not slide into the gutter when the newest thing sits at an edge', () => {
    const frame = computeFrame(board, ['title2', 'figure2', 'note2'], []);
    expect(frame.x).toBeGreaterThanOrEqual(page2 - 1);
    expect(frame.x + frame.w).toBeLessThanOrEqual(page2 + CANVAS_W + 1);
  });

  it('keeps the title inside the shot', () => {
    const frame = computeFrame(board, ['title2', 'figure2', 'note2'], []);
    expect(frame.x).toBeLessThanOrEqual(page2 + 60);
    expect(frame.x + frame.w).toBeGreaterThanOrEqual(page2 + 60 + 880);
  });
});
