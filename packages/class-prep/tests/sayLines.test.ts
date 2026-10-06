import { describe, expect, it } from 'vitest';
import type { Instruction, ScriptBeat } from '@ai-tutor/board-layout';
import { SPOKEN_MS_PER_CHAR, toolDurationMs } from '@ai-tutor/lesson-format';
import { sentencesOf, splitNarrations } from '../src/sayLines';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import type { Blueprint, VisualBrief } from '../src/types';

/**
 * A BEAT WRITTEN AS ONE NARRATION IS WRITTEN AGAIN AS LINES.
 *
 * The first real composed class (small intestine, 2026-10-06) came back with
 * every beat as one `narration` and a board with no `say` in it, though the
 * prompt asks for lines. A beat with no line is one moment: its whole page
 * arrives at once, the camera frames the whole page, and on a phone its writing
 * was 10–11 px. Each sentence becomes a line here, and each thing on the board
 * goes under the sentence that talks about it.
 */

const VILLUS: VisualBrief = {
  id: 'villus',
  medium: 'picture',
  parts: ['microvilli', 'blood capillaries', 'lacteal', 'epithelium'],
  brief: 'A single intestinal villus, cut lengthwise.',
  alt: 'An intestinal villus with its capillaries and lacteal',
};

const villusBeat = (): ScriptBeat => ({
  id: 'b3',
  topic: 'Villi',
  narration:
    'Once food is dissolved into simple units, it must pass through the intestinal wall into our blood. ' +
    'The inner wall is lined with millions of tiny, finger-like projections called villi.\n\n' +
    'Along the outer border, microscopic folds called microvilli enlarge the surface even further. ' +
    'The outer layer is an epithelium just one cell thick, keeping diffusion distances short. ' +
    'Inside each villus runs a network of blood capillaries around a central lacteal.',
  board: [
    { do: 'title', text: 'Structure of a Villus', path: ['Nutrition', 'Villi'] },
    { do: 'picture', ref: 'villus' },
    { do: 'write', text: 'Millions of finger-like projections line the wall' },
    { do: 'label', target: 'villus#microvilli', text: 'Microvilli' },
    { do: 'label', target: 'villus#epithelium', text: 'Single-cell epithelium' },
    { do: 'label', target: 'villus#blood capillaries', text: 'Blood capillaries' },
    { do: 'label', target: 'villus#lacteal', text: 'Central lacteal' },
    { do: 'write', text: 'Each villus holds capillaries and a lacteal' },
    { do: 'summary', text: 'Villi line the intestine to absorb food' },
  ],
});

/** The board as lines: each say with what is written under it. */
const lines = (board: readonly Instruction[]): { said: string; under: string[] }[] => {
  const out: { said: string; under: string[] }[] = [];
  for (const step of board) {
    if (step.do === 'say') out.push({ said: step.text, under: [] });
    else if (out.length > 0) out[out.length - 1].under.push('text' in step ? String(step.text) : step.do);
  }
  return out;
};

describe('sentencesOf', () => {
  it('splits after a full stop, a question or an exclamation, and at a blank line', () => {
    expect(sentencesOf('Speed is 2.5 metres a second. Is that fast?\n\nYes it is quite fast!')).toEqual([
      'Speed is 2.5 metres a second.',
      'Is that fast?',
      'Yes it is quite fast!',
    ]);
  });

  it('does not cut after a title or an abbreviation', () => {
    expect(sentencesOf('Dr. Rao found that villi absorb food, e.g. sugars. They are very tiny.')).toEqual([
      'Dr. Rao found that villi absorb food, e.g. sugars.',
      'They are very tiny.',
    ]);
  });

  it('keeps a greeting with the sentence after it rather than as a line of its own', () => {
    expect(sentencesOf("Hello! What's up — ready?\n\nThink about where the food goes after the stomach.")).toEqual([
      "Hello! What's up — ready?",
      'Think about where the food goes after the stomach.',
    ]);
  });
});

