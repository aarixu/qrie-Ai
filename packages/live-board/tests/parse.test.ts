import { describe, expect, it } from 'vitest';
// Through the package name, so the vitest alias the app will use is exercised too.
import { boardStrings, LIMITS, parseBoardOps, type BoardOp } from '@ai-tutor/live-board';

/**
 * parseBoardOps — T2.1's acceptance, as behaviour:
 *
 *   "Unknown ops and ids are dropped; text and op count are capped; malformed
 *    JSON never throws; ids are namespaced."
 *
 * Plus the invariant the whole canvas protocol rests on: no coordinate ever
 * comes from a model. Every test hands the parser what a model could really
 * send — a string, a fenced block, an object with extra keys — because the
 * parser's whole job is to stand between that and the board.
 */

const onScreen = new Set(['b3_2', 'b3_4', 'b1_0']);
const parse = (json: unknown, ids: ReadonlySet<string> = onScreen, turn = 1) =>
  parseBoardOps(json, ids, { turn });
const ops = (json: unknown, ids: ReadonlySet<string> = onScreen) =>
  parse(json, ids).steps.flatMap((s) => s.ink);

describe('parseBoardOps: never throws, whatever it is handed', () => {
  const junk: unknown[] = [
    undefined,
    null,
    42,
    true,
    '',
    'not json at all',
    '{"steps": [',
    '[1, 2, 3]',
    [null, 7, 'x', [1]],
    { steps: 'nope' },
    { steps: [{ say: 5, ink: 'write' }] },
    { steps: [{ say: 'hi', ink: [null, 3, 'write', { op: 42 }, { op: 'write' }, { op: 'write', text: 7 }] }] },
    { nothing: true },
  ];

  it.each(junk.map((j) => [JSON.stringify(j) ?? String(j), j]))('%s', (_label, j) => {
    expect(() => parse(j)).not.toThrow();
    const out = parse(j);
    expect(Array.isArray(out.steps)).toBe(true);
    expect(Array.isArray(out.dropped)).toBe(true);
  });

  it('reports malformed JSON as dropped, with no steps', () => {
    const out = parse('{"steps": [ {"say": "hi"');
    expect(out.steps).toEqual([]);
    expect(out.dropped).toEqual([{ at: '$', reason: expect.stringMatching(/not JSON/i) }]);
  });
});

describe('parseBoardOps: the shapes a model actually sends', () => {
  const turn = [{ say: 'Open the bracket.', ink: [{ op: 'equation', text: '21 - 14y - 15y = 2' }] }];

  it('reads an array of steps, a { steps } object, a JSON string and a fenced JSON block alike', () => {
    const want = [{ say: 'Open the bracket.', ink: [{ op: 'equation', id: 'live1_0', text: '21 - 14y - 15y = 2' }] }];
    expect(parse(turn).steps).toEqual(want);
    expect(parse({ steps: turn }).steps).toEqual(want);
    expect(parse(JSON.stringify({ steps: turn })).steps).toEqual(want);
    expect(parse('```json\n' + JSON.stringify(turn) + '\n```').steps).toEqual(want);
  });

  it('keeps a step that only speaks, and drops one with nothing to say or write', () => {
    const out = parse([{ say: 'Good question.' }, { say: '   ', ink: [] }, {}]);
    expect(out.steps).toEqual([{ say: 'Good question.', ink: [] }]);
    expect(out.dropped.map((d) => d.at)).toEqual(['steps[1]', 'steps[2]']);
  });

  it('keeps ink whose step says nothing, as silent ink', () => {
    expect(parse([{ ink: [{ op: 'write', text: 'x = 1' }] }]).steps).toEqual([
      { say: '', ink: [{ op: 'write', id: 'live1_0', text: 'x = 1' }] },
    ]);
  });
});

