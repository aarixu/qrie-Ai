import { describe, expect, it, vi } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { dressNounPhotos, findNounPhotos } from '../src/nounPhotos';
import { VERIFIER_SYSTEM, type WebCandidate, type WebImageAdapter } from '../src/fromWeb';

/**
 * A REAL THING ON A SCENE IS A REAL PHOTOGRAPH (Aarav, 2026-10-07).
 *
 * The heart class opened on a drawn cartoon of a runner: "wikimedia se ya
 * kahin aur se ek achha image yahan lga skte the". Each placed noun is looked
 * for as a photograph first, checked by eye against what the lesson means,
 * and only the nouns with no photograph go on to the icon library.
 */

// A one-pixel PNG, so its shape can be read.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const yes = JSON.stringify({ saw: 'a person running', right: true, text: false, count: 1, safe: true, photo: true });
const no = JSON.stringify({ saw: 'a reindeer', right: false, text: false, count: 1, safe: true });

const graphic = (id: string, noun: string, label?: string): Element => ({
  kind: 'graphic', id, x: 0, y: 0, w: 120, h: 120, noun, ...(label ? { label } : {}),
});

const lesson = (els: Element[]): Lesson => ({
  formatVersion: 1,
  id: 'c',
  title: 'The Human Heart',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: els,
  beats: [{ id: 'b1', topic: 't', narration: 'n', show: els.map((e) => e.id) }],
});

const openly = (url: string, over: Partial<WebCandidate> = {}): WebCandidate => ({
  url, license: 'CC BY-SA 4.0', author: 'A. Person', page: `https://commons.wikimedia.org/wiki/File:${url}`, ...over,
});