describe('splitNarrations', () => {
  it('writes a narration as its sentences, each thing under the sentence that talks about it', () => {
    const beat = villusBeat();
    expect(splitNarrations([beat], [VILLUS])).toBe(1);
    const got = lines(beat.board);
    expect(got.map((l) => l.said)).toEqual(sentencesOf(villusBeat().narration));
    expect(got.find((l) => l.said.includes('microvilli'))!.under).toContain('Microvilli');
    expect(got.find((l) => l.said.includes('epithelium'))!.under).toContain('Single-cell epithelium');
    const last = got[got.length - 1];
    expect(last.under).toEqual(
      expect.arrayContaining(['Blood capillaries', 'Central lacteal', 'Each villus holds capillaries and a lacteal']),
    );
    expect(got.find((l) => l.said.includes('finger-like'))!.under).toContain(
      'Millions of finger-like projections line the wall',
    );
  });

  it('keeps the title above the first line, and lands the summary on the last', () => {
    const beat = villusBeat();
    splitNarrations([beat], [VILLUS]);
    expect(beat.board[0]).toMatchObject({ do: 'title' });
    expect(beat.board[1]).toMatchObject({ do: 'say' });
    expect(beat.board[beat.board.length - 1]).toMatchObject({ do: 'summary' });
  });

  it('never moves a thing ahead of one the planner wrote before it', () => {
    const beat = villusBeat();
    const order = villusBeat().board.map((s) => JSON.stringify(s));
    splitNarrations([beat], [VILLUS]);
    expect(beat.board.filter((s) => s.do !== 'say').map((s) => JSON.stringify(s))).toEqual(order);
  });

  it('holds the ask on the question, lands the summary before it, and writes what follows it after a later line', () => {
    const beat: ScriptBeat = {
      id: 'b5',
      topic: 'Review',
      narration:
        "Let's put the whole picture together. A smooth tube would absorb slowly, a folded lining fast. " +
        'Why do you think the folds matter so much? After your answer, notice the lining is one cell thick.',
      board: [
        { do: 'compare', left: { heading: 'Smooth wall', points: ['slow', 'small area'] }, right: { heading: 'With villi', points: ['fast', 'huge area'] } },
        { do: 'summary', text: 'Folds give a huge surface' },
        { do: 'ask', question: 'Why do the folds matter so much?', expect: 'more surface area', hint: 'Think about area.' },
        { do: 'write', text: 'Lining one cell thick' },
      ],
    };
    splitNarrations([beat], []);
    const got = lines(beat.board);
    const held = got.findIndex((l) => l.under.includes('ask'));
    expect(got[held].said).toBe('Why do you think the folds matter so much?');
    expect(got.findIndex((l) => l.under.includes('Folds give a huge surface'))).toBe(held - 1);
    expect(got.findIndex((l) => l.under.includes('Lining one cell thick'))).toBe(held + 1);
  });

  it('holds the opening ask on its question, not on a greeting that ends in a question mark', () => {
    const beat: ScriptBeat = {
      id: 'b1',
      topic: 'Opening',
      narration:
        "Hello! What's up — ready? You had lunch a while ago and your stomach churned it into a paste. " +
        'Where do you think that paste goes next?',
      board: [
        { do: 'title', text: 'The Journey of Food' },
        { do: 'place', id: 'stomach', noun: 'stomach', label: 'Stomach' },
        { do: 'ask', question: 'Where does the paste go after the stomach?', expect: 'the small intestine', hint: 'It is a long tube.' },
      ],
    };
    splitNarrations([beat], []);
    const got = lines(beat.board);
    expect(got[got.length - 1]).toEqual({ said: 'Where do you think that paste goes next?', under: ['ask'] });
    expect(got.find((l) => l.said.includes('stomach churned'))!.under).toEqual(['place']);
  });

  it('holds an ask asked in other words on the last line, not on a hook question before the teaching', () => {
    const beat: ScriptBeat = {
      id: 'b2',
      topic: 'Villi',
      narration:
        'Why is the small intestine so long? Its wall is lined with millions of tiny villi. ' +
        'Each villus holds capillaries and a lacteal. So digested food crosses into the blood fast.',
      board: [
        { do: 'list', heading: 'Inside a villus', items: [{ term: 'Capillaries', meaning: 'take sugars' }, { term: 'Lacteal', meaning: 'takes fats' }] },
        { do: 'write', text: 'Millions of tiny villi' },
        { do: 'summary', text: 'Villi pass food into blood' },
        { do: 'ask', question: 'What do the villi absorb?', expect: 'digested food', hint: 'Think of the blood.' },
      ],
    };
    splitNarrations([beat], []);
    const got = lines(beat.board);
    expect(got[got.length - 1].under).toContain('ask');
    expect(got[0].under).toEqual([]);
    expect(got.findIndex((l) => l.under.includes('Villi pass food into blood'))).toBeGreaterThan(0);
  });

  it('gives a moving tool a line as long as it takes to draw', () => {
    const steps = ['2x + 3 = 11', '2x = 8', 'x = 4'];
    const beat: ScriptBeat = {
      id: 'b3',
      topic: 'Solving',
      narration:
        "Let's solve two x plus three equals eleven. Take three away from both sides to leave two x equals eight. " +
        'Then halve both sides and x is four.',
      board: [{ do: 'equationMove', steps } as Instruction, { do: 'write', text: 'Undo each step in turn' }],
    };
    splitNarrations([beat], []);
    const held = lines(beat.board).find((l) => l.under.includes('equationMove'))!;
    expect(held.said.length * SPOKEN_MS_PER_CHAR + 500).toBeGreaterThanOrEqual(toolDurationMs('equationMove', { steps })!);
    expect(beat.board.filter((s) => s.do !== 'say')).toHaveLength(2);
  });

  it('empties the narration it wrote as lines, so the plan says each sentence once', () => {
    const beat = villusBeat();
    splitNarrations([beat], [VILLUS]);
    expect(beat.narration).toBe('');
  });

  it('leaves alone a beat that already speaks in lines, and a narration of one sentence', () => {
    const spoken: ScriptBeat = {
      id: 'b1',
      topic: 't',
      narration: 'One. Two words here. Three more words here.',
      board: [{ do: 'say', text: 'Already a line.' }, { do: 'write', text: 'x' }],
    };
    const one: ScriptBeat = { id: 'b2', topic: 't', narration: 'Only one sentence here.', board: [{ do: 'write', text: 'y' }] };
    expect(splitNarrations([spoken, one], [])).toBe(0);
    expect(spoken.board).toEqual([{ do: 'say', text: 'Already a line.' }, { do: 'write', text: 'x' }]);
    expect(one.board).toEqual([{ do: 'write', text: 'y' }]);
  });
});

