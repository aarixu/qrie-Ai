import { describe, expect, it } from 'vitest';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import { saveable } from '../src/save';
import type { Blueprint, PrepResult } from '../src/types';
import { SUBSTITUTION_OUTCOMES, substitutionClean } from './fixtures/substitution';

/**
 * THE KEEP GATE, RUN WHERE IT MATTERS: inside prepareClass, before the room
 * opens and before anything is kept.
 *
 * A gate problem feeds the one repair round, the same way a validation error
 * does. What survives the repair decides what happens next:
 *   - wrong MATHS fails closed: the class is refused, never taught (T1.4);
 *   - anything else is a worse class, not a wrong one: it is taught to the
 *     student waiting for it, recorded on the report, and never kept (T1.1,
 *     T1.2, T1.3, T1.5).
 */

/** A planner that answers each call with the next plan, and remembers what it was asked. */
const planner = (...plans: Blueprint[]): LlmAdapter & { asked: string[] } => {
  const asked: string[] = [];
  let n = 0;
  return {
    asked,
    complete: async (_system: string, user: string) => {
      asked.push(user);
      return JSON.stringify(plans[Math.min(n++, plans.length - 1)]);
    },
  };
};
const artist: LlmAdapter = { complete: async () => '<svg/>' };
const outcomes = SUBSTITUTION_OUTCOMES.map((id) => ({ id, statement: `the outcome ${id}` }));

const wrongMaths = (): Blueprint => {
  const plan = substitutionClean(SUBSTITUTION_OUTCOMES);
  const b3 = plan.beats.find((b) => b.id === 'b3')!;
  b3.board = b3.board.map((step) =>
    step.do === 'write' && step.text === 'y = 19 / 29' ? { ...step, text: 'y = 19 / 28' } : step,
  );
  return plan;
};

/** Everything saveable needs that the gate does not decide: a topic, and art for the nouns. */
const keep = (made: PrepResult) => {
  for (const el of made.lesson.elements) if (el.kind === 'graphic') made.assets[el.id] = '<svg/>';
  return saveable(made, {
    topicRef: 'class10-mathematics/pair-of-linear-equations-in-two-variables/substitution-method',
    klass: 10,
    subject: 'Mathematics',
  });
};

describe('a class that passes the gate', () => {
  it('is kept, and the report says the gate ran and found nothing', async () => {
    const made = await prepareClass({
      topic: 'Substitution Method',
      klass: 10,
      planner: planner(substitutionClean(SUBSTITUTION_OUTCOMES)),
      artist,
      outcomes,
    });
    expect(made.report.gate).toEqual({ problems: [] });
    expect(keep(made)).not.toBeNull();
  });
});

describe('outcome ids are mandatory when the map has them (T1.3)', () => {
  it('sends an untagged plan to repair, naming the beats that ask without them', async () => {
    const plans = planner(substitutionClean(), substitutionClean(SUBSTITUTION_OUTCOMES));
    const made = await prepareClass({ topic: 'Substitution Method', klass: 10, planner: plans, artist, outcomes });
    expect(plans.asked).toHaveLength(2);
    expect(plans.asked[1]).toMatch(/claims no outcome/);
    expect(made.report.gate).toEqual({ problems: [] });
    for (const beat of made.lesson.beats.filter((b) => b.ask)) expect(beat.checks?.length).toBeGreaterThan(0);
  });

  it('teaches a plan still untagged after the repair, and never keeps it', async () => {
    const made = await prepareClass({
      topic: 'Substitution Method',
      klass: 10,
      planner: planner(substitutionClean()),
      artist,
      outcomes,
    });
    expect(made.lesson.beats.length).toBeGreaterThan(0);
    expect(made.report.gate!.problems.map((p) => p.rule)).toContain('outcomes');
    expect(keep(made)).toBeNull();
  });
});

