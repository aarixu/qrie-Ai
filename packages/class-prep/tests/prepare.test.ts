import { describe, expect, it } from 'vitest';
import { validateLesson, type Element } from '@ai-tutor/lesson-format';
import { assemble, parsePlan, prepareClass, type LlmAdapter } from '../src/prepare';
import type { Blueprint } from '../src/types';

const blueprint: Blueprint = {
  id: 'demo',
  title: 'Speed',
  beats: [
    { id: 'b1', topic: 'open', narration: 'Here we go.', board: [{ do: 'title', text: 'Speed' }] },
    {
      id: 'b2',
      topic: 'graph',
      narration: 'Look at the slope.',
      board: [
        { do: 'diagram', ref: 'd_graph' },
        { do: 'point', ref: 'd_graph', part: 'line_fast' },
        { do: 'caption', text: 'Steeper means faster.' },
      ],
    },
    {
      id: 'b3',
      topic: 'only art',
      narration: 'And here it is again.',
      board: [{ do: 'diagram', ref: 'd_graph' }],
    },
  ],
  visuals: [
    {
      id: 'd_graph',
      parts: ['axes', 'line_fast'],
      brief: 'a graph',
      alt: 'a distance-time graph',
    },
  ],
};

const svg = (parts: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620">${parts
    .map((p) => `<g id="${p}"><path d="M10 10 L20 20" stroke="var(--a, #333)"/></g>`)
    .join('')}</svg>`;

const fakePlanner = (doc: unknown): LlmAdapter => ({ complete: async () => JSON.stringify(doc) });
const fakeArtist = (replies: string[]): LlmAdapter => {
  let i = 0;
  return { complete: async () => replies[Math.min(i++, replies.length - 1)] };
};

describe('assemble lays the board out rather than trusting the planner to', () => {
  it('finishes a diagram element with the parts its brief promised', () => {
    const { lesson } = assemble(blueprint, new Set(['d_graph']));
    const doc = lesson as { elements: Element[] };
    const diagram = doc.elements.find((e) => e.id === 'd_graph')!;
    expect(diagram.kind).toBe('diagram');
    expect((diagram as Extract<Element, { kind: 'diagram' }>).parts).toEqual([
      'axes',
      'line_fast',
    ]);
    expect((diagram as Extract<Element, { kind: 'diagram' }>).alt).toBe('a distance-time graph');
    expect(validateLesson(lesson).ok).toBe(true);
  });

  it('gives every element a position even though the plan had none', () => {
    // The blueprint contains no x, y, w or h anywhere. Every coordinate below
    // was computed, which is the entire point of the split.
    expect(JSON.stringify(blueprint)).not.toMatch(/"[xy]":/);
    const { lesson } = assemble(blueprint, new Set(['d_graph']));
    const doc = lesson as { elements: Element[] };
    expect(doc.elements.length).toBeGreaterThan(0);
    for (const el of doc.elements) {
      if ('x' in el) expect(Number.isFinite(el.x)).toBe(true);
    }
  });

  it('drops a failed picture, and the beats that were only about it', () => {
    const { lesson, dropped } = assemble(blueprint, new Set());
    expect(dropped).toEqual(['d_graph']);

    const doc = lesson as { beats: { id: string; show: string[]; focus?: string[] }[] };
    // b2 keeps its caption; b3 had nothing but the picture, so it goes.
    expect(doc.beats.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(doc.beats[1].focus).toBeUndefined();
    expect(validateLesson(lesson).ok).toBe(true);
  });

  it('keeps the point when the picture was drawn', () => {
    const { lesson } = assemble(blueprint, new Set(['d_graph']));
    const doc = lesson as { beats: { id: string; focus?: string[] }[] };
    expect(doc.beats.find((b) => b.id === 'b2')?.focus).toEqual(['d_graph#line_fast']);
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
    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner: fakePlanner(blueprint),
      artist: fakeArtist([svg(['axes']), svg(['axes', 'line_fast'])]),
    });
    expect(result.report.visuals[0]).toMatchObject({ ok: true, attempts: 2 });
    expect(result.report.visuals[0].problems).toContain('missing named group(s): line_fast');
  });

  it('starts the class without a picture rather than not at all', async () => {
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

  it('gives up only after asking twice for readable JSON', async () => {
    let calls = 0;
    const planner: LlmAdapter = {
      complete: async () => {
        calls += 1;
        return 'Sure, here is a lesson!';
      },
    };
    await expect(
      prepareClass({ topic: 'x', klass: 9, planner, artist: fakeArtist(['']) }),
    ).rejects.toThrow(/readable JSON, twice/);
    expect(calls).toBe(2);
  });

  it('recovers when the second attempt is readable', async () => {
    // A model that drops a brace has still done the thinking; failing the whole
    // class over punctuation throws that away.
    let calls = 0;
    const planner: LlmAdapter = {
      complete: async () => {
        calls += 1;
        return calls === 1 ? '{"beats": [ oops' : JSON.stringify(blueprint);
      },
    };
    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner,
      artist: fakeArtist([svg(['axes', 'line_fast'])]),
    });
    expect(result.lesson.beats.length).toBeGreaterThan(0);
    expect(result.report.issues.join(' ')).toContain('not readable JSON');
  });
});

describe('a plan that fails validation gets one repair round', () => {
  // Narration is required; a beat without it is the simplest thing a planner
  // can still get wrong now that it cannot get geometry wrong at all.
  const broken: Blueprint = {
    ...blueprint,
    beats: [{ id: 'b1', topic: 'open', narration: '', board: [{ do: 'title', text: 'Speed' }] }],
  };

  it('asks the planner to fix exactly what was named, and recovers', async () => {
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
    expect(seen[1]).toContain('rejected');
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


describe('parsePlan reads a plan out of whatever the model sent', () => {
  const doc = { id: 'x', title: 'T', beats: [], visuals: [] };
  const json = JSON.stringify(doc);

  it('reads plain JSON', () => {
    expect(parsePlan(json)).toMatchObject({ id: 'x' });
  });

  it('reads JSON inside a markdown fence', () => {
    const fence = "```";
    expect(parsePlan(`${fence}json\n${json}\n${fence}`)).toMatchObject({ id: 'x' });
  });

  it('reads JSON with prose wrapped around it', () => {
    // Models introduce their answers however they like; the plan is still in there.
    expect(parsePlan(`Sure! ${json} Hope that helps.`)).toMatchObject({ id: 'x' });
  });

  it('returns null rather than half a plan', () => {
    expect(parsePlan('{"beats": [ oops')).toBeNull();
    expect(parsePlan('no json here at all')).toBeNull();
  });
});
