import { describe, expect, it, vi } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import type { PrepReport } from '@ai-tutor/class-prep';

/**
 * C10: THE REVIEWER RUNS IN LIVE PREP, AND ONLY WHAT IT PASSED IS KEPT.
 *
 * A class the app prepares is kept under a unique topic_ref and served to
 * every later student on that topic, and until this the app prepared with no
 * reviewer at all (tools/prewarm's header called it "divergence 1"). So a
 * live student reaching a cold topic could install an unreviewed class for
 * good. Two halves, both asserted on what actually happens rather than on a
 * flag: prepareClass is HANDED a reviewer, and keep() POSTs nothing for a
 * preparation whose report carries no review.
 */

const prepared = vi.hoisted(() => ({
  fn: vi.fn(async () => ({
    lesson: { id: 'x', title: 'T', beats: [], elements: [] },
    assets: {},
    report: { topic: 'T', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [] },
  })),
}));
const posted = vi.hoisted(() => ({ calls: [] as { url: string; body: unknown }[] }));

vi.mock('@ai-tutor/class-prep', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, prepareClass: prepared.fn };
});
// No network, no relay, no model. A real planner call costs real rupees.
vi.mock('../src/lib/browserLlm', () => ({ createBrowserLlm: () => ({ complete: async () => '{}' }) }));
vi.mock('../src/lib/browserImage', () => ({
  createBrowserImageArtist: () => ({ draw: async () => null }),
  createBrowserVision: () => ({ look: async () => '{}' }),
}));
vi.mock('../src/lib/relay', () => ({
  relayFetch: async (url: string, init?: { body?: string }) => {
    posted.calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return new Response('{}');
  },
}));

import { prepareLiveClass } from '../src/lib/liveClass';
import { keep } from '../src/screens/LiveClass';

describe('live prep is reviewed', () => {
  it('hands prepareClass a reviewer', async () => {
    prepared.fn.mockClear();
    await prepareLiveClass({ topic: 'The Kidney', klass: 10, minutes: 3 }, () => {});
    const options = (prepared.fn.mock.calls.at(-1) as unknown[])[0] as { reviewer?: { complete?: unknown } };
    expect(options.reviewer).toBeDefined();
    expect(typeof options.reviewer!.complete).toBe('function');
  });
});

describe('keep() keeps only a reviewed class', () => {
  /** A class saveable() would keep in every other respect: English, no art, a topic. */
  const lesson: Lesson = {
    formatVersion: 1,
    id: 'kidney',
    title: 'The Kidney',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [{ kind: 'text', id: 't', x: 500, y: 300, text: 'Filters the blood' }],
    beats: [{ id: 'b1', topic: 'kidney', narration: 'The kidney filters the blood.', show: ['t'] }],
  };
  const base: PrepReport = { topic: 'The Kidney', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [] };
  const ask = {
    topic: 'The Kidney',
    klass: 10,
    minutes: 3,
    subject: 'Science',
    topicRef: 'class10-science/life-processes/excretion',
  };

  it('posts nothing for a preparation no reviewer saw', async () => {
    posted.calls.length = 0;
    await keep({ lesson, assets: {}, report: { ...base, gate: { problems: [] } } }, ask, []);
    expect(posted.calls.filter((c) => c.url === '/api/class')).toEqual([]);
  });

  it('posts nothing for one the keep gate did not check', async () => {
    posted.calls.length = 0;
    const reviewed = { ...base, review: { flagged: [], repaired: false, ms: 900 } };
    await keep({ lesson, assets: {}, report: reviewed }, ask, []);
    expect(posted.calls.filter((c) => c.url === '/api/class')).toEqual([]);
  });

  it('posts a class the reviewer and the gate both passed', async () => {
    posted.calls.length = 0;
    const passed = { ...base, review: { flagged: [], repaired: false, ms: 900 }, gate: { problems: [] } };
    await keep({ lesson, assets: {}, report: passed }, ask, []);
    const kept = posted.calls.filter((c) => c.url === '/api/class');
    expect(kept).toHaveLength(1);
    expect((kept[0].body as { entry: { topicRef: string } }).entry.topicRef).toBe(ask.topicRef);
  });
});

describe('keep() also keeps the class on this device', () => {
  const lesson: Lesson = {
    formatVersion: 1,
    id: 'kidney',
    title: 'The Kidney',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [{ kind: 'text', id: 't', x: 500, y: 300, text: 'Filters the blood' }],
    beats: [{ id: 'b1', topic: 'kidney', narration: 'The kidney filters the blood.', show: ['t'] }],
  };
  const passed: PrepReport = {
    topic: 'The Kidney', totalMs: 1, planMs: 1, visualsMs: 1, issues: [], visuals: [],
    review: { flagged: [], repaired: false, ms: 900 }, gate: { problems: [] },
  };
  const ask = { topic: 'The Kidney', klass: 10, minutes: 3, subject: 'Science', topicRef: 'class10-science/life-processes/excretion' };

  it('keeps on the device exactly what the catalogue would keep', async () => {
    const { createPreparedCache, memoryBackend } = await import('../src/lib/preparedCache');
    const device = createPreparedCache(memoryBackend());
    await keep({ lesson, assets: { t: '<svg/>' }, report: passed }, ask, [], device);
    expect(await device.find(ask.topicRef)).toMatchObject({ lesson: { title: 'The Kidney' } });

    // One the catalogue refuses (no review) is not kept here either.
    const other = createPreparedCache(memoryBackend());
    await keep({ lesson, assets: {}, report: { ...passed, review: undefined } }, ask, [], other);
    expect(await other.find(ask.topicRef)).toBeNull();
  });
});
