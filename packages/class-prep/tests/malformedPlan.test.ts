import { describe, expect, it } from 'vitest';
import { validateLesson } from '@ai-tutor/lesson-format';
import { assemble, parsePlan, prepareClass } from '../src/prepare';
import { substitutionAsTaught } from './fixtures/substitution';

/**
 * A PLAN WITH A MISSING FIELD IS NOT A CRASHED CLASS (production probe,
 * 2026-09-29): one preparation in five of a Class 8 topic died with "Cannot
 * read properties of undefined (reading 'trim')" after the planner's first
 * reply — a `say` with no text. A fuzz over every string in a real plan found
 * the same TypeError from a title, a write, a card's heading or body, a list
 * item's term and a caption. The planner is a model; a field it leaves out is
 * an instruction dropped, not a child's class thrown away.
 */
const board = () => substitutionAsTaught().beats.flatMap((b) => b.board);

describe('a plan with an instruction missing its words', () => {
  it('is prepared without it', async () => {
    const plan = substitutionAsTaught() as unknown as { beats: { board: Record<string, unknown>[] }[] };
    const said = plan.beats[0].board.find((s) => s.do === 'say')!;
    delete said.text;
    const card = plan.beats[1].board.find((s) => s.do === 'card');
    if (card) delete card.heading;
    const result = await prepareClass({
      topic: 'Substitution',
      klass: 10,
      planner: { complete: async () => JSON.stringify(plan) },
      artist: { complete: async () => '' },
    });
    expect(validateLesson(result.lesson).ok).toBe(true);
  });

  it('drops exactly the malformed instructions, and a list item without its term', () => {
    const raw = {
      id: 'p',
      title: 'T',
      visuals: [],
      beats: [
        {
          id: 'b1',
          topic: 't',
          board: [
            { do: 'say', text: 'Hello.' },
            { do: 'say' },
            { do: 'write', text: 42 },
            { do: 'title', text: 'Kept' },
            { do: 'list', items: [{ term: 'a', meaning: 'x' }, { meaning: 'no term' }] },
            { do: 'card', heading: 'H' },
            { do: 'ask', written: 'Solve $x + 1 = 2$' },
            { do: 'ask' },
          ],
        },
      ],
    };
    const plan = parsePlan(JSON.stringify(raw))!;
    const kinds = plan.beats[0].board.map((s) => s.do);
    expect(kinds).toEqual(['say', 'title', 'list', 'ask']);
    expect((plan.beats[0].board[2] as { items: unknown[] }).items).toEqual([{ term: 'a', meaning: 'x' }]);
    expect(plan.beats[0].narration).toBe('');
  });

  it('leaves a well-formed plan exactly as it was', () => {
    const plan = substitutionAsTaught();
    expect(parsePlan(JSON.stringify(plan))!.beats.flatMap((b) => b.board)).toEqual(board());
  });
});

type Loose = { beats: { board: Record<string, unknown>[] }[] };
const prepare = (planner: (user: string) => string) =>
  prepareClass({
    topic: 'Substitution',
    klass: 10,
    planner: { complete: async (_system, user) => planner(user) },
    artist: { complete: async () => '' },
  });

/**
 * AN ASK WHOSE ONLY WORDS ARE A BOARD FORM THAT CANNOT BE WRITTEN. `written`
 * with an unclosed $ is deleted by dropBadProbes, so it cannot stand in for a
 * missing question: the layout was left writing `undefined` and preparation
 * died with "Cannot read properties of undefined (reading 'length')".
 */
describe('an ask with no question and a board form that cannot be written', () => {
  it('is dropped, and the class is prepared without it', async () => {
    const plan = substitutionAsTaught() as unknown as Loose;
    const at = plan.beats[0].board.findIndex((s) => s.do === 'ask');
    plan.beats[0].board[at] = { do: 'ask', written: 'If $y = x + 30, what can you do with y in the first equation?' };
    const result = await prepare(() => JSON.stringify(plan));
    expect(validateLesson(result.lesson).ok).toBe(true);
    expect(result.lesson.beats.some((b) => b.id.startsWith('b1') && b.ask)).toBe(false);
  });

  it('is dropped by parsePlan; one with a question, or a closed board form, is kept', () => {
    const plan = parsePlan(
      JSON.stringify({
        id: 'p',
        title: 'T',
        visuals: [],
        beats: [
          {
            id: 'b1',
            topic: 't',
            board: [
              { do: 'ask', written: 'If $y = x + 30, what?' },
              { do: 'ask', written: '   ' },
              { do: 'ask', question: 'What is y?', written: 'If $y = x + 30, what?' },
              { do: 'ask', written: 'Solve $x + 1 = 2$' },
            ],
          },
        ],
      }),
    )!;
    expect(plan.beats[0].board).toEqual([
      { do: 'ask', question: 'What is y?', written: 'If $y = x + 30, what?' },
      { do: 'ask', written: 'Solve $x + 1 = 2$' },
    ]);
  });
});

