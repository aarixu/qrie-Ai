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

describe('reduced motion', () => {
  it('covers every class the toolkit animates with', () => {
    const page = renderToString(<Scene lesson={lessonOf(tool('pieChart', air))} visible={['t1']} focus={[]} />);
    for (const cls of ['stage-pop', 'stage-draw', 'stage-grow', 'stage-move']) {
      expect(reducedBlock(page)).toContain(`.${cls}`);
    }
  });
});
