import { describe, expect, it } from 'vitest';
import { validateLesson } from '@ai-tutor/lesson-format';
import { capChecks, dropBadProbes, prepareClass } from '../src/prepare';
import { PLANNER_SYSTEM } from '../src/prompts';
import type { Blueprint } from '../src/types';

/**
 * The whyProbe has to SURVIVE assembly to exist at all: the layout engine
 * copies an ask field by field (board-layout/src/layout.ts:389-396) and has
 * never heard of whyProbe, so without re-attachment in class-prep the planner
 * would author judgement that silently never reaches the lesson — the exact
 * kind of gap that reads as working because the prompt asks for it.
 */

const probe = {
  askedAs: 'open' as const,
  options: [
    { text: 'it dissolved into the water', correct: true, why: 'Right — the particles slipped into the spaces between water particles.' },
    { text: 'the sugar melted', why: 'Melting needs heat and makes a liquid of the SAME thing; this sugar is now inside the water.' },
  ],
};

const blueprint: Blueprint = {
  id: 'demo',
  title: 'Dissolving',
  beats: [
    {
      id: 'b1',
      topic: 'open',
      narration: '',
      checks: ['lo-a', 'lo-b', 'lo-c'],
      board: [
        { do: 'say', text: 'Hello!' },
        { do: 'title', text: 'Dissolving' },
        { do: 'say', text: 'Where did the sugar go?' },
        { do: 'write', text: 'Where did the sugar go?' },
        {
          do: 'ask',
          question: 'Where did the sugar go?',
          expect: 'it dissolved',
          hint: 'Is it gone, or just invisible?',
          whyProbe: probe,
        } as Blueprint['beats'][number]['board'][number],
        { do: 'write', text: 'Sugar dissolves — it is still there' },
      ],
    },
  ],
  visuals: [],
};

const outcomes = [
  { id: 'lo-a', statement: 'a' },
  { id: 'lo-b', statement: 'b' },
  { id: 'lo-c', statement: 'c' },
];

describe('whyProbe survives assembly', () => {
  it('reaches the lesson beat the ask lands on, and the lesson still validates', async () => {
    const result = await prepareClass({
      topic: 'Dissolving',
      klass: 9,
      planner: { complete: async () => JSON.stringify(blueprint) },
      artist: { complete: async () => '' },
      outcomes,
    });
    const asking = result.lesson.beats.find((b) => b.ask);
    expect(asking).toBeDefined();
    expect(asking!.ask!.whyProbe).toEqual(probe);
    expect(validateLesson(result.lesson).ok).toBe(true);
  });
});

describe('capChecks — the deterministic half of the PRD-4 req-2 cap', () => {
  it('trims an ask beat to its first two checks and counts the cut', () => {
    const beats = [
      {
        id: 'b1',
        topic: 't',
        narration: '',
        checks: ['lo-a', 'lo-b', 'lo-c'],
        board: [{ do: 'ask' as const, question: 'Q?' }],
      },
    ];
    expect(capChecks(beats)).toBe(1);
    expect(beats[0].checks).toEqual(['lo-a', 'lo-b']);
  });

  it('leaves an askless beat alone — the cap is about what one answer is evidence for', () => {
    const beats = [
      { id: 'b1', topic: 't', narration: '', checks: ['lo-a', 'lo-b', 'lo-c'], board: [] },
    ];
    expect(capChecks(beats)).toBe(0);
    expect(beats[0].checks).toEqual(['lo-a', 'lo-b', 'lo-c']);
  });

  it('is applied by prepareClass, and the report says so', async () => {
    const result = await prepareClass({
      topic: 'Dissolving',
      klass: 9,
      planner: { complete: async () => JSON.stringify(blueprint) },
      artist: { complete: async () => '' },
      outcomes,
    });
    const checked = result.lesson.beats.find((b) => b.checks);
    expect(checked!.checks).toEqual(['lo-a', 'lo-b']);
    expect(result.report.issues.some((i) => /at most two|capped/i.test(i))).toBe(true);
  });
});

describe('the prompt teaches the whyProbe without undoing the no-options rule', () => {
  it('asks for a whyProbe on every ask, as spoken judgement rather than a shown list', () => {
    expect(PLANNER_SYSTEM).toContain('whyProbe');
    // The pedagogy decision stays visible: the no-options rule for the
    // on-screen ask survives in the same prompt that asks for the probe.
    expect(PLANNER_SYSTEM).toMatch(/NO OPTIONS, as a rule/);
    expect(PLANNER_SYSTEM).toMatch(/misconception/i);
  });

  it('states the checks cap the validator now enforces', () => {
    expect(PLANNER_SYSTEM).toMatch(/at most two|AT MOST TWO/i);
  });
});

/**
 * A MIS-SHAPED PROBE IS ONE BAD FIELD, NOT A BAD CLASS.
 *
 * `validateLesson` is strict about a whyProbe on purpose — hand-authored
 * content should fail loudly. But the planner is now asked for one on EVERY
 * ask, nothing plays it until MVP-2, and a model that marks two options
 * correct would otherwise cost a child the whole class after one wasted
 * repair round. Same posture as `dropInventedOutcomes` and `capChecks`:
 * trim deterministically and report it.
 */