describe('parseBoardOps: the closed op list', () => {
  it('drops an op it does not know, naming it, and keeps the rest of the turn', () => {
    const out = parse([
      { say: 'a', ink: [{ op: 'erase', id: 'b3_2' }, { op: 'write', text: 'kept' }, { op: 'svg', markup: '<svg/>' }] },
    ]);
    expect(out.steps[0].ink).toEqual([{ op: 'write', id: 'live1_0', text: 'kept' }]);
    expect(out.dropped).toEqual([
      { at: 'steps[0].ink[0]', reason: expect.stringContaining('erase') },
      { at: 'steps[0].ink[2]', reason: expect.stringContaining('svg') },
    ]);
  });

  it('parses every op in the vocabulary', () => {
    const got = ops([
      {
        say: 'All of them.',
        ink: [
          { op: 'write', text: 'A line' },
          { op: 'equation', text: 'x + 2y = 3' },
          { op: 'note', text: 'Watch the sign.', tone: 'bad' },
          { op: 'list', heading: 'Steps', items: ['Express', { term: 'Substitute', meaning: 'into the other one' }] },
          { op: 'card', title: 'Golden rule', body: 'Use the other equation.' },
          { op: 'work', steps: [{ say: 'First', line: '7(3 - 2y) = 21 - 14y' }] },
          { op: 'mark', targetId: 'b3_2', shape: 'circle', span: '7(3 - 2y)' },
          { op: 'arrow', fromId: 'b3_2', toId: 'b3_4', label: 'expand' },
          { op: 'point', ids: ['b3_2'] },
          { op: 'recall', beatId: 'b2_4' },
          { op: 'newPage' },
        ],
      },
    ]);
    expect(got.map((o) => o.op)).toEqual([
      'write',
      'equation',
      'note',
      'list',
      'card',
      'work',
      'mark',
      'arrow',
      'point',
      'recall',
      'newPage',
    ]);
    expect(got[3]).toEqual({
      op: 'list',
      id: 'live1_3',
      heading: 'Steps',
      items: [{ term: 'Express' }, { term: 'Substitute', meaning: 'into the other one' }],
    });
    expect(got[5]).toEqual({
      op: 'work',
      id: 'live1_5',
      steps: [{ id: 'live1_5_s0', say: 'First', line: '7(3 - 2y) = 21 - 14y' }],
    });
  });
});

describe('parseBoardOps: no coordinate ever comes from a model', () => {
  it('throws away position and size on every op, keeping only the fields the format names', () => {
    const got = ops([
      {
        say: 'Here.',
        ink: [
          { op: 'write', text: 'x = 1', x: 10, y: 20, w: 300, h: 40, size: 90, after: 5 },
          { op: 'note', text: 'n', x: 1, y: 2, w: 3 },
          { op: 'mark', targetId: 'b3_2', shape: 'circle', x: 0, y: 0, w: 5000, h: 5000 },
          { op: 'arrow', fromId: 'b3_2', toId: 'b3_4', from: { x: 0, y: 0 }, to: { x: 9, y: 9 } },
        ],
      },
    ]);
    expect(got).toEqual([
      { op: 'write', id: 'live1_0', text: 'x = 1' },
      { op: 'note', id: 'live1_1', text: 'n' },
      { op: 'mark', id: 'live1_2', targetId: 'b3_2', shape: 'circle' },
      { op: 'arrow', id: 'live1_3', fromId: 'b3_2', toId: 'b3_4' },
    ]);
    for (const op of got) {
      for (const key of ['x', 'y', 'w', 'h', 'from', 'to', 'size', 'after']) expect(op).not.toHaveProperty(key);
    }
  });
});