describe('prepareClass, given a plan written as narrations', () => {
  const PLAN: Blueprint = {
    id: 'villi',
    title: 'Villi',
    visuals: [],
    beats: [
      {
        id: 'b1',
        topic: 'Villi',
        narration:
          'The inner wall of the small intestine is not smooth. It is lined with millions of tiny finger-like villi. ' +
          'Each villus is covered by a lining just one cell thick. So food crosses into the blood very quickly.',
        board: [
          { do: 'title', text: 'Villi' },
          { do: 'flow', steps: [{ label: 'Food' }, { label: 'Villi' }, { label: 'Blood' }] },
          { do: 'write', text: 'Millions of finger-like villi' },
          { do: 'write', text: 'Lining one cell thick' },
          { do: 'summary', text: 'Villi pass food into blood fast' },
        ],
      },
    ],
  };
  const run = async (composed: boolean) => {
    const planner: LlmAdapter = { complete: async () => JSON.stringify(PLAN) };
    const artist: LlmAdapter = { complete: async () => '' };
    return prepareClass({ topic: 'Villi', klass: 10, planner, artist, composed });
  };

  it('teaches a composed class line by line', async () => {
    const { lesson, report } = await run(true);
    expect(lesson.beats.map((b) => b.narration)).toEqual(sentencesOf(PLAN.beats[0].narration));
    expect(report.issues.some((i) => /as lines/.test(i))).toBe(true);
  });

  it('writes the plan the reviewer had corrected as lines too', async () => {
    const corrected = structuredClone(PLAN);
    corrected.beats[0].narration = PLAN.beats[0].narration.replace('very quickly', 'quickly');
    let plans = 0;
    const planner: LlmAdapter = { complete: async () => JSON.stringify(plans++ === 0 ? PLAN : corrected) };
    const verdicts = [
      JSON.stringify({ ok: false, problems: [{ beatId: 'b1', claim: 'very quickly', why: 'it takes hours' }] }),
      JSON.stringify({ ok: true, problems: [] }),
    ];
    let looked = 0;
    const reviewer: LlmAdapter = { complete: async () => verdicts[Math.min(looked++, 1)] };
    const artist: LlmAdapter = { complete: async () => '' };
    const { lesson, report } = await prepareClass({ topic: 'Villi', klass: 10, planner, artist, reviewer, composed: true });
    expect(report.review).toMatchObject({ repaired: true });
    expect(lesson.beats.map((b) => b.narration)).toEqual(sentencesOf(corrected.beats[0].narration));
  });

  it('leaves a class that is not composed as the planner wrote it', async () => {
    const { lesson } = await run(false);
    expect(lesson.beats).toHaveLength(1);
  });
});
