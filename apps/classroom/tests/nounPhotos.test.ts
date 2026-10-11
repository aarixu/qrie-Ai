import { describe, expect, it, vi } from 'vitest';

/**
 * A PLACED THING IS LOOKED FOR AS A PHOTOGRAPH BEFORE IT IS GIVEN AN ICON
 * (Aarav, 2026-10-07: "wikimedia se ya kahin aur se ek achha image yahan lga
 * skte the", of the cartoon runner the heart class opened on).
 *
 * Asserted on what the live preparation hands back, because a rung no call
 * site reaches is a rung the app does not have.
 */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const lessonWithARunner = () => ({
  formatVersion: 1,
  id: 'x',
  title: 'The Human Heart',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'graphic', id: 'b1__body', x: 0, y: 0, w: 120, h: 120, noun: 'runner', label: 'Working muscles' }],
  beats: [{ id: 'b1', topic: 't', narration: 'n', show: ['b1__body'] }],
});

const prepared = vi.hoisted(() => ({
  fn: vi.fn(),
  draft: null as unknown,
}));

vi.mock('@ai-tutor/class-prep', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, prepareClass: prepared.fn };
});
vi.mock('../src/lib/browserLlm', () => ({ createBrowserLlm: () => ({ complete: async () => '{}' }) }));
vi.mock('../src/lib/browserImage', () => ({
  createBrowserImageArtist: () => ({ draw: async () => null }),
  createBrowserVision: () => ({
    look: async () => JSON.stringify({ saw: 'a person running', right: true, text: false, count: 1, safe: true, photo: true }),
  }),
}));
vi.mock('../src/lib/relay', () => ({ relayFetch: async () => new Response('{}') }));

import { prepareLiveClass } from '../src/lib/liveClass';

const web = {
  search: vi.fn(async () => [
    { url: 'https://upload.wikimedia.org/runner.jpg', license: 'CC BY-SA 4.0', author: 'A. Person', page: 'https://commons.wikimedia.org/wiki/File:Runner.jpg' },
  ]),
  fetch: vi.fn(async () => PNG),
};

describe('a placed thing on a live class', () => {
  it('shows the photograph found for it, with its credit', async () => {
    const lesson = lessonWithARunner();
    prepared.fn.mockImplementation(async () => ({
      lesson,
      assets: {},
      report: { topic: 'T', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [] },
    }));
    const made = await prepareLiveClass({ topic: 'The Human Heart', klass: 10, minutes: 3, web }, () => {});
    expect(made.assets.b1__body).toBe(PNG);
    const runner = made.lesson.elements.find((e) => e.id === 'b1__body') as { credit?: unknown; aspect?: number };
    expect(runner.credit).toEqual({ author: 'A. Person', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Runner.jpg' });
    expect(runner.aspect).toBe(1);
  });

  it('dresses the draft the student is already watching, too', async () => {
    // As prepareClass does: the draft and the result share ONE assets record,
    // the one the room is drawing from.
    const final = lessonWithARunner();
    const draft = lessonWithARunner();
    const assets: Record<string, string> = {};
    let watched: Record<string, string> | null = null;
    prepared.fn.mockImplementation(async (opts: { onDraft?: (d: unknown) => void }) => {
      opts.onDraft?.({ lesson: draft, assets });
      return { lesson: final, assets, report: { topic: 'T', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [] } };
    });
    await prepareLiveClass({ topic: 'The Human Heart', klass: 10, minutes: 3, web }, () => {}, {
      onDraft: (d) => {
        watched = d.assets;
      },
      onArt: () => {},
    });
    expect((draft.elements[0] as { credit?: unknown }).credit).toBeDefined();
    expect(watched!.b1__body).toBe(PNG);
  });

  /**
   * WHILE THE MAIN PICTURES ARE STILL BEING MADE (integration audit,
   * 2026-10-11). The nouns were looked for only after prepareClass finished,
   * which waits on every main picture; the student, already in the room on
   * the draft, watched dashed word boxes for tens of seconds or minutes. The
   * search now starts when the draft arrives.
   */
  it('dresses the draft while the class is still being prepared', async () => {
    const draft = lessonWithARunner();
    const final = lessonWithARunner();
    const assets: Record<string, string> = {};
    let finish: () => void = () => undefined;
    let arts = 0;
    prepared.fn.mockImplementation(async (opts: { onDraft?: (d: unknown) => void }) => {
      opts.onDraft?.({ lesson: draft, assets });
      await new Promise<void>((resolve) => (finish = resolve)); // the main pictures, still being made
      return { lesson: final, assets, report: { topic: 'T', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [] } };
    });
    const making = prepareLiveClass({ topic: 'The Human Heart', klass: 10, minutes: 3, web }, () => {}, {
      onDraft: () => {},
      onArt: () => void (arts += 1),
    });
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect((draft.elements[0] as { credit?: unknown }).credit, 'the draft has its photo before the class is done').toBeDefined();
    expect(assets.b1__body).toBe(PNG);
    expect(arts).toBeGreaterThan(0);
    finish();
    const made = await making;
    expect((made.lesson.elements[0] as { credit?: unknown }).credit).toBeDefined();
    expect(made.assets.b1__body).toBe(PNG);
  });

  it('looks for none when the search is turned off', async () => {
    web.search.mockClear();
    prepared.fn.mockImplementation(async () => ({
      lesson: lessonWithARunner(),
      assets: {},
      report: { topic: 'T', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [] },
    }));
    const made = await prepareLiveClass({ topic: 'The Human Heart', klass: 10, minutes: 3, web: null }, () => {});
    expect(web.search).not.toHaveBeenCalled();
    expect(made.assets.b1__body ?? '').not.toMatch(/^data:image\//);
  });
});
