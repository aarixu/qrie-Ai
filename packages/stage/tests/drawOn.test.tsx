import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';
import { DRAW_ON_LIMIT, drawOnMarkup } from '../src/drawOn';

describe('drawOnMarkup', () => {
  it('marks every shape to be drawn, and its fill to follow', () => {
    const out = drawOnMarkup('<path d="M0 0 L9 9"/><circle cx="5" cy="5" r="3" fill="#f00"/>')!;
    expect(out).toBe(
      '<path d="M0 0 L9 9" class="stage-ink stage-ink-fill" pathLength="1"/>' +
        '<circle cx="5" cy="5" r="3" fill="#f00" class="stage-ink stage-ink-fill" pathLength="1"/>',
    );
  });

  it('keeps the class a shape already has', () => {
    expect(drawOnMarkup('<rect class="wall" width="4" height="4"/>')).toBe(
      '<rect class="stage-ink stage-ink-fill wall" width="4" height="4" pathLength="1"/>',
    );
  });

  it('leaves alone what it would spoil', () => {
    const dashed = '<line x1="0" y1="0" x2="9" y2="0" stroke-dasharray="4 4"/>';
    const moving = '<path class="curie-flow" d="M0 0 L9 0"/>';
    const faint = '<rect width="4" height="4" fill-opacity="0.3"/>';
    expect(drawOnMarkup(dashed)).toBe(dashed);
    expect(drawOnMarkup(moving)).toBe(moving);
    expect(drawOnMarkup(faint)).toBe('<rect width="4" height="4" fill-opacity="0.3" class="stage-ink" pathLength="1"/>');
  });

  it('gives up on a drawing too busy to draw on a phone', () => {
    expect(drawOnMarkup('<path d="M0 0"/>'.repeat(DRAW_ON_LIMIT + 1))).toBeNull();
  });
});

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="cell"><circle cx="50" cy="50" r="40"/></g></svg>';
const lesson: Lesson = {
  formatVersion: 1, id: 'd', title: 'D', language: 'en', canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'diagram', id: 'd1', x: 100, y: 100, w: 400, h: 400, src: 'd1.svg', alt: 'a cell', parts: ['cell'] }],
  beats: [{ id: 'b', topic: 't', narration: 'n', show: ['d1'] }],
};

describe('a diagram on the board', () => {
  it('draws on when it is new', () => {
    const page = renderToString(<Scene lesson={lesson} visible={['d1']} focus={[]} assets={{ d1: svg }} />);
    expect(page).toContain('class="stage-ink stage-ink-fill"');
    const reduced = page.slice(page.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.stage-ink');
  });
});
