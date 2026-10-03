import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';
import { renderTool } from '../src/tools';

const THEME = {
  ink: '#3c3c3c',
  tones: { neutral: '#4b4b4b', good: '#58cc02', bad: '#ff4b4b', accent: '#1cb0f6' },
  fontHand: 'sans-serif',
  fontMono: 'monospace',
};

const tool = (name: string, params: Record<string, unknown>): Extract<Element, { kind: 'tool' }> => ({
  kind: 'tool', id: 't1', x: 100, y: 100, w: 480, h: 300, tool: name, params,
});

const lessonOf = (el: Element): Lesson => ({
  formatVersion: 1, id: 'l', title: 'L', language: 'en', canvas: { w: 1000, h: 620 },
  elements: [el], beats: [{ id: 'b', topic: 't', narration: 'n', show: [el.id] }],
});

const air = { slices: [{ label: 'Nitrogen', value: 78 }, { label: 'Oxygen', value: 21 }, { label: 'Other', value: 1 }], percent: true, caption: 'Air' };
const html = (node: ReactElement) => renderToString(node);

/** The rules inside `@media (prefers-reduced-motion: reduce) { … }` of the rendered style. */
const reducedBlock = (page: string): string => {
  const at = page.indexOf('@media (prefers-reduced-motion: reduce)');
  return page.slice(at, page.indexOf('</style>', at));
};

describe('pieChart on the board', () => {
  it('draws a slice and a label per part, in order, when new', () => {
    const out = html(<>{renderTool(tool('pieChart', air), { isNew: true, theme: THEME })}</>);
    expect(out.match(/<path/g)).toHaveLength(3);
    expect(out).toContain('Nitrogen · 78%');
    const delays = [...out.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(Math.max(...delays)).toBeLessThanOrEqual(300 + 3 * 450);
  });

  it('draws complete and still when it was already there', () => {
    const out = html(<>{renderTool(tool('pieChart', air), { isNew: false, theme: THEME })}</>);
    expect(out).not.toMatch(/stage-pop|animation-delay/);
    expect(out.match(/<path/g)).toHaveLength(3);
  });

  it('keeps its box and says its name when its params are wrong', () => {
    const out = html(<>{renderTool(tool('pieChart', { slices: [] }), { isNew: true, theme: THEME })}</>);
    expect(out).toContain('stroke-dasharray="7 6"');
    expect(out).toContain('pieChart');
  });

  it('does not pop as a whole inside a Scene — its slices do', () => {
    const page = renderToString(<Scene lesson={lessonOf(tool('pieChart', air))} visible={['t1']} focus={[]} />);
    const group = page.slice(page.indexOf('data-element-id="t1"'));
    expect(group.indexOf('class="stage-pop"')).toBeGreaterThan(group.indexOf('<path'));
  });
});

const day = {
  labels: ['6 am', '9 am', '12 pm', '3 pm', '6 pm'],
  series: [{ name: 'Delhi', values: [24, 29, 35, 36, 31] }],
  yLabel: 'temperature',
  unit: '°C',
  caption: 'One summer day',
};

describe('lineChart on the board', () => {
  it('draws the line on after its axes, then its points, then its last value', () => {
    const out = html(<>{renderTool(tool('lineChart', day), { isNew: true, theme: THEME })}</>);
    expect(out).toMatch(/class="stage-draw"[^>]*style="animation-delay:600ms"/);
    expect(out.match(/<circle/g)).toHaveLength(5);
    expect(out).toContain('31 °C');
    for (const label of day.labels) expect(out).toContain(label);
  });

  it('draws two series in two colours', () => {
    const two = { ...day, series: [day.series[0], { name: 'Shimla', values: [12, 16, 20, 21, 17] }] };
    const out = html(<>{renderTool(tool('lineChart', two), { isNew: false, theme: THEME })}</>);
    expect(out).toContain('stroke="#1cb0f6"');
    expect(out).toContain('stroke="#ff9600"');
    expect(out).toContain('Shimla');
  });

  it('never divides by a flat line', () => {
    const flat = { ...day, series: [{ name: 'Same', values: [5, 5, 5, 5, 5] }] };
    expect(html(<>{renderTool(tool('lineChart', flat), { isNew: false, theme: THEME })}</>)).not.toContain('NaN');
  });
});

describe('equationMove on the board', () => {
  const steps = ['2x + 3 = 11', '2x = 11 - 3', '2x = 8'];

  it('slides a term across "=" from where it was, a step later', () => {
    const out = html(<>{renderTool(tool('equationMove', { steps }), { isNew: true, theme: THEME })}</>);
    // The "3" of line 1 crosses to line 2 as "− 3": a move that starts at 1400 ms.
    expect(out).toMatch(/class="stage-move"[^>]*style="--dx:[-\d.]+px;--dy:-56\.0px;animation-delay:1400ms"[^>]*>[^<]*− 3/);
    expect(out.match(/stage-move/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('writes every line plainly when it was already there', () => {
    const out = html(<>{renderTool(tool('equationMove', { steps }), { isNew: false, theme: THEME })}</>);
    expect(out).not.toMatch(/stage-move|stage-pop/);
    // Each term is its own <text>: "11" and " − 3" sit side by side.
    expect(out).toContain('>11<');
    expect(out).toContain('> − 3<');
  });

  it('writes a line it cannot split in place, and goes on', () => {
    // An unclosed bracket: one "=", so the spec accepts it, but termsOf cannot split it.
    const odd = { steps: ['(x + 1 = 2', 'x = 1'] };
    const out = html(<>{renderTool(tool('equationMove', odd), { isNew: true, theme: THEME })}</>);
    expect(out).toContain('(x + 1 = 2');
    expect(out).not.toContain('NaN');
  });
});

describe('reduced motion', () => {
  it('covers every class the toolkit animates with', () => {
    const page = renderToString(<Scene lesson={lessonOf(tool('pieChart', air))} visible={['t1']} focus={[]} />);
    for (const cls of ['stage-pop', 'stage-draw', 'stage-grow', 'stage-move']) {
      expect(reducedBlock(page)).toContain(`.${cls}`);
    }
  });
});
