import { describe, expect, it } from 'vitest';
import { validateLesson } from '@ai-tutor/lesson-format';
import { parsePlan, prepareClass } from '../src/prepare';
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