describe('parseBoardOps: ids', () => {
  it('mints every id as live<n>_<k>, whatever the model called the ink', () => {
    const got = parse([{ say: 'a', ink: [{ op: 'write', id: 'my line', text: 'one' }, { op: 'equation', id: 'b3_9', text: 'x = 2' }] }], onScreen, 4)
      .steps[0].ink;
    expect(got.map((o) => ('id' in o ? o.id : null))).toEqual(['live4_0', 'live4_1']);
  });

  it('takes the turn number from the live ids already on screen when none is given', () => {
    const ids = new Set(['b3_2', 'live2_0', 'live2_3_s1', 'live1_0']);
    const got = parseBoardOps([{ say: 'a', ink: [{ op: 'write', text: 'x' }] }], ids).steps[0].ink[0];
    expect(got).toEqual({ op: 'write', id: 'live3_0', text: 'x' });
    expect(parseBoardOps([{ say: 'a', ink: [{ op: 'write', text: 'x' }] }], new Set()).steps[0].ink[0]).toEqual({
      op: 'write',
      id: 'live1_0',
      text: 'x',
    });
  });

  it("resolves the model's own name to the minted id for later ops in the same turn", () => {
    const got = ops([
      { say: 'Write it.', ink: [{ op: 'equation', id: 'e1', text: '21 - 29y = 2' }] },
      {
        say: 'Now look here.',
        ink: [
          { op: 'mark', targetId: 'e1', shape: 'underline' },
          { op: 'arrow', fromId: 'b3_2', toId: 'e1' },
          { op: 'point', ids: ['e1', 'b3_4'] },
        ],
      },
    ]);
    expect(got).toEqual([
      { op: 'equation', id: 'live1_0', text: '21 - 29y = 2' },
      { op: 'mark', id: 'live1_1', targetId: 'live1_0', shape: 'underline' },
      { op: 'arrow', id: 'live1_2', fromId: 'b3_2', toId: 'live1_0' },
      { op: 'point', ids: ['live1_0', 'b3_4'] },
    ]);
  });

  it('names a line of working by its own id', () => {
    const got = ops([
      {
        say: 'Work.',
        ink: [
          { op: 'work', steps: [{ say: 'a', line: 'x = 1' }, { say: 'b', line: 'y = 2', id: 'yline' }] },
          { op: 'mark', targetId: 'yline', shape: 'tick' },
        ],
      },
    ]);
    expect(got[1]).toEqual({ op: 'mark', id: 'live1_1', targetId: 'live1_0_s1', shape: 'tick' });
  });

  it('drops a reference to an id that is neither on screen nor written earlier in the turn', () => {
    const out = parse([
      {
        say: 'a',
        ink: [
          { op: 'mark', targetId: 'later', shape: 'circle' },
          { op: 'write', id: 'later', text: 'too late' },
          { op: 'mark', targetId: 'b9_9', shape: 'circle' },
          { op: 'arrow', fromId: 'b3_2', toId: 'nowhere' },
        ],
      },
    ]);
    expect(out.steps[0].ink.map((o) => o.op)).toEqual(['write']);
    expect(out.dropped.map((d) => d.at)).toEqual(['steps[0].ink[0]', 'steps[0].ink[2]', 'steps[0].ink[3]']);
    for (const d of out.dropped) expect(d.reason).toMatch(/not on screen/);
  });

  it('never lets a model name shadow an id already on screen', () => {
    const got = ops([
      {
        say: 'a',
        ink: [
          { op: 'write', id: 'b3_2', text: 'an impostor' },
          { op: 'mark', targetId: 'b3_2', shape: 'circle' },
        ],
      },
    ]);
    // The mark goes to the REAL b3_2, the one the student can see.
    expect(got[1]).toEqual({ op: 'mark', id: 'live1_1', targetId: 'b3_2', shape: 'circle' });
  });

  it('drops a reference to ink that was itself dropped', () => {
    const out = parse([
      {
        say: 'a',
        ink: [
          { op: 'write', id: 'long', text: 'x'.repeat(LIMITS.line + 1) },
          { op: 'mark', targetId: 'long', shape: 'circle' },
        ],
      },
    ]);
    expect(out.steps).toEqual([{ say: 'a', ink: [] }]);
    expect(out.dropped).toHaveLength(2);
  });
});

