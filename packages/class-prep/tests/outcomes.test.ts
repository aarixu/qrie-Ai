import { describe, expect, it } from 'vitest';
import { PLANNER_SYSTEM, plannerUser, type TopicOutcome } from '../src/prompts';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import type { Blueprint } from '../src/types';

/**
 * THE JOIN BETWEEN A CLASS AND THE MAP THAT MEASURES IT.
 *
 * The planner has always been asked for `teaches` and `checks` ids and had
 * never been shown one, so it wrote what an id ought to look like. Every
 * invented id misses, and a class that reports teaching nothing the map has
 * heard of is a class recorded as having taught nothing: the belief never
 * moves, the quiz after it finds no probes, the adaptive loop has nothing to
 * act on. Not one line of this fails loudly, which is why it is tested.
 */

const outcomes: TopicOutcome[] = [
  { id: 'sci9.matter.states', statement: 'name the three states of matter' },
  { id: 'sci9.matter.particles', statement: 'explain that matter is made of particles' },
];

const svg = (parts: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620">${parts
    .map((p) => `<g id="${p}"><path d="M10 10 L20 20" stroke="var(--a, #333)"/></g>`)
    .join('')}</svg>`;

const planOf = (beats: Blueprint['beats']): Blueprint => ({
  id: 'demo',
  title: 'Matter',
  beats,
  visuals: [{ id: 'd1', parts: ['box'], brief: 'a box', alt: 'a box' }],
});

const fakePlanner = (doc: unknown): LlmAdapter => ({ complete: async () => JSON.stringify(doc) });
const fakeArtist = (): LlmAdapter => ({ complete: async () => svg(['box']) });

const run = (beats: Blueprint['beats'], withOutcomes: TopicOutcome[] | undefined) =>
  prepareClass({
    topic: 'Matter',
    klass: 9,
    planner: fakePlanner(planOf(beats)),
    artist: fakeArtist(),
    outcomes: withOutcomes,
  });

const beat = (over: Partial<Blueprint['beats'][number]> = {}) => ({
  id: 'b1',
  topic: 'open',
  narration: 'Matter is everywhere around you.',
  board: [{ do: 'title' as const, text: 'Matter' }],
  ...over,
});

// ============================================================= the prompt ===

describe('what the planner is shown', () => {
  it('lists the ids it is allowed to claim, with what each one means', () => {
    const prompt = plannerUser('Matter', 9, 4, undefined, undefined, outcomes);
    expect(prompt).toContain('sci9.matter.states: name the three states of matter');
    expect(prompt).toContain('sci9.matter.particles');
  });

  it('says beside the shape line that these are the only ids there are', () => {
    // In the system prompt, next to the field it governs, rather than in the
    // topic block: the rule holds for every class, the list changes per class.
    expect(PLANNER_SYSTEM).toMatch(/never invent one/i);
    expect(PLANNER_SYSTEM).toMatch(/THIS TOPIC TEACHES/);
  });

  it('stays silent about outcomes when the map has none for this topic', () => {
    // A heading with nothing under it is an invitation to fill it in, which is
    // the exact behaviour being prevented.
    for (const none of [undefined, [] as TopicOutcome[]]) {
      const prompt = plannerUser('Matter', 9, 4, undefined, undefined, none);
      expect(prompt).not.toMatch(/THIS TOPIC TEACHES/);
    }
  });

  it('puts the outcomes in whether or not there is a student dossier', () => {
    const withStudent = plannerUser('Matter', 9, 4, ['They are new here.'], undefined, outcomes);
    expect(withStudent).toContain('THIS TOPIC TEACHES');
    expect(withStudent).toContain('THIS STUDENT');
  });
});

// ============================================================== the guard ===

describe('an outcome the map does not have is not an outcome', () => {
  it('keeps the ids that are real', async () => {
    const result = await run(
      [beat({ teaches: ['sci9.matter.states'], checks: ['sci9.matter.particles'] })],
      outcomes,
    );
    expect(result.lesson.beats[0].teaches).toEqual(['sci9.matter.states']);
    expect(result.lesson.beats[0].checks).toEqual(['sci9.matter.particles']);
    expect(result.report.issues).toEqual([]);
  });

  it('drops an invented id and says so, rather than writing it down', async () => {
    const result = await run([beat({ teaches: ['photosynthesis-basics'] })], outcomes);
    expect(result.lesson.beats[0].teaches).toBeUndefined();
    expect(result.report.issues.join(' ')).toMatch(/Dropped 1 outcome id/);
  });

  it('keeps the real ones out of a list that mixes both', async () => {
    const result = await run(
      [beat({ teaches: ['sci9.matter.states', 'made.up.id', 'sci9.matter.particles'] })],
      outcomes,
    );
    expect(result.lesson.beats[0].teaches).toEqual([
      'sci9.matter.states',
      'sci9.matter.particles',
    ]);
    expect(result.report.issues.join(' ')).toMatch(/Dropped 1 outcome id/);
  });

  it('counts every dropped id across every beat and both fields', async () => {
    const result = await run(
      [
        beat({ id: 'b1', teaches: ['nope.one'], checks: ['nope.two'] }),
        beat({ id: 'b2', narration: 'And so it goes on.', teaches: ['nope.three'] }),
      ],
      outcomes,
    );
    expect(result.report.issues.join(' ')).toMatch(/Dropped 3 outcome id/);
  });

  it('drops rather than rejects: a bad field is not a bad class', async () => {
    // A repair round costs a waiting student thirteen seconds of blank board,
    // and the lesson is fine — one field on it was not.
    const result = await run([beat({ teaches: ['made.up.id'] })], outcomes);
    expect(result.lesson.beats).toHaveLength(1);
    expect(result.lesson.beats[0].narration).toBe('Matter is everywhere around you.');
  });

  it('leaves the ids alone when there is no map to check them against', async () => {
    // Not the same as "everything is invented". With no outcomes the prompt
    // never asked for ids, and dropping what a model volunteered anyway would
    // throw away the only measurement available.
    const result = await run([beat({ teaches: ['whatever-it-said'] })], undefined);
    expect(result.lesson.beats[0].teaches).toEqual(['whatever-it-said']);
    expect(result.report.issues).toEqual([]);
  });
});

// ============================================================ the repair ===

describe('the repair round is checked too', () => {
  /**
   * The path nobody looks at. A repair replaces the WHOLE blueprint with fresh
   * planner output, and for one commit that output went into the saved lesson
   * unfiltered — the exact silent failure this feature exists to prevent,
   * reached by the back door.
   */
  const broken = planOf([beat({ narration: '' })]);
  const repairedButInventing = planOf([
    beat({ teaches: ['sci9.matter.states', 'invented.by.the.repair'] }),
  ]);

  it('drops an id the REPAIRED plan invented', async () => {
    let call = 0;
    const planner: LlmAdapter = {
      complete: async () => {
        call += 1;
        return JSON.stringify(call === 1 ? broken : repairedButInventing);
      },
    };

    const result = await prepareClass({
      topic: 'Matter',
      klass: 9,
      planner,
      artist: fakeArtist(),
      outcomes,
    });

    expect(call).toBe(2);
    expect(result.report.issues.join(' ')).toContain('repaired and passed');
    expect(result.lesson.beats[0].teaches).toEqual(['sci9.matter.states']);
    expect(result.report.issues.join(' ')).toMatch(/the repaired plan invented/);
  });
});


describe('every ask carries real outcome ids (T1.3)', () => {
  it('tells the planner a beat that asks must claim one or two of the listed ids', () => {
    const prompt = plannerUser('Matter', 9, 4, undefined, undefined, outcomes);
    expect(prompt).toMatch(/every beat that asks carries "checks"/i);
  });

  it('says nothing of the kind when the map has no outcomes for this topic', () => {
    expect(plannerUser('Matter', 9, 4)).not.toMatch(/every beat that asks carries "checks"/i);
  });
});
