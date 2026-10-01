import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { prepareClass, rekeep, type LlmAdapter } from '../src/prepare';
import type { Blueprint, PrepResult, Replay } from '../src/types';

/**
 * A CLASS REFUSED FOR ITS LAYOUT IS LAID OUT AGAIN FOR NOTHING (canvas C0,
 * item 2). Everything expensive in it — the plan, the review, the pictures —
 * was paid for once; `rekeep` lays the same plan out again with today's
 * engine, from what prepareClass recorded (`replay`), and calls no model.
 */

const plan: Blueprint = {
  id: 'evap',
  title: 'Evaporation',
  visuals: [],
  beats: [
    {
      id: 'b1',
      topic: 'Wet clothes',
      narration: '',
      board: [
        { do: 'title', text: 'Evaporation' },
        { do: 'say', text: 'Wet clothes dry on a line.' },
        { do: 'write', text: 'Water turns into vapour at any temperature' },
        { do: 'say', text: 'So where did the water go?' },
        { do: 'ask', question: 'So where did the water go?', expect: 'into the air as vapour', hint: 'What is in the air around you?' },
        { do: 'say', text: 'Into the air, as vapour.' },
        { do: 'write', text: 'Evaporation happens at the surface' },
      ],
    },
  ],
};

const counting = (reply: string): LlmAdapter & { calls: number } => {
  const llm = {
    calls: 0,
    complete: async () => {
      llm.calls += 1;
      return reply;
    },
  };
  return llm;
};

async function prepared(): Promise<PrepResult & { replay: Replay }> {
  const made = await prepareClass({ topic: 'Evaporation', klass: 9, planner: counting(JSON.stringify(plan)), artist: counting('<svg/>') });
  if (!made.replay) throw new Error('prepareClass recorded no replay');
  return made as PrepResult & { replay: Replay };
}

describe('rekeep', () => {
  it('records what the kept copy was laid out from, as plain JSON', async () => {
    const made = await prepared();
    expect(made.replay.blueprint.beats.map((b) => b.id)).toEqual(['b1']);
    expect(JSON.parse(JSON.stringify(made.replay))).toEqual(made.replay);
  });

  it('lays the same class out again, calls no model, and finds nothing to refuse', async () => {
    const made = await prepared();
    const before = JSON.stringify(made.lesson);
    // No adapter is passed at all: there is nothing it could call.
    const again = rekeep(JSON.parse(JSON.stringify(made)));
    expect(again.problems).toEqual([]);
    expect(again.made.report.gate?.problems).toEqual([]);
    expect(JSON.stringify(again.made.lesson)).toBe(before);
    expect(again.made.report.issues.at(-1)).toMatch(/Laid out again/);
  });

  it('returns the keep gate’s problems when today’s layout still refuses it', async () => {
    const made = await prepared();
    // A beat that asks and then writes with no line after it: the gate's `unspoken`.
    const broken = JSON.parse(JSON.stringify(made)) as PrepResult & { replay: Replay };
    broken.replay.blueprint.beats[0].board.push({ do: 'ask', question: 'Why does it cool?' }, { do: 'write', text: 'Late ink' });
    const again = rekeep(broken);
    expect(again.problems.map((p) => p.rule)).toContain('unspoken');
    expect((again.made.lesson as Lesson).id).toBe(made.lesson.id);
  });
});