describe('parseBoardOps: caps', () => {
  it('drops a line over the cap instead of cutting it, and keeps one exactly at it', () => {
    const at = 'y'.repeat(LIMITS.line);
    const over = 'x = 3 - 2(19/29) = ' + '1'.repeat(LIMITS.line);
    const out = parse([{ say: 'a', ink: [{ op: 'equation', text: at }, { op: 'equation', text: over }] }]);
    expect(out.steps[0].ink).toEqual([{ op: 'equation', id: 'live1_0', text: at }]);
    expect(out.dropped).toEqual([{ at: 'steps[0].ink[1]', reason: expect.stringMatching(/160/) }]);
    // Nothing anywhere carries a shortened copy of the long line.
    expect(JSON.stringify(out.steps)).not.toContain('x = 3 - 2(19/29)');
  });

  it(`keeps at most ${LIMITS.ops} ops in a turn`, () => {
    const many = Array.from({ length: 14 }, (_, n) => ({ op: 'write', text: `line ${n}` }));
    const out = parse([{ say: 'a', ink: many.slice(0, 7) }, { say: 'b', ink: many.slice(7) }]);
    expect(out.steps.flatMap((s) => s.ink)).toHaveLength(LIMITS.ops);
    expect(out.dropped.map((d) => d.at)).toEqual(['steps[1].ink[5]', 'steps[1].ink[6]']);
    expect(out.dropped[0].reason).toMatch(/12/);
  });

  it('counts every line of a worked solution, and never keeps half of one', () => {
    const work = { op: 'work', steps: Array.from({ length: 8 }, (_, n) => ({ say: `s${n}`, line: `x = ${n}` })) };
    const writes = Array.from({ length: 5 }, (_, n) => ({ op: 'write', text: `w${n}` }));
    const got = ops([{ say: 'a', ink: [...writes, work] }]);
    expect(got.map((o) => o.op)).toEqual(['write', 'write', 'write', 'write', 'write']);
  });

  it(`keeps at most ${LIMITS.steps} steps`, () => {
    const out = parse(Array.from({ length: 10 }, (_, n) => ({ say: `line ${n}` })));
    expect(out.steps).toHaveLength(LIMITS.steps);
    expect(out.dropped.map((d) => d.at)).toEqual(['steps[8]', 'steps[9]']);
  });

  it('drops a step whose sentence is over the cap, with its ink', () => {
    const out = parse([{ say: 'w '.repeat(LIMITS.say), ink: [{ op: 'write', text: 'x' }] }, { say: 'ok' }]);
    expect(out.steps).toEqual([{ say: 'ok', ink: [] }]);
  });

  it('caps lists, working and pointing', () => {
    const got = parse([
      {
        say: 'a',
        ink: [
          { op: 'list', items: Array.from({ length: LIMITS.listItems + 1 }, (_, n) => `item ${n}`) },
          { op: 'work', steps: Array.from({ length: LIMITS.workLines + 1 }, (_, n) => ({ say: '', line: `x = ${n}` })) },
          { op: 'point', ids: ['b3_2', 'b3_4', 'b1_0', 'b3_2', 'b3_4'] },
        ],
      },
    ]);
    expect(got.steps[0].ink).toEqual([{ op: 'point', ids: ['b3_2', 'b3_4', 'b1_0'] }]);
    expect(got.dropped).toHaveLength(2);
  });
});