describe('wrong maths fails closed (T1.4)', () => {
  it('repairs a wrong line when the repair gets it right', async () => {
    const plans = planner(wrongMaths(), substitutionClean(SUBSTITUTION_OUTCOMES));
    const made = await prepareClass({ topic: 'Substitution Method', klass: 10, planner: plans, artist, outcomes });
    expect(plans.asked[1]).toMatch(/does not hold/);
    expect(plans.asked[1]).toContain('19 / 28');
    expect(made.report.gate).toEqual({ problems: [] });
  });

  it('refuses the class when the working is still wrong after the repair, naming the line', async () => {
    const run = prepareClass({
      topic: 'Substitution Method',
      klass: 10,
      planner: planner(wrongMaths()),
      artist,
      outcomes,
    });
    await expect(run).rejects.toThrow(/b3_8/);
    await run.catch((e: unknown) => {
      // For the operator, off the message: which lines, and why.
      expect((e as { mathsProblems?: unknown[] }).mathsProblems?.length).toBeGreaterThan(0);
      // Never the wrong working itself: a student can see this message.
      expect((e as Error).message).not.toContain('19 / 28');
    });
  });

  it('never opens the room on wrong maths', async () => {
    let opened = false;
    await prepareClass({
      topic: 'Substitution Method',
      klass: 10,
      planner: planner(wrongMaths()),
      artist,
      outcomes,
      onDraft: () => {
        opened = true;
      },
    }).catch(() => undefined);
    expect(opened).toBe(false);
  });
});

describe('the other rules keep a class from being kept (T1.2, T1.5)', () => {
  it('records notation read aloud on the report, and saveable refuses the class', async () => {
    const plan = substitutionClean(SUBSTITUTION_OUTCOMES);
    const b3 = plan.beats.find((b) => b.id === 'b3')!;
    b3.board = b3.board.map((step) =>
      step.do === 'say' && step.text.startsWith('Let us put')
        ? { ...step, text: 'Let us substitute x = (3 - 2y) into Equation 1: 7x - 15y = 2.' }
        : step,
    );
    const made = await prepareClass({ topic: 'Substitution Method', klass: 10, planner: planner(plan), artist, outcomes });
    expect(made.report.gate!.problems.map((p) => p.rule)).toEqual(['notation']);
    expect(made.report.issues.join(' ')).toMatch(/keep gate/i);
    expect(keep(made)).toBeNull();
  });
});

describe('ink after the last ask with no line after it (T1.2)', () => {
  /** The class as the clean plan, but b4 writes its card after its ask and says nothing more. */
  const unspokenCard = (): Blueprint => {
    const plan = substitutionClean(SUBSTITUTION_OUTCOMES);
    const b4 = plan.beats.find((b) => b.id === 'b4')!;
    b4.board = b4.board.filter((step) => !(step.do === 'say' && step.text === 'Here is how it goes.'));
    return plan;
  };

  it('is taught — the card is on the board after the answer — and never kept', async () => {
    const made = await prepareClass({
      topic: 'Substitution Method',
      klass: 10,
      planner: planner(unspokenCard()),
      artist,
      outcomes,
    });
    const card = made.lesson.elements.find((el) => JSON.stringify(el).includes('Always Check Both Equations'))!;
    expect(card).toBeDefined();
    const held = made.lesson.beats.findIndex((b) => b.id.startsWith('b4') && b.ask);
    expect(made.lesson.beats[held].show).not.toContain(card.id);
    expect(made.lesson.beats[held + 1]?.show).toContain(card.id);
    expect(made.report.gate!.problems.map((p) => p.rule)).toEqual(['unspoken']);
    expect(keep(made)).toBeNull();
  });

  it('is named to the planner once, and a repair that adds the line is kept', async () => {
    const plans = planner(unspokenCard(), substitutionClean(SUBSTITUTION_OUTCOMES));
    const made = await prepareClass({ topic: 'Substitution Method', klass: 10, planner: plans, artist, outcomes });
    expect(plans.asked).toHaveLength(2);
    // Both the plan check and the gate say "with nothing said after it".
    const told = plans.asked[1].match(/with nothing said after it/g) ?? [];
    expect(told).toHaveLength(1);
    expect(made.report.gate).toEqual({ problems: [] });
    expect(keep(made)).not.toBeNull();
  });
});
