import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';

const lessonOf = (els: Element[]): Lesson => ({
  formatVersion: 1,
  id: 'l',
  title: 'L',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: els,
  beats: [{ id: 'b', topic: 't', narration: 'n', show: els.map((e) => e.id) }],
});
const draw = (els: Element[]) => renderToString(<Scene lesson={lessonOf(els)} visible={els.map((e) => e.id)} focus={[]} />);
const GREEN = '#2f9e44';

describe('ink on the board', () => {
  it('colours a name in its part’s colour', () => {
    expect(draw([{ kind: 'handwrite', id: 'h', x: 100, y: 100, text: 'Lacteal', ink: 'green' }])).toMatch(
      new RegExp(`fill="${GREEN}"[^<]*>Lacteal<`),
    );
  });

  it('colours a line and its head', () => {
    const out = draw([{ kind: 'arrow', id: 'a', from: { x: 150, y: 100 }, to: { x: 300, y: 200 }, ink: 'green' }]);
    expect(out).toMatch(new RegExp(`<line[^>]*stroke="${GREEN}"`));
    expect(out).toContain('url(#stage-arrow-ink-green)');
    expect(out).toContain('id="stage-arrow-ink-green"');
  });

  it('colours a mark', () => {
    const out = draw([{ kind: 'mark', id: 'm', x: 280, y: 180, w: 40, h: 40, shape: 'circle', ink: 'green' }]);
    expect(out).toMatch(new RegExp(`<path d="M[^"]*"[^>]*stroke="${GREEN}"`));
  });

  it('colours a notes item’s number and term, and leaves the others', () => {
    const out = draw([
      {
        kind: 'list',
        id: 'l',
        x: 100,
        y: 100,
        w: 400,
        items: [
          { term: 'Lacteal', meaning: 'takes fats', ink: 'green' },
          { term: 'Vein', meaning: 'takes blood back' },
        ],
      },
    ]);
    expect(out).toContain(`<tspan fill="${GREEN}" font-weight="700">1. </tspan>`);
    expect(out).toContain(`<tspan font-weight="700" fill="${GREEN}">Lacteal</tspan>`);
    expect(out).toContain('<tspan font-weight="700">Vein</tspan>');
  });

  it('leaves an element without ink in its tone', () => {
    const out = draw([{ kind: 'handwrite', id: 'h', x: 100, y: 100, text: 'Villi' }]);
    expect(out).not.toMatch(new RegExp(`fill="${GREEN}"[^<]*>Villi<`));
  });
});