describe('parseBoardOps: cleaning', () => {
  it('trims, collapses whitespace on a line, strips control characters, and keeps paragraphs in a note', () => {
    const got = ops([
      {
        say: '  Look\n here. ',
        ink: [
          { op: 'write', text: '  x  +\t2y\n= 3 \u0007' },
          { op: 'note', text: 'First.\n\nSecond\u0000.' },
        ],
      },
    ]);
    expect(got).toEqual([
      { op: 'write', id: 'live1_0', text: 'x + 2y = 3' },
      { op: 'note', id: 'live1_1', text: 'First.\n\nSecond.' },
    ]);
    expect(parse([{ say: '  Look\n here. ' }]).steps[0].say).toBe('Look here.');
  });

  it('drops an op whose text is empty once cleaned', () => {
    const out = parse([{ say: 'a', ink: [{ op: 'write', text: ' \n\t ' }, { op: 'card', title: 'T', body: '' }] }]);
    expect(out.steps[0].ink).toEqual([]);
    expect(out.dropped).toHaveLength(2);
  });

  it('keeps a note without a tone it cannot draw, and a mark only with a shape it can', () => {
    const got = ops([
      {
        say: 'a',
        ink: [
          { op: 'note', text: 'n', tone: '#ff0000' },
          { op: 'mark', targetId: 'b3_2', shape: 'star' },
          { op: 'mark', targetId: 'b3_2', shape: 'box' },
        ],
      },
    ]);
    expect(got).toEqual([
      { op: 'note', id: 'live1_0', text: 'n' },
      { op: 'mark', id: 'live1_1', targetId: 'b3_2', shape: 'box' },
    ]);
  });

  it('drops an arrow from a thing to itself, and a point at nothing on screen', () => {
    const out = parse([{ say: 'a', ink: [{ op: 'arrow', fromId: 'b3_2', toId: 'b3_2' }, { op: 'point', ids: ['zz'] }] }]);
    expect(out.steps[0].ink).toEqual([]);
    expect(out.dropped).toHaveLength(2);
  });

  it('checks a recall against the beats, when the beats are given', () => {
    const beats = new Set(['b2_4']);
    const out = parseBoardOps(
      [{ say: 'a', ink: [{ op: 'recall', beatId: 'b2_4' }, { op: 'recall', beatId: 'b7' }, { op: 'recall' }] }],
      onScreen,
      { turn: 1, beatIds: beats },
    );
    expect(out.steps[0].ink).toEqual([{ op: 'recall', beatId: 'b2_4' }]);
    expect(out.dropped).toHaveLength(2);
  });
});

describe('boardStrings: every string a child could hear or see, for the safety screen', () => {
  it('returns every sentence and every piece of ink text in the turn, and no ids', () => {
    const { steps } = parse([
      {
        say: 'S-say',
        ink: [
          { op: 'write', text: 'S-write' },
          { op: 'equation', text: 'S-equation' },
          { op: 'note', text: 'S-note' },
          { op: 'list', heading: 'S-heading', items: ['S-term', { term: 'S-term2', meaning: 'S-meaning' }] },
          { op: 'card', title: 'S-title', body: 'S-body' },
          { op: 'work', steps: [{ say: 'S-worksay', line: 'S-workline' }] },
          { op: 'arrow', fromId: 'b3_2', toId: 'b3_4', label: 'S-label' },
          { op: 'mark', targetId: 'b3_2', shape: 'circle', span: '7(3' },
        ],
      },
    ]);
    const strings = boardStrings(steps);
    for (const s of [
      'S-say',
      'S-write',
      'S-equation',
      'S-note',
      'S-heading',
      'S-term',
      'S-term2',
      'S-meaning',
      'S-title',
      'S-body',
      'S-worksay',
      'S-workline',
      'S-label',
    ]) {
      expect(strings).toContain(s);
    }
    expect(strings.some((s) => s.startsWith('live1_') || s === 'b3_2')).toBe(false);
  });

  it('covers a string field added to an op later, because it walks the op rather than listing fields', () => {
    const future = [{ say: 'x', ink: [{ op: 'write', id: 'live1_0', text: 't', caption: 'S-new-field' } as unknown as BoardOp] }];
    expect(boardStrings(future)).toContain('S-new-field');
  });
});
