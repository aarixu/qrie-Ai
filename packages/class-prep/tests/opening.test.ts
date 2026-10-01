import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { assemble, prepareClass, type LlmAdapter } from '../src/prepare';
import { gateLesson, type MathsCheck } from '../src/gate';
import { PLANNER_SYSTEM, plannerUser } from '../src/prompts';
import type { Blueprint } from '../src/types';
import { EXCRETION_OUTCOMES, asOutcomes, excretion } from './fixtures/class10Science';

/**
 * THE OPENING'S CONTEXT QUESTION IS EVIDENCE ABOUT NOTHING, AND THAT IS RIGHT.
 *
 * The planner prompt opens every class by asking the student a real question
 * from their own life before anything is taught ("THE CONTEXT ITSELF IS BUILT
 * BY ASKING"), and the keep gate's outcomes rule demanded that every ask claim
 * an outcome. A class that obeyed the prompt was refused by the gate —
 * excretion, 2026-10-01: `outcomes@b1_3`, Rs 12 spent, nothing kept.
 *
 * The gate gives way. The answer to "where does the water you drink go?" is a
 * guess made before the teaching, and filing it against an outcome would book
 * a perfectly good opening answer as a wrong answer about something nobody had
 * taught yet. The classroom already files an ask that claims no outcome as
 * nothing (apps/classroom/tests/outcomes.test.ts, "records nothing for a beat
 * that checks and teaches nothing"; the ledger's replay and the learner
 * model's fold skip it too). Nothing here depends on the question being
 * written on the board: the opening is found by its place in the plan.
 */

const noMaths: MathsCheck = () => ({ ok: true, failures: [] });
const outcomes = asOutcomes(EXCRETION_OUTCOMES);

const laidOut = (plan: Blueprint) => {
  const made = assemble(plan, new Set(plan.visuals.map((v) => v.id)));
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  return { ...made, lesson: checked.lesson as Lesson };
};
const outcomeProblems = (plan: Blueprint, withOpening = true) => {
  const made = laidOut(plan);
  return gateLesson(made.lesson, {
    bonds: made.bonds,
    outcomes,
    mathsCheck: noMaths,
    ...(withOpening ? { opening: made.opening } : {}),
  })
    .filter((p) => p.rule === 'outcomes')
    .map((p) => p.where);
};

describe('assemble names the opening’s context question', () => {
  it('as the moment of the first beat that holds its first ask', () => {
    expect(laidOut(excretion()).opening).toEqual(['b1_3']);
  });

  it('as nothing when the first beat asks nothing', () => {
    const plan = excretion();
    plan.beats[0].board = plan.beats[0].board.filter((s) => s.do !== 'ask');
    expect(laidOut(plan).opening).toEqual([]);
  });
});

describe('the outcomes rule', () => {
  it('used to refuse the opening that the prompt asks for — the contradiction', () => {
    expect(outcomeProblems(excretion(), false)).toEqual(['b1_3']);
  });

  it('does not ask the opening’s context question to claim an outcome', () => {
    expect(outcomeProblems(excretion())).toEqual([]);
  });

  it('still asks it of every teaching question', () => {
    const plan = excretion();
    delete plan.beats.find((b) => b.id === 'b3')!.checks;
    expect(outcomeProblems(plan)).toEqual(['b3_2']);
  });

  it('still asks it of a SECOND question in the opening', () => {
    const plan = excretion();
    plan.beats[0].board.push(
      { do: 'say', text: 'And one more thing.' },
      { do: 'ask', question: 'Which organ do you think cleans the blood?', expect: 'The kidney.', hint: 'Two of them, at your back.' },
      { do: 'say', text: 'We will see.' },
    );
    expect(outcomeProblems(plan)).toEqual(['b1_5']);
  });

  it('does not excuse the first question of a later beat when the opening asked none', () => {
    const plan = excretion();
    plan.beats[0].board = plan.beats[0].board.filter((s) => s.do !== 'ask');
    delete plan.beats.find((b) => b.id === 'b3')!.checks;
    expect(outcomeProblems(plan)).toEqual(['b3_2']);
  });
});

describe('a class that opens the way the prompt says', () => {
  it('is kept: prepareClass hands the gate the opening', async () => {
    const planner: LlmAdapter = { complete: async () => JSON.stringify(excretion()) };
    const made = await prepareClass({
      topic: 'Excretion in Human Beings',
      klass: 10,
      planner,
      artist: { complete: async () => '<svg/>' },
      outcomes,
    });
    expect(made.report.gate!.problems.filter((p) => p.rule === 'outcomes')).toEqual([]);
  });
});

describe('the prompt says the same thing the gate does', () => {
  it('tells the planner the opening question claims no outcome', () => {
    expect(PLANNER_SYSTEM).toMatch(/context itself is built by asking[\s\S]*claims no outcome/i);
  });

  it('excepts it where it demands checks on every ask', () => {
    const asked = plannerUser('Excretion in Human Beings', 10, 3, undefined, undefined, outcomes);
    expect(asked).toMatch(/Every beat that asks carries "checks"[\s\S]*except the opening/i);
  });
});
