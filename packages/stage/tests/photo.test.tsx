// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';

/**
 * A REAL THING IS A REAL PHOTOGRAPH, AND SAYS WHOSE IT IS (Aarav, 2026-10-07).
 *
 * "Wikimedia se ya kahin aur se ek achha image yahan lga skte the" — the
 * opening of the heart class put a drawn cartoon of a runner on the board.
 * A placed thing now shows the photograph found for it, at its own shape and
 * standing on its name, and every picture from the web shows its credit.
 */

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEB';
const credit = { author: 'A. Person', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Runner.jpg' };

function render(els: Element[], assets: Record<string, string> = {}): HTMLElement {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const lesson: Lesson = {
    formatVersion: 1,
    id: 'c',
    title: 'C',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: els,
    beats: [{ id: 'b', topic: 't', narration: 'n', show: els.map((e) => e.id) }],
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<Scene lesson={lesson} assets={assets} visible={els.map((e) => e.id)} focus={[]} />));
  return host;
}

const within = (host: HTMLElement, id: string) => host.querySelector(`[data-element-id="${id}"]`) as Element & SVGElement;
const texts = (host: HTMLElement, id: string) => [...within(host, id).querySelectorAll('text')].map((t) => t.textContent ?? '');

describe('a placed thing with a photograph', () => {
  const runner: Element = { kind: 'graphic', id: 'g', x: 100, y: 100, w: 120, h: 120, noun: 'runner', label: 'Working muscles', aspect: 1.5, credit };

  it('draws the photograph, not its bytes as markup', () => {
    const host = render([runner], { g: JPEG });
    const image = within(host, 'g').querySelector('image');
    expect(image?.getAttribute('href')).toBe(JPEG);
    expect(within(host, 'g').innerHTML).not.toContain('base64,/9j/4AAQ</g>');
    expect(texts(host, 'g')).toContain('Working muscles');
  });

  it('draws it at its own shape, standing on its name', () => {
    const image = within(render([runner], { g: JPEG }), 'g').querySelector('image')!;
    expect(Number(image.getAttribute('width'))).toBeCloseTo(120);
    expect(Number(image.getAttribute('height'))).toBeCloseTo(80);
    // Its foot on the foot of the square, where the name is written under it.
    expect(Number(image.getAttribute('y')) + Number(image.getAttribute('height'))).toBeCloseTo(220);
  });

  it('draws the saved file when the class was kept', () => {
    const host = render([{ ...runner, src: '/c/generated/photo_runner.jpg' }]);
    expect(within(host, 'g').querySelector('image')?.getAttribute('href')).toBe('/c/generated/photo_runner.jpg');
  });

  it('says whose photograph it is', () => {
    expect(texts(render([runner], { g: JPEG }), 'g').join(' ')).toContain('A. Person · CC BY-SA 4.0');
  });

  it('still draws an icon as an icon', () => {
    const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
    const host = render([{ kind: 'graphic', id: 'g', x: 100, y: 100, w: 120, h: 120, noun: 'sun' }], { g: icon });
    expect(within(host, 'g').querySelector('image')).toBeNull();
    expect(within(host, 'g').querySelector('circle')).not.toBeNull();
  });
});

describe('a picture from the web', () => {
  it('says whose it is, and a made picture says nothing', () => {
    const found: Element = { kind: 'image', id: 'p', x: 100, y: 100, w: 400, h: 300, src: 'generated/p.jpg', alt: 'a heart', credit };
    const made: Element = { kind: 'image', id: 'q', x: 520, y: 100, w: 400, h: 300, src: 'generated/q.png', alt: 'a heart' };
    const host = render([found, made]);
    expect(texts(host, 'p').join(' ')).toContain('A. Person · CC BY-SA 4.0');
    expect(texts(host, 'q')).toEqual([]);
  });

  it('keeps a long name to a line', () => {
    const long: Element = {
      kind: 'image', id: 'p', x: 100, y: 100, w: 400, h: 300, src: 'generated/p.jpg', alt: 'a heart',
      credit: { author: 'Photograph by somebody with a very long name indeed, own work', license: 'CC BY 4.0' },
    };
    const line = texts(render([long]), 'p').join(' ');
    expect(line).toContain('…');
    expect(line).toContain('CC BY 4.0');
    expect(line.length).toBeLessThan(60);
  });
});