describe("an ask's options", () => {
  it('keep only the ones that are objects with words', async () => {
    const plan = substitutionAsTaught() as unknown as Loose;
    const ask = plan.beats[1].board.find((s) => s.do === 'ask')!;
    ask.options = [null, 'Equation 3', { correct: false }, { text: '  ' }, { text: 'Equation 1', correct: true }, { text: 'Equation 2' }];
    const result = await prepare(() => JSON.stringify(plan));
    expect(validateLesson(result.lesson).ok).toBe(true);
    const held = result.lesson.beats.find((b) => b.ask?.options);
    expect(held?.ask?.options).toEqual([{ text: 'Equation 1', correct: true }, { text: 'Equation 2' }]);
  });

  it('that are not a list are not options', () => {
    const plan = parsePlan(
      JSON.stringify({ id: 'p', title: 'T', visuals: [], beats: [{ id: 'b1', topic: 't', board: [{ do: 'ask', question: 'Which?', options: 'A or B' }] }] }),
    )!;
    expect(plan.beats[0].board).toEqual([{ do: 'ask', question: 'Which?' }]);
  });

  // One option left is the validator's to name, not the layout's to crash on:
  // the one repair round hears it.
  it('left with one after a null goes, reach the repair round rather than crashing the layout', async () => {
    const bad = substitutionAsTaught() as unknown as Loose;
    const at = bad.beats[1].board.findIndex((s) => s.do === 'ask');
    bad.beats[1].board[at] = { do: 'ask', question: 'Which is right?', options: [null, { text: 'B', correct: true }] };
    const heard: string[] = [];
    const result = await prepare((user) => {
      heard.push(user);
      return JSON.stringify(heard.length === 1 ? bad : substitutionAsTaught());
    });
    expect(heard[1]).toContain('ask options need at least two choices');
    expect(validateLesson(result.lesson).ok).toBe(true);
  });
});

/**
 * A PLACE WITH NO ID IS STILL A THING TO DRAW. The id only matters to a
 * connect or an annotate that names it, and none can name an id that was
 * never written — so the place is kept and given one.
 */
describe('a place with a noun and no id', () => {
  const raw = {
    id: 'p',
    title: 'T',
    visuals: [],
    beats: [
      {
        id: 'b1',
        topic: 't',
        board: [
          { do: 'say', text: 'Two trees, an oak and a water tank.' },
          { do: 'place', noun: 'tree' },
          { do: 'place', noun: 'tree', id: 7 },
          { do: 'place', id: 'tree_1', noun: 'oak' },
          { do: 'place', noun: 'water tank' },
          { do: 'place', id: 'nothing' },
        ],
      },
    ],
  };

  it('is kept with an id of its own, unique in its beat', () => {
    const places = parsePlan(JSON.stringify(raw))!.beats[0].board.filter((s) => s.do === 'place') as {
      id: string;
      noun: string;
    }[];
    expect(places.map((p) => p.noun)).toEqual(['tree', 'tree', 'oak', 'water tank']);
    expect(places.every((p) => typeof p.id === 'string' && p.id.trim() !== '')).toBe(true);
    expect(new Set(places.map((p) => p.id)).size).toBe(places.length);
    // The planner's own id is left as it was.
    expect(places[2].id).toBe('tree_1');
  });

  it('is drawn', () => {
    const { lesson } = assemble(parsePlan(JSON.stringify(raw))!, new Set());
    expect(validateLesson(lesson).ok).toBe(true);
    const drawn = (lesson as { elements: { kind: string; noun?: string }[] }).elements.filter((e) => e.kind === 'graphic');
    expect(drawn.map((e) => e.noun)).toEqual(['tree', 'tree', 'oak', 'water tank']);
  });
});
