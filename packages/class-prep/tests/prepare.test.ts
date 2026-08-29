import { describe, expect, it } from 'vitest';
import { validateLesson } from '@ai-tutor/lesson-format';
import { assemble, prepareClass, type LlmAdapter } from '../src/prepare';
import type { Blueprint } from '../src/types';

const blueprint: Blueprint = {
  id: 'demo',
  title: 'Speed',
  elements: [
    { kind: 'title', id: 't', x: 500, y: 78, text: 'Speed' },
    { kind: 'text', id: 'x1', x: 500, y: 560, text: 'Steeper means faster.' },
  ],
  beats: [
    { id: 'b1', topic: 'open', narration: 'Here we go.', show: ['t'] },
    {
      id: 'b2',
      topic: 'graph',
      narration: 'Look at the slope.',
      show: ['d_graph', 'x1'],
      focus: ['d_graph#line_fast', 'x1'],
    },
    { id: 'b3', topic: 'only art', narration: 'And here it is again.', show: ['d_graph'] },
  ],
  visuals: [
    {
      id: 'd_graph',
      parts: ['axes', 'line_fast'],
      brief: 'a graph',
      alt: 'a distance-time graph',
      box: { x: 90, y: 110, w: 820, h: 400 },
    },
  ],
};

const svg = (parts: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620">${parts
    .map((p) => `<g id="${p}"><path d="M10 10 L20 20" stroke="var(--a, #333)"/></g>`)
    .join('')}</svg>`;

/** A planner that returns a fixed blueprint, and an artist we can make fail. */
const fakePlanner = (doc: unknown): LlmAdapter => ({
  complete: async () => JSON.stringify(doc),
});
const fakeArtist = (replies: string[]): LlmAdapter => {
  let i = 0;
  return { complete: async () => replies[Math.min(i++, replies.length - 1)] };
};

describe('assemble builds the diagrams rather than trusting the planner to', () => {
  it('turns a drawn visual into a diagram element whose parts match its brief', () => {
    const { lesson } = assemble(blueprint, new Set(['d_graph']));
    const doc = lesson as { elements: { id: string; kind: string; parts?: string[] }[] };
    const diagram = doc.elements.find((e) => e.id === 'd_graph')!;
    expect(diagram.kind).toBe('diagram');
    expect(diagram.parts).toEqual(['axes', 'line_fast']);
    expect(validateLesson(lesson).ok).toBe(true);
  });

  it('drops a failed picture and every reference to it, and stays valid', () => {
    const { lesson, dropped } = assemble(blueprint, new Set());
    expect(dropped).toEqual(['d_graph']);

    const doc = lesson as { beats: { id: string; show: string[]; focus?: string[] }[] };
    // b2 keeps its caption; b3 had nothing but the picture, so it goes.
    expect(doc.beats.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(doc.beats[1].show).toEqual(['x1']);
    expect(doc.beats[1].focus).toEqual(['x1']);
    expect(validateLesson(lesson).ok).toBe(true);
  });

  it('never leaves a focus pointing at a part that was not drawn', () => {
    const { lesson } = assemble(blueprint, new Set());
    const doc = lesson as { beats: { focus?: string[] }[] };
    for (const beat of doc.beats) {
      for (const f of beat.focus ?? []) expect(f).not.toContain('#');
    }
  });
});

describe('prepareClass', () => {
  it('plans, draws, verifies and returns something the board can play', async () => {
    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner: fakePlanner(blueprint),
      artist: fakeArtist([svg(['axes', 'line_fast'])]),
    });

    expect(result.lesson.beats).toHaveLength(3);
    expect(Object.keys(result.assets)).toEqual(['d_graph']);
    expect(result.report.visuals[0]).toMatchObject({ id: 'd_graph', ok: true, attempts: 1 });
    expect(result.report.issues).toEqual([]);
  });

  it('redraws a rejected picture, telling the artist what was wrong', async () => {
    const artist = fakeArtist([svg(['axes']), svg(['axes', 'line_fast'])]);
    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner: fakePlanner(blueprint),
      artist,
    });
    expect(result.report.visuals[0]).toMatchObject({ ok: true, attempts: 2 });
    expect(result.report.visuals[0].problems).toContain('missing named group(s): line_fast');
  });

  it('starts the class without a picture rather than not at all', async () => {
    // A class with one drawing instead of two is still a class. A class that
    // failed to start is not.
    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner: fakePlanner(blueprint),
      artist: fakeArtist(['I cannot draw that.']),
    });

    expect(result.assets).toEqual({});
    expect(result.report.visuals[0].ok).toBe(false);
    expect(result.report.issues.join(' ')).toContain('Dropped the picture "d_graph"');
    expect(result.lesson.beats.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('survives an artist that throws, and counts it as a failed attempt', async () => {
    const artist: LlmAdapter = {
      complete: async () => {
        throw new Error('429 rate limited');
      },
    };
    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner: fakePlanner(blueprint),
      artist,
    });
    expect(result.report.visuals[0].problems.join(' ')).toContain('429');
    expect(result.lesson.beats.length).toBeGreaterThan(0);
  });

  it('reports progress so a real wait is visible', async () => {
    const seen: string[] = [];
    await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner: fakePlanner(blueprint),
      artist: fakeArtist([svg(['axes', 'line_fast'])]),
      onProgress: (p) => seen.push(p.phase),
    });
    expect(seen[0]).toBe('planning');
    expect(seen).toContain('drawing');
    expect(seen.at(-1)).toBe('done');
  });

  it('says plainly when the planner did not return JSON', async () => {
    const planner: LlmAdapter = { complete: async () => 'Sure, here is a lesson!' };
    await expect(
      prepareClass({ topic: 'x', klass: 9, planner, artist: fakeArtist(['']) }),
    ).rejects.toThrow(/did not return JSON/);
  });
});

describe('a plan that fails validation gets one repair round', () => {
  // A live planner really did emit `"size": "md"`, which every other check waved
  // through until the validator caught it. Failing the whole class there would
  // be worse than the bug: the pictures are already drawn and paid for.
  const broken: Blueprint = {
    ...blueprint,
    elements: [
      { kind: 'title', id: 't', x: 500, y: 78, text: 'Speed' },
      // `size` is not a number — invalid, and the reason this test exists.
      { kind: 'handwrite', id: 'x1', x: 500, y: 300, text: 'v = s / t', size: 'md' } as never,
    ],
  };

  it('asks the planner to fix exactly what the validator named, and recovers', async () => {
    const seen: string[] = [];
    let call = 0;
    const planner: LlmAdapter = {
      complete: async (_system, user) => {
        seen.push(user);
        call += 1;
        return JSON.stringify(call === 1 ? broken : blueprint);
      },
    };

    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner,
      artist: fakeArtist([svg(['axes', 'line_fast'])]),
    });

    expect(call).toBe(2);
    expect(seen[1]).toContain('rejected by the validator');
    expect(seen[1]).toContain('size must be a number');
    expect(result.report.issues.join(' ')).toContain('repaired and passed');
    expect(result.lesson.beats.length).toBeGreaterThan(0);
  });

  it('gives up honestly when the repair is broken too', async () => {
    const planner: LlmAdapter = { complete: async () => JSON.stringify(broken) };
    await expect(
      prepareClass({
        topic: 'Speed',
        klass: 9,
        planner,
        artist: fakeArtist([svg(['axes', 'line_fast'])]),
      }),
    ).rejects.toThrow(/not valid/);
  });
});
