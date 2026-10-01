import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';

/** C3: the graph on the board is the one its formula makes. */
const boardWith = (fn: string, from: number, to: number) => {
  const lesson: Lesson = {
    formatVersion: 1,
    id: 'p',
    title: 'Graph',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [{ kind: 'plot', id: 'g', x: 100, y: 150, w: 500, h: 300, fn, from, to, caption: 'A graph', xLabel: 'x', yLabel: 'y' }],
    beats: [{ id: 'b', topic: 't', narration: 'n', show: ['g'] }],
  };
  return renderToString(<Scene lesson={lesson} visible={['g']} focus={[]} />);
};

/** The curve's points, in board units, from the path the renderer drew. */
const curve = (html: string): { x: number; y: number }[] => {
  const d = [...html.matchAll(/<path[^>]*d="([^"]+)"[^>]*clip-path=/g)].map((m) => m[1])[0] ?? '';
  return [...d.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
};

describe('a line of working that waits for the one above it', () => {
  it('pops in after its delay, and the first line at once', () => {
    const lesson: Lesson = {
      formatVersion: 1,
      id: 'd',
      title: 'Working',
      language: 'en',
      canvas: { w: 1000, h: 620 },
      elements: [
        { kind: 'formula', id: 'w0', x: 500, y: 200, text: '2x = 8' },
        { kind: 'formula', id: 'w1', x: 500, y: 244, text: 'x = 4', after: 1400 },
      ],
      beats: [{ id: 'b', topic: 't', narration: 'n', show: ['w0', 'w1'] }],
    };
    const html = renderToString(<Scene lesson={lesson} visible={['w0', 'w1']} focus={[]} />);
    // On the second line's group only (the stylesheet Scene embeds names the property too).
    expect(html.match(/style="animation-delay:[^"]*"/g)).toEqual(['style="animation-delay:1400ms"']);
  });
});

describe('a plot on the board', () => {
  it('draws a straight line for 2x + 1, rising left to right', () => {
    const pts = curve(boardWith('2x + 1', 0, 5));
    expect(pts.length).toBeGreaterThan(100);
    const first = pts[0];
    const last = pts[pts.length - 1];
    expect(last.x).toBeGreaterThan(first.x);
    expect(last.y).toBeLessThan(first.y);
    const mid = pts[Math.floor(pts.length / 2)];
    // On the straight line between its ends.
    expect(Math.abs(mid.y - (first.y + last.y) / 2)).toBeLessThan(1.5);
  });

  it('draws a parabola with its lowest point in the middle for x^2 - 4', () => {
    const pts = curve(boardWith('x^2 - 4', -3, 3));
    const lowest = pts.reduce((a, b) => (b.y > a.y ? b : a));
    const span = pts[pts.length - 1].x - pts[0].x;
    expect(Math.abs(lowest.x - (pts[0].x + span / 2))).toBeLessThan(span * 0.02);
  });

  it('leaves a gap where the formula has no value, rather than a spike', () => {
    // 1/x at x = 0, the middle sample of [-2, 2]: two pieces, not one joined through infinity.
    const html = boardWith('1/x', -2, 2);
    const d = [...html.matchAll(/<path[^>]*d="([^"]+)"[^>]*clip-path=/g)].map((m) => m[1])[0] ?? '';
    expect(d.match(/M /g)).toHaveLength(2);
    expect(curve(html).every((p) => Number.isFinite(p.y))).toBe(true);
  });

  it('writes its caption and axis names', () => {
    const html = boardWith('2x + 1', 0, 5);
    expect(html).toContain('A graph');
    expect(html).toMatch(/>x</);
    expect(html).toMatch(/>y</);
  });
});
