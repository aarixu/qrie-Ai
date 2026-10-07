import { describe, expect, it } from 'vitest';
import { PLANNER_SYSTEM, plannerSystemFor } from '../src/prompts';
import { parsePlan, prepareClass, type LlmAdapter } from '../src/prepare';

const PLAN = {
  id: 'digestion',
  title: 'Digestion',
  visuals: [],
  beats: [
    {
      id: 'b1',
      topic: 'Digestion',
      narration: '',
      board: [
        { do: 'title', text: 'Digestion', path: ['Life processes', 'Digestion'] },
        { do: 'say', text: 'Food goes on a journey through four places.' },
        { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Intestine' }] },
        { do: 'say', text: 'So food is broken down, then taken in.' },
        { do: 'summary', text: 'Break it down, then absorb it' },
      ],
    },
  ],
};

describe('the planner for a composed board', () => {
  it('is the planner as it was when the board is not composed', () => {
    expect(plannerSystemFor(false)).toBe(PLANNER_SYSTEM);
  });

  it('asks for one main demonstration and a full page, and teaches summary, compare and path', () => {
    const text = plannerSystemFor(true);
    expect(text).not.toContain('Never mix two kinds on one board.');
    expect(text).not.toContain('more than five placed things');
    expect(text).toContain('One main demonstration a board');
    expect(text).toContain('the page contract');
    expect(text).toContain('{"do":"summary"');
    expect(text).toContain('{"do":"compare"');
    expect(text).toContain('"path"');
    // No rule left over from the stacked board contradicts the page contract.
    expect(text).not.toContain('Nothing else on the board.');
    expect(text).not.toContain('two to four in a beat is normal');
    // A summary no longer than the smallest summary place holds (two lines of its 20-unit writing).
    expect(text).toContain('under 45 characters');
    // A comparison under a picture is a section of that page, not a second demonstration.
    expect(text).toContain('a section of that page');
    expect(text).not.toContain('It\nis a main demonstration of its own.');
  });

  it('keeps a picture’s list on its own page, and says what a page of writing alone is (small intestine, 2026-10-06)', () => {
    const text = plannerSystemFor(true);
    expect(text).toContain("The list of a picture's parts goes on the picture's own board");
    expect(text).toContain('A board with no picture, scene, flow, chart, working or comparison');
  });

  it('asks before it shows, and names a placed thing as its label does (small intestine, 2026-10-07)', () => {
    const text = plannerSystemFor(true);
    expect(text).toContain('Ask before you show');
    expect(text).toContain('A placed "noun" names the same thing as its label');
  });

  it('asks for every beat as lines, never as one narration (small intestine, 2026-10-06)', () => {
    const text = plannerSystemFor(true);
    expect(text).toContain('Every beat is written as {"do":"say"} lines');
    expect(text).toContain('Leave "narration" empty');
  });
});

describe('a plan with the composer’s instructions', () => {
  it('keeps what is well formed and drops what is not', () => {
    const plan = parsePlan(
      JSON.stringify({
        id: 'p',
        title: 'P',
        visuals: [],
        beats: [
          {
            id: 'b1',
            topic: 't',
            board: [
              { do: 'title', text: 'Villi', path: ['Small intestine', 3, 'Villi'] },
              { do: 'summary' },
              { do: 'summary', text: 'Villi absorb food' },
              { do: 'compare', left: { heading: 'Without', points: ['smooth', '', 'slow'] }, right: { heading: 'With', points: ['folded', 'fast'] } },
              { do: 'compare', left: { points: ['a', 'b'] }, right: { heading: 'With', points: ['c', 'd'] } },
            ],
          },
        ],
      }),
    )!;
    expect(plan.beats[0].board).toEqual([
      { do: 'title', text: 'Villi' },
      { do: 'summary', text: 'Villi absorb food' },
      { do: 'compare', left: { heading: 'Without', points: ['smooth', 'slow'] }, right: { heading: 'With', points: ['folded', 'fast'] } },
    ]);
  });
});

describe('prepareClass({ composed })', () => {
  const run = async (composed?: boolean) => {
    const systems: string[] = [];
    const planner: LlmAdapter = {
      complete: async (system: string) => {
        systems.push(system);
        return JSON.stringify(PLAN);
      },
    };
    const artist: LlmAdapter = { complete: async () => '' };
    const result = await prepareClass({ topic: 'Digestion', klass: 7, planner, artist, ...(composed ? { composed } : {}) });
    return { systems, result };
  };

  it('plans with the page contract and lays the class out composed', async () => {
    const { systems, result } = await run(true);
    expect(systems[0]).toContain('the page contract');
    expect(result.lesson.elements.find((e) => e.kind === 'title')).toMatchObject({ y: 72 });
  });

  it('plans and lays out as before when it is not asked', async () => {
    const { systems, result } = await run();
    expect(systems[0]).toBe(PLANNER_SYSTEM);
    expect(result.lesson.elements.find((e) => e.kind === 'title')).toMatchObject({ y: 86 });
  });
});