describe('finding a photograph for each placed thing', () => {
  it('looks once for each noun, with what the board calls it and what the class is about', async () => {
    const searched: string[] = [];
    const web: WebImageAdapter = {
      search: vi.fn(async (q: string) => {
        searched.push(q);
        return [openly(`${q}.jpg`)];
      }),
      fetch: async () => PNG,
    };
    const asked: string[] = [];
    const eyes = { look: vi.fn(async (_src: string, _system: string, user: string) => (asked.push(user), yes)) };
    const l = lesson([graphic('b1__a', 'runner', 'Working muscles'), graphic('b2__a', 'runner', 'Working muscles'), graphic('b1__b', 'lungs')]);

    const photos = await findNounPhotos(l, 'The Human Heart', web, eyes);

    // By what the board calls each one, when it calls it something: found
    // there, the noun is never searched.
    expect(searched.sort()).toEqual(['Working muscles', 'lungs']);
    expect([...photos.keys()].sort()).toEqual(['lungs', 'runner']);
    const runnerAsk = asked.find((u) => u.includes('runner'))!;
    expect(runnerAsk).toContain('Working muscles');
    expect(runnerAsk).toContain('The Human Heart');
  });

  it('looks first for what the board calls it, then for the noun (heart class, 2026-10-08)', async () => {
    // "runner" on Commons is a wildebeest and a herd of reindeer before it is a
    // person; the board's own "running person" is the thing she means.
    const searched: string[] = [];
    const web: WebImageAdapter = {
      search: async (q) => {
        searched.push(q);
        return [openly(`${q}.jpg`)];
      },
      fetch: async () => PNG,
    };
    const eyes = { look: async (_s: string, _sys: string, user: string) => (user.includes('asked for: runner') ? yes : no) };
    const photos = await findNounPhotos(lesson([graphic('a', 'runner', 'running person')]), 't', web, eyes);
    expect(searched).toEqual(['running person', 'runner']);
    expect([...photos.keys()]).toEqual(['runner']);
  });

  it('takes a photograph with words in it, a street sign or a race number, which a placed thing may have (heart class, 2026-10-08)', async () => {
    // The no-words rule is for a picture she labels part by part; a placed
    // thing's photograph has no parts written on it.
    const web: WebImageAdapter = { search: async (q) => [openly(`${q}.jpg`)], fetch: async () => PNG };
    const withWords = JSON.stringify({ saw: 'a person running past a shop sign', right: true, text: true, count: 1, safe: true, photo: true });
    const photos = await findNounPhotos(lesson([graphic('a', 'runner', 'running person')]), 't', web, { look: async () => withWords });
    expect([...photos.keys()]).toEqual(['runner']);
  });

  it('takes a photograph of several of them, a race of runners, which a placed thing may show (heart class, 2026-10-08)', async () => {
    // One-of-the-subject is for a picture she marks part by part.
    const web: WebImageAdapter = { search: async (q) => [openly(`${q}.jpg`)], fetch: async () => PNG };
    const race = JSON.stringify({ saw: 'runners in a street race', right: true, text: true, count: 3, safe: true, photo: true });
    const photos = await findNounPhotos(lesson([graphic('a', 'runner', 'running person')]), 't', web, { look: async () => race });
    expect([...photos.keys()]).toEqual(['runner']);
  });

  it('takes only a photograph, never a pictogram or a drawing in its place (heart class, 2026-10-08)', async () => {
    // The search's first "running person" was a stick-figure pictogram: right
    // subject, and exactly the cartoon this rule exists to replace.
    const web: WebImageAdapter = { search: async (q) => [openly(`${q}.jpg`)], fetch: async () => PNG };
    const pictogram = JSON.stringify({ saw: 'a stylized pictogram of a running person', right: true, text: false, count: 1, safe: true, photo: false });
    const photos = await findNounPhotos(lesson([graphic('a', 'runner', 'running person')]), 't', web, { look: async () => pictogram });
    expect(photos.size).toBe(0);
  });

  it('does not look twice when the board calls it by its noun', async () => {
    const searched: string[] = [];
    const web: WebImageAdapter = { search: async (q) => (searched.push(q), []), fetch: async () => PNG };
    await findNounPhotos(lesson([graphic('a', 'lungs', 'Lungs')]), 't', web, { look: async () => no });
    expect(searched).toEqual(['Lungs']);
  });

  it('leaves out a noun whose photographs were all wrong, for the icons to cover', async () => {
    const web: WebImageAdapter = { search: async (q) => [openly(`${q}.jpg`)], fetch: async () => PNG };
    const eyes = { look: vi.fn(async (_s: string, system: string) => (system === VERIFIER_SYSTEM ? no : '{}')) };
    const photos = await findNounPhotos(lesson([graphic('g', 'runner')]), 'The Human Heart', web, eyes);
    expect(photos.size).toBe(0);
  });

  it('never throws, whatever the search does', async () => {
    const web: WebImageAdapter = {
      search: async () => {
        throw new Error('offline');
      },
      fetch: async () => PNG,
    };
    const photos = await findNounPhotos(lesson([graphic('g', 'runner')]), 't', web, { look: async () => yes });
    expect(photos.size).toBe(0);
  });

  it('stops waiting at its deadline, keeping what it found, so the icons are not held up (review, 2026-10-08)', async () => {
    const web: WebImageAdapter = {
      search: async (q) => (q === 'lungs' ? new Promise<never>(() => {}) : [openly(`${q}.jpg`)]),
      fetch: async () => PNG,
    };
    const started = Date.now();
    const photos = await findNounPhotos(lesson([graphic('a', 'runner'), graphic('b', 'lungs')]), 't', web, { look: async () => yes }, { deadlineMs: 60 });
    expect(Date.now() - started).toBeLessThan(1500);
    expect([...photos.keys()]).toEqual(['runner']);
  }, 3000);

  it('has nothing to do on a board with no placed things', async () => {
    const web = { search: vi.fn(), fetch: vi.fn() };
    expect((await findNounPhotos(lesson([]), 't', web as never, { look: vi.fn() })).size).toBe(0);
    expect(web.search).not.toHaveBeenCalled();
  });
});

describe('dressing the placed things in their photographs', () => {
  it('hands each element showing the noun the photograph, its shape and its credit', async () => {
    const web: WebImageAdapter = { search: async (q) => [openly(`${q}.jpg`)], fetch: async () => PNG };
    const l = lesson([graphic('b1__a', 'runner'), graphic('b2__a', 'runner'), graphic('b1__b', 'sun')]);
    const eyes = { look: async (_s: string, _sys: string, user: string) => (user.includes('runner') ? yes : no) };
    const photos = await findNounPhotos(l, 't', web, eyes);

    const assets = dressNounPhotos(l, photos);

    expect(assets).toEqual({ b1__a: PNG, b2__a: PNG });
    for (const id of ['b1__a', 'b2__a']) {
      const el = l.elements.find((e) => e.id === id) as Extract<Element, { kind: 'graphic' }>;
      expect(el.aspect).toBe(1);
      expect(el.credit).toEqual({ author: 'A. Person', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:runner.jpg' });
    }
    const sun = l.elements.find((e) => e.id === 'b1__b') as Extract<Element, { kind: 'graphic' }>;
    expect(sun.aspect).toBeUndefined();
    expect(sun.credit).toBeUndefined();
  });
});
