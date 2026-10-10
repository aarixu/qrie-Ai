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
    // Its bytes appear once, in that href, and nowhere as markup or text.
    expect(within(host, 'g').innerHTML.split('base64,').length - 1).toBe(1);
    expect(texts(host, 'g')).toContain('Working muscles');
  });

  it('draws it at its own shape, standing on its name', () => {
    const image = within(render([runner], { g: JPEG }), 'g').querySelector('image')!;
    expect(Number(image.getAttribute('width'))).toBeCloseTo(120);
    expect(Number(image.getAttribute('height'))).toBeCloseTo(80);
    // Its foot on the foot of the square, where the name is written under it.
    expect(Number(image.getAttribute('y')) + Number(image.getAttribute('height'))).toBeCloseTo(220);
  });

  it('draws a photograph of unknown shape whole, not cut to a square (review, 2026-10-08)', () => {
    const { aspect: _unknown, ...shapeless } = runner as Extract<Element, { kind: 'graphic' }>;
    const image = within(render([shapeless], { g: JPEG }), 'g').querySelector('image')!;
    expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(within(render([runner], { g: JPEG }), 'g').querySelector('image')!.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
  });

  it('draws the saved file when the class was kept', () => {
    const host = render([{ ...runner, src: '/c/generated/photo_runner.jpg' }]);
    expect(within(host, 'g').querySelector('image')?.getAttribute('href')).toBe('/c/generated/photo_runner.jpg');
  });

  it('says whose photograph it is', () => {
    expect(texts(render([runner], { g: JPEG }), 'g').join(' ')).toContain('A. Person · CC BY-SA 4.0');
  });

  it('writes the credit large enough to read and no wider than the photograph (review, 2026-10-08)', () => {
    const long = { ...runner, credit: { author: 'Photographer with a rather long name', license: 'CC BY-SA 4.0' } };
    const host = render([long], { g: JPEG });
    const credit = [...within(host, 'g').querySelectorAll('text')].find((t) => (t.textContent ?? '').includes('CC BY-SA'))!;
    expect(Number(credit.getAttribute('font-size'))).toBeGreaterThanOrEqual(8);
    const size = Number(credit.getAttribute('font-size'));
    // Measured as the board measures sans text, a line that fits the photo's 120.
    expect((credit.textContent ?? '').length * size * 0.58).toBeLessThanOrEqual(120);
    expect(credit.textContent).toContain('…');
  });

  it('still draws an icon as an icon', () => {
    const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
    const host = render([{ kind: 'graphic', id: 'g', x: 100, y: 100, w: 120, h: 120, noun: 'sun' }], { g: icon });
    expect(within(host, 'g').querySelector('image')).toBeNull();
    expect(within(host, 'g').querySelector('circle')).not.toBeNull();
  });
});

describe('a picture of something moving (2026-10-07)', () => {
  const loop = [
    { src: 'https://upload.wikimedia.org/x/Heart.webm.480p.vp9.webm', type: 'video/webm' },
    { src: 'https://upload.wikimedia.org/x/Heart.webm.240p.vp9.webm', type: 'video/webm' },
  ];
  const beating: Element = {
    kind: 'image', id: 'p', x: 100, y: 100, w: 400, h: 300, src: 'generated/p.jpg', alt: 'a heart beating', credit, video: loop,
  };

  it('plays its loop silently over its still, in the picture\'s own box', () => {
    const host = render([beating], { p: JPEG });
    const video = within(host, 'p').querySelector('video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video!.muted).toBe(true);
    expect(video!.loop).toBe(true);
    expect(video!.hasAttribute('autoplay')).toBe(true);
    expect(video!.hasAttribute('playsinline')).toBe(true);
    expect(video!.getAttribute('poster')).toBe(JPEG);
    expect([...video!.querySelectorAll('source')].map((s) => [s.getAttribute('src'), s.getAttribute('type')])).toEqual(
      loop.map((s) => [s.src, s.type]),
    );
    const box = video!.closest('foreignObject')!;
    expect([box.getAttribute('x'), box.getAttribute('y'), box.getAttribute('width'), box.getAttribute('height')]).toEqual(['100', '100', '400', '300']);
  });

  it('keeps the still drawn, for wherever the loop cannot play, and its credit on top', () => {
    const host = render([beating], { p: JPEG });
    expect(within(host, 'p').querySelector('image')?.getAttribute('href')).toBe(JPEG);
    expect(texts(host, 'p').join(' ')).toContain('A. Person · CC BY-SA 4.0');
  });

  it('hands a drawing kept as SVG markup to the loop\'s poster as a data: URL, as it does to the still', () => {
    // The two branches met here (integration, 2026-10-11): the live site's fix
    // turns markup into a data: URL for <image>; the loop's poster must get the
    // same URL, never the markup itself.
    const drawing = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const host = render([beating], { p: drawing });
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(drawing);
    expect(within(host, 'p').querySelector('image')?.getAttribute('href')).toBe(url);
    expect(within(host, 'p').querySelector('video')?.getAttribute('poster')).toBe(url);
  });

  it('plays nothing for a picture that does not move', () => {
    const { video: _none, ...still } = beating as Extract<Element, { kind: 'image' }>;
    expect(within(render([still], { p: JPEG }), 'p').querySelector('video')).toBeNull();
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
