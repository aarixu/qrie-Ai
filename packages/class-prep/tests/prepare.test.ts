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
    // A later beat looking at the same picture gets its own copy, sharing the
    // one drawing rather than paying for a second.
    expect(Object.keys(result.assets)).toEqual(['d_graph', 'd_graph@b3']);
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

describe('what the planner forgets that is not worth asking it again for', () => {
  // A repair round is a whole model call — three seconds of a student sitting
  // in front of a blank board — and it is being spent on a label we already
  // know. The title fill was the first of these; the beat's topic is the
  // other one that keeps happening.
  const noTopic = {
    ...blueprint,
    beats: [{ id: 'b1', narration: 'Here we go.', board: [{ do: 'title', text: 'Speed' }] }],
  };

  it('fills in a beat with no topic instead of paying for a repair round', async () => {
    let calls = 0;
    const planner: LlmAdapter = {
      complete: async () => {
        calls += 1;
        return JSON.stringify(noTopic);
      },
    };

    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner,
      artist: fakeArtist([svg(['axes', 'line_fast'])]),
    });

    expect(calls).toBe(1);
    expect(result.lesson.beats[0].topic).toBe('Speed');
    expect(result.report.issues.join(' ')).not.toContain('repaired');
  });

  it('leaves a topic the planner did write alone', async () => {
    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner: fakePlanner(blueprint),
      artist: fakeArtist([svg(['axes', 'line_fast'])]),
    });
    expect(result.lesson.beats.map((b) => b.topic)).toContain('graph');
  });
});

describe('the shape of a picture reaches the board', () => {
  // Measured where the picture is made, used where it is placed. Anywhere it
  // is dropped on the way, the board goes back to marking parts of a box
  // instead of parts of a picture.
  const png = (w: number, h: number): string => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    bytes.set([73, 72, 68, 82], 12);
    view.setUint32(16, w);
    view.setUint32(20, h);
    return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
  };

  const withPicture: Blueprint = {
    id: 'heart',
    title: 'The Heart',
    beats: [
      {
        id: 'b1',
        topic: 'chambers',
        narration: 'Look at the apex.',
        board: [
          { do: 'picture', ref: 'heart_pic' },
          { do: 'label', target: 'heart_pic#apex', text: 'Apex' },
          { do: 'write', text: 'The apex is the tip of the left ventricle' },
        ],
      },
    ],
    visuals: [
      {
        id: 'heart_pic',
        medium: 'picture',
        parts: ['apex'],
        brief: 'a human heart cut open',
        alt: 'a human heart',
      },
    ],
  };

  it('places a square picture in a square box', async () => {
    const result = await prepareClass({
      topic: 'The Heart',
      klass: 9,
      planner: fakePlanner(withPicture),
      artist: fakeArtist(['']),
      imageArtist: { draw: async () => png(1024, 1024) },
      eyes: { look: async () => '{"_count":1,"apex":{"x":0.1,"y":0.6,"w":0.2,"h":0.2}}' },
    });
    const image = result.lesson.elements.find((el) => el.kind === 'image') as Extract<
      Element,
      { kind: 'image' }
    >;
    expect(image).toBeDefined();
    expect(image.w).toBeCloseTo(image.h, 0);
  });

  it('leaves a picture whose shape could not be read filling its room', async () => {
    const result = await prepareClass({
      topic: 'The Heart',
      klass: 9,
      planner: fakePlanner(withPicture),
      artist: fakeArtist(['']),
      imageArtist: { draw: async () => 'data:image/webp;base64,AAAA' },
      eyes: { look: async () => '{"_count":1,"apex":{"x":0.1,"y":0.6,"w":0.2,"h":0.2}}' },
    });
    const image = result.lesson.elements.find((el) => el.kind === 'image') as Extract<
      Element,
      { kind: 'image' }
    >;
    expect(image.w).toBeGreaterThan(image.h);
  });
});

describe('a question she asks reaches the board, or the repair round hears about it', () => {
  const asking: Blueprint = {
    ...blueprint,
    beats: [
      {
        id: 'q1',
        topic: 'spaces',
        narration: '',
        board: [
          { do: 'say', text: 'Where did the sugar go?' },
          { do: 'write', text: 'Observation: the level did not rise' },
          { do: 'say', text: 'It slips into the spaces between particles.' },
          { do: 'write', text: 'Particles have spaces between them' },
        ],
      },
    ],
    visuals: [],
  };
  const fixedBeats: Blueprint = {
    ...asking,
    beats: [
      {
        ...asking.beats[0],
        board: [
          { do: 'say', text: 'Where did the sugar go?' },
          { do: 'write', text: 'Where did the sugar go?' },
          { do: 'say', text: 'It slips into the spaces between particles.' },
          { do: 'write', text: 'Particles have spaces between them' },
        ],
      },
    ],
  };

  it('sends the unwritten question to the one repair round, and takes the fix', async () => {
    const seen: string[] = [];
    let calls = 0;
    const planner: LlmAdapter = {
      complete: async (_s, user) => {
        seen.push(user);
        calls += 1;
        return JSON.stringify(calls === 1 ? asking : fixedBeats);
      },
    };
    const result = await prepareClass({ topic: 'Matter', klass: 9, planner, artist: fakeArtist(['']) });
    expect(calls).toBe(2);
    expect(seen[1]).toMatch(/asks a question/);
    expect(result.report.issues.join(' ')).toContain('repaired and passed');
    expect(result.report.issues.join(' ')).not.toContain('Still unwritten');
  });

  it('still holds the class when the repair does not fix it — reported, never fatal', async () => {
    const planner: LlmAdapter = { complete: async () => JSON.stringify(asking) };
    const result = await prepareClass({ topic: 'Matter', klass: 9, planner, artist: fakeArtist(['']) });
    // A class with one unwritten question is a worse class, not no class.
    expect(result.lesson.beats.length).toBeGreaterThan(0);
    expect(result.report.issues.join(' ')).toContain('Still unwritten');
  });
});

describe('the question rides the split to the moment that asks it', () => {
  /**
   * A planner beat becomes several lesson beats — one per spoken line. The ask
   * has to land on exactly the lesson beat whose line asks it, because that is
   * the beat the player will refuse to advance past.
   */
  const asking: Blueprint = {
    ...blueprint,
    beats: [
      {
        id: 'q1',
        topic: 'spaces',
        narration: '',
        board: [
          { do: 'say', text: 'Watch the level as the sugar stirs in.' },
          { do: 'write', text: 'Observation: the level does not rise' },
          { do: 'say', text: 'So where did the sugar go?' },
          {
            do: 'ask',
            question: 'Where did the sugar go?',
            options: [
              { text: 'It melted into liquid', why: 'Melting would still add volume.' },
              { text: 'It slipped into the spaces', correct: true, why: 'The gaps hold it.' },
            ],
          },
          { do: 'say', text: 'Exactly — the gaps between particles hold it.' },
          { do: 'write', text: 'Particles have spaces between them' },
        ],
      },
    ],
    visuals: [],
  };

  it('pins the ask on the asking beat, and only that one', async () => {
    const result = await prepareClass({
      topic: 'Matter',
      klass: 9,
      planner: fakePlanner(asking),
      artist: fakeArtist(['']),
    });
    const withAsk = result.lesson.beats.filter((b) => b.ask !== undefined);
    expect(withAsk).toHaveLength(1);
    expect(withAsk[0].ask!.question).toBe('Where did the sugar go?');
    expect(withAsk[0].narration).toBe('So where did the sugar go?');
    expect(withAsk[0].ask!.options![1].correct).toBe(true);
  });
});