describe('dropBadProbes — degrade to no probe, never to no class', () => {
  const askWith = (whyProbe: unknown) => ({
    id: 'b1',
    topic: 't',
    narration: '',
    board: [{ do: 'ask' as const, question: 'Q?', whyProbe }],
  });

  it('drops a probe with two right answers', () => {
    const beats = [
      askWith({
        askedAs: 'open',
        options: [
          { text: 'a', correct: true, why: 'x' },
          { text: 'b', correct: true, why: 'y' },
        ],
      }),
    ];
    expect(dropBadProbes(beats)).toBe(1);
    expect(beats[0].board[0].whyProbe).toBeUndefined();
  });

  it('drops a probe whose option has no why — she would have nothing to say', () => {
    const beats = [
      askWith({
        askedAs: 'open',
        options: [{ text: 'a', correct: true, why: 'x' }, { text: 'b' }],
      }),
    ];
    expect(dropBadProbes(beats)).toBe(1);
  });

  it('drops a probe with five options or with a bad askedAs', () => {
    const five = askWith({
      askedAs: 'open',
      options: [1, 2, 3, 4, 5].map((n) => ({ text: `o${n}`, why: 'w', correct: n === 1 })),
    });
    const askedAs = askWith({
      askedAs: 'quiz',
      options: [
        { text: 'a', correct: true, why: 'x' },
        { text: 'b', why: 'y' },
      ],
    });
    expect(dropBadProbes([five, askedAs])).toBe(2);
  });

  it('keeps a good probe untouched', () => {
    const beats = [askWith(probe)];
    expect(dropBadProbes(beats)).toBe(0);
    expect(beats[0].board[0].whyProbe).toEqual(probe);
  });

  it('is applied by prepareClass: the class is taught, minus the bad probe', async () => {
    const bad = JSON.parse(JSON.stringify(blueprint)) as Blueprint;
    (bad.beats[0].board[4] as { whyProbe?: unknown }).whyProbe = {
      askedAs: 'open',
      options: [
        { text: 'a', correct: true, why: 'x' },
        { text: 'b', correct: true, why: 'y' },
      ],
    };
    const result = await prepareClass({
      topic: 'Dissolving',
      klass: 9,
      planner: { complete: async () => JSON.stringify(bad) },
      artist: { complete: async () => '' },
      outcomes,
    });
    expect(result.lesson.beats.find((b) => b.ask)!.ask!.whyProbe).toBeUndefined();
    expect(result.report.issues.some((i) => /whyProbe/i.test(i))).toBe(true);
  });
});

/**
 * The re-attachment zips the nth ask marker to the nth ask instruction. With
 * one ask on a board that cannot be wrong; with two it can, and getting it
 * wrong speaks the wrong correction to a child in the tutor's own voice.
 */
describe('two asks on one board keep their own judgement', () => {
  const twoAsks: Blueprint = {
    id: 'demo',
    title: 'Dissolving',
    beats: [
      {
        id: 'b1',
        topic: 'open',
        narration: '',
        board: [
          { do: 'title', text: 'Dissolving' },
          { do: 'say', text: 'Question A: where did the sugar go?' },
          { do: 'write', text: 'Question A' },
          {
            do: 'ask',
            question: 'Question A?',
            expect: 'a',
            hint: 'think',
            whyProbe: {
              askedAs: 'open',
              options: [
                { text: 'answer A', correct: true, why: 'A is right because A.' },
                { text: 'not A', why: 'A-wrong, because A.' },
              ],
            },
          },
          { do: 'say', text: 'Question B: what happened to the water level?' },
          { do: 'write', text: 'Question B' },
          {
            do: 'ask',
            question: 'Question B?',
            expect: 'b',
            hint: 'think',
            whyProbe: {
              askedAs: 'open',
              options: [
                { text: 'answer B', correct: true, why: 'B is right because B.' },
                { text: 'not B', why: 'B-wrong, because B.' },
              ],
            },
          },
        ] as Blueprint['beats'][number]['board'],
      },
    ],
    visuals: [],
  };

  it('lands each probe on its own ask, and none of it on the board', async () => {
    const result = await prepareClass({
      topic: 'Dissolving',
      klass: 9,
      planner: { complete: async () => JSON.stringify(twoAsks) },
      artist: { complete: async () => '' },
    });
    const asking = result.lesson.beats.filter((b) => b.ask);
    expect(asking).toHaveLength(2);
    const a = asking.find((b) => b.ask!.question.includes('A'))!;
    const bq = asking.find((b) => b.ask!.question.includes('B'))!;
    expect(a.ask!.whyProbe!.options[0].why).toContain('A is right');
    expect(bq.ask!.whyProbe!.options[0].why).toContain('B is right');
    // The pedagogy promise the whole design rests on: never a visible list.
    expect(JSON.stringify(result.lesson.elements)).not.toContain('is right because');
  });
});
