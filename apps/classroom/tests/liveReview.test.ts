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
const posted = vi.hoisted(() => ({
  calls: [] as { url: string; body: unknown }[],
  refuse: false,
  /** When set, the POST answers only once this settles. */
  hold: null as Promise<void> | null,
}));

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
    if (posted.hold) await posted.hold;
    return new Response('{}', { status: posted.refuse ? 422 : 200 });
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

describe('a live lesson is filed under its topic', () => {
  it('carries the topicRef it was prepared for', async () => {
    const { stampTopic } = await import('../src/screens/LiveClass');
    const lesson = { id: 'l', title: 'T', beats: [], elements: [] } as unknown as Lesson;
    stampTopic(lesson, 'class8/x/y');
    expect(lesson.topicRef).toBe('class8/x/y');
    const own = { ...lesson, topicRef: 'class8/x/z' } as Lesson;
    stampTopic(own, 'class8/x/y');
    expect(own.topicRef).toBe('class8/x/z');
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

  it('keeps a class on the device only once the catalogue has taken it', async () => {
    const { createPreparedCache, memoryBackend } = await import('../src/lib/preparedCache');
    const device = createPreparedCache(memoryBackend());
    posted.refuse = true;
    await keep({ lesson, assets: {}, report: passed }, ask, [], device);
    posted.refuse = false;
    await new Promise((r) => setTimeout(r, 0));
    expect(await device.find(ask.topicRef)).toBeNull();
  });

  it('keeps a Hinglish class on the device, for the student it was taught to', async () => {
    const { createPreparedCache, memoryBackend } = await import('../src/lib/preparedCache');
    const device = createPreparedCache(memoryBackend());
    await keep({ lesson: { ...lesson, language: 'hi-en' }, assets: {}, report: passed }, ask, [], device);
    await new Promise((r) => setTimeout(r, 0));
    expect(await device.find(ask.topicRef, 'hi-en')).toMatchObject({ lesson: { language: 'hi-en' } });
  });

  it('keeps on the device exactly what the catalogue would keep', async () => {
    const { createPreparedCache, memoryBackend } = await import('../src/lib/preparedCache');
    const device = createPreparedCache(memoryBackend());
    await keep({ lesson, assets: { t: '<svg/>' }, report: passed }, ask, [], device);
    await new Promise((r) => setTimeout(r, 0));
    expect(await device.find(ask.topicRef)).toMatchObject({ lesson: { title: 'The Kidney' } });

    // One the catalogue refuses (no review) is not kept here either.
    const other = createPreparedCache(memoryBackend());
    await keep({ lesson, assets: {}, report: { ...passed, review: undefined } }, ask, [], other);
    expect(await other.find(ask.topicRef)).toBeNull();
  });

  // Fifth review: the Hinglish device-only keep skipped the shared-past check,
  // because that check knew only English ways of saying it.
  it('keeps no Hinglish class that claims a session it never had', async () => {
    const { createPreparedCache, memoryBackend } = await import('../src/lib/preparedCache');
    const device = createPreparedCache(memoryBackend());
    const remembering: Lesson = {
      ...lesson,
      language: 'hi-en',
      beats: [
        {
          id: 'b1',
          topic: 'kidney',
          narration: 'Pichhli class mein humne nucleus padha tha. Aaj hum kidney padhenge.',
          show: ['t'],
        },
      ],
    };
    await keep({ lesson: remembering, assets: {}, report: passed }, ask, [], device);
    await new Promise((r) => setTimeout(r, 0));
    expect(await device.find(ask.topicRef, 'hi-en')).toBeNull();
  });

  // Fifth review: the previous student's keep(), still waiting on its POST,
  // wrote their class onto the device after the handover had emptied it.
  it('keeps nothing on a device emptied while the catalogue was answering', async () => {
    const { createPreparedCache, memoryBackend } = await import('../src/lib/preparedCache');
    const device = createPreparedCache(memoryBackend());
    let answer: () => void = () => undefined;
    posted.hold = new Promise<void>((resolve) => (answer = resolve));
    try {
      const keeping = keep({ lesson, assets: {}, report: passed }, ask, [], device);
      await new Promise((r) => setTimeout(r, 0));
      await device.clear();
      answer();
      await keeping;
    } finally {
      posted.hold = null;
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(await device.find(ask.topicRef)).toBeNull();
  });
});
