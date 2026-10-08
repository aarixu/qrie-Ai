// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { CreditsList, creditsOf } from '../src/CreditsList';

/**
 * EVERY PICTURE FROM THE WEB, LISTED WITH ITS LINKS (review, 2026-10-08).
 *
 * CC BY and CC BY-SA ask for a link to the licence where that is reasonably
 * practicable; the credit written on a picture's foot has no room for one. So
 * the class lists every found picture under the board: who made it, its
 * licence as a link to its terms, and a link to where it came from.
 */

const credit = {
  author: 'A. Person',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  page: 'https://commons.wikimedia.org/wiki/File:Runner.jpg',
};

const lesson = (els: Element[]): Lesson => ({
  formatVersion: 1,
  id: 'c',
  title: 'C',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: els,
  beats: [{ id: 'b', topic: 't', narration: 'n', show: els.map((e) => e.id) }],
});

const runner = (id: string): Element => ({ kind: 'graphic', id, x: 0, y: 0, w: 120, h: 120, noun: 'runner', credit });
const heart: Element = {
  kind: 'image', id: 'h', x: 0, y: 0, w: 300, h: 200, src: 'generated/h.jpg', alt: 'a heart',
  credit: { license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Heart.jpg' },
};

function render(l: Lesson): HTMLElement {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  act(() => createRoot(host).render(<CreditsList lesson={l} />));
  return host;
}

describe('the picture credits', () => {
  it('lists each found picture once, in the order the board shows them', () => {
    expect(creditsOf(lesson([runner('a'), heart, runner('b')]))).toEqual([credit, heart.kind === 'image' ? heart.credit : null]);
  });

  it('links the licence to its terms and the picture to where it came from', () => {
    const host = render(lesson([runner('a')]));
    const links = [...host.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('rel')]);
    expect(links).toEqual([
      ['CC BY-SA 4.0', credit.licenseUrl, 'noopener noreferrer'],
      ['source', credit.page, 'noopener noreferrer'],
    ]);
    expect(host.textContent).toContain('A. Person');
  });

  it('writes a licence with no address as words, not as a link', () => {
    const host = render(lesson([heart]));
    expect([...host.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['source']);
    expect(host.textContent).toContain('CC0');
  });

  it('never links anywhere but a web page', () => {
    const odd = { ...credit, licenseUrl: 'javascript:alert(1)' } as typeof credit;
    const host = render(lesson([{ ...runner('a'), credit: odd } as Element]));
    expect([...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([credit.page]);
  });

  it('says nothing for a class with no picture from the web', () => {
    expect(render(lesson([{ kind: 'graphic', id: 'g', x: 0, y: 0, w: 1, h: 1, noun: 'sun' }])).innerHTML).toBe('');
  });
});
