import { describe, expect, it } from 'vitest';
import { validatePlan, type TeachingPlan } from '../src/index';
import { PLAN, planCopy } from './fixtures/respirationPlan';

/**
 * WHAT A PLAN MUST BE BEFORE THE CONDUCTOR RUNS IT: every field and range the
 * contract states, ids that name one thing, a board that exists, and no help
 * text that gives the answer away. Every problem is reported, by path.
 */

const problemsOf = (plan: unknown, opts?: Parameters<typeof validatePlan>[1]): string[] => {
  const r = validatePlan(plan, opts);
  return r.ok ? [] : r.problems;
};

/** The problems a copy of the fixture has after `edit`. */
const after = (edit: (p: TeachingPlan) => void, opts?: Parameters<typeof validatePlan>[1]): string[] => {
  const p = planCopy();
  edit(p);
  return problemsOf(p, opts);
};

/** Loosens the type for a test that writes what the contract forbids. */
const loose = (x: unknown) => x as Record<string, unknown>;

describe('validatePlan: the fixture', () => {
  it('accepts it, and hands back the same plan', () => {
    const r = validatePlan(PLAN);
    expect(r).toEqual({ ok: true, plan: PLAN });
    if (r.ok) expect(r.plan).toBe(PLAN);
  });

  it('accepts it against a board that has its beats and elements', () => {
    expect(validatePlan(PLAN, { beatIds: new Set(['b1', 'b2', 'b3']), elementIds: new Set(['e1', 'e2']) }).ok).toBe(true);
  });
});

describe('validatePlan: shape and ranges', () => {
  it('refuses what is not an object', () => {
    expect(problemsOf(null)).toEqual(['plan: must be an object']);
    expect(problemsOf([PLAN])).toEqual(['plan: must be an object']);
  });

  it('wants formatVersion 1', () => {
    expect(after((p) => (loose(p).formatVersion = 2))).toEqual(['formatVersion: must be 1']);
  });

  it('wants 3 to 30 minutes', () => {
    expect(after((p) => (p.minutes = 2))).toEqual(['minutes: must be a number from 3 to 30']);
    expect(after((p) => (p.minutes = 31))).toEqual(['minutes: must be a number from 3 to 30']);
    expect(after((p) => (p.minutes = 3))).toEqual([]);
    expect(after((p) => (p.minutes = 30))).toEqual([]);
  });

  it('wants a whole class number', () => {
    expect(after((p) => (p.klass = 10.5))).toEqual(['klass: must be a whole number, 1 or more']);
  });

  it('refuses blank strings anywhere', () => {
    expect(after((p) => (p.title = '  '))).toEqual(['title: must be a non-empty string']);
    expect(after((p) => (p.ideas[0].points[0].say = ''))).toEqual(['ideas[0].points[0].say: must be a non-empty string']);
    expect(after((p) => (p.opener.hint = ''))).toEqual(['opener.hint: must be a non-empty string']);
    expect(after((p) => (p.ideas[1].teachBack.expect = ''))).toEqual(['ideas[1].teachBack.expect: must be a non-empty string']);
    expect(after((p) => (p.ideas[0].check[0].misconceptions[0].followUp = ''))).toEqual([
      'ideas[0].check[0].misconceptions[0].followUp: must be a non-empty string',
    ]);
    expect(after((p) => (p.facts = ['ok', '']))).toEqual(['facts[1]: must be a non-empty string']);
  });

  it('wants at least one idea', () => {
    expect(after((p) => (p.ideas = []))).toEqual(['ideas: must have at least 1 item(s), has 0']);
  });

  it('wants 1 to 3 points and 1 to 3 checks per idea', () => {
    expect(after((p) => (p.ideas[1].points = []))).toEqual(['ideas[1].points: must have 1 to 3 item(s), has 0']);
    const extra = (n: number) => ({ ...PLAN.ideas[0].points[0], id: `p-extra-${n}`, ask: { ...PLAN.ideas[0].points[0].ask, id: `q-extra-${n}` } });
    expect(after((p) => p.ideas[0].points.push(extra(1), extra(2)))).toEqual(['ideas[0].points: must have 1 to 3 item(s), has 4']);
    expect(after((p) => (p.ideas[0].check = []))).toEqual(['ideas[0].check: must have 1 to 3 item(s), has 0']);
    expect(after((p) => p.ideas[0].check.push({ ...PLAN.ideas[0].check[0], id: 'c-fourth' }))).toEqual([
      'ideas[0].check: must have 1 to 3 item(s), has 4',
    ]);
  });

  it('wants 0 to 4 misconceptions, 1 to 3 alternates, and known alternate modes', () => {
    const m = PLAN.ideas[0].points[0].ask.misconceptions[0];
    const five = [0, 1, 2, 3, 4].map((i) => ({ ...m, id: `m${i}` }));
    expect(after((p) => (p.opener.misconceptions = five))).toEqual(['opener.misconceptions: must have 0 to 4 item(s), has 5']);
    expect(after((p) => (p.opener.alternates = []))).toEqual(['opener.alternates: must have 1 to 3 item(s), has 0']);
    const alt = PLAN.opener.alternates[0];
    expect(after((p) => (p.opener.alternates = [alt, alt, alt, alt]))).toEqual(['opener.alternates: must have 1 to 3 item(s), has 4']);
    expect(after((p) => (loose(p.opener.alternates[0]).mode = 'story'))).toEqual([
      'opener.alternates[0].mode: must be one of analogy, everyday, visual, steps',
    ]);
  });

  it('wants 2 to 3 recap prompts', () => {
    expect(after((p) => (p.recap.prompts = ['one']))).toEqual(['recap.prompts: must have 2 to 3 item(s), has 1']);
    expect(after((p) => (p.recap.prompts = ['a', 'b', 'c', 'd']))).toEqual(['recap.prompts: must have 2 to 3 item(s), has 4']);
  });

  it('wants nodeIds on every question and idea', () => {
    expect(after((p) => (p.ideas[0].check[1].nodeIds = []))).toEqual(['ideas[0].check[1].nodeIds: must have at least 1 item(s), has 0']);
    expect(after((p) => (p.ideas[1].nodeIds = []))).toEqual(['ideas[1].nodeIds: must have at least 1 item(s), has 0']);
  });

  it('checks a worked example step by step', () => {
    expect(after((p) => (p.ideas[0].points[0].ask.workedExample = { steps: [] }))).toEqual([
      'ideas[0].points[0].ask.workedExample.steps: must have at least 1 item(s), has 0',
    ]);
    expect(after((p) => (p.ideas[0].points[0].ask.workedExample = { steps: [{ say: 'A leaf.', line: '' }] }))).toEqual([
      'ideas[0].points[0].ask.workedExample.steps[0].line: must be a non-empty string',
    ]);
  });

  it('checks an optional prediction when there is one', () => {
    expect(after((p) => (loose(p.ideas[0].predict).question = ''))).toEqual(['ideas[0].predict.question: must be a non-empty string']);
    expect(after((p) => delete p.ideas[0].predict)).toEqual([]);
  });

  it('reports every problem, not only the first', () => {
    const problems = after((p) => {
      p.minutes = 99;
      p.ideas[0].points[0].say = '';
      p.recap.prompts = [];
    });
    expect(problems).toHaveLength(3);
  });
});

describe('validatePlan: ids', () => {
  it('refuses a question id used twice across the plan', () => {
    expect(after((p) => (p.ideas[1].check[0].id = 'q-where'))).toEqual([
      'ideas[1].check[0].id: "q-where" is already used at ideas[0].points[0].ask; ids must be unique across the plan',
    ]);
  });

  it('keeps question, point and idea ids in one namespace', () => {
    expect(after((p) => (p.ideas[0].points[1].id = 'idea-oxygen'))).toEqual([
      'ideas[1].id: "idea-oxygen" is already used at ideas[0].points[1]; ids must be unique across the plan',
    ]);
    expect(after((p) => (p.ideas[1].id = 'idea-what'))).toEqual([
      'ideas[1].id: "idea-what" is already used at ideas[0]; ids must be unique across the plan',
    ]);
  });

  it('refuses a misconception id twice in one question, and allows it on two questions', () => {
    const m = PLAN.ideas[0].points[0].ask.misconceptions[0];
    expect(after((p) => p.ideas[0].points[0].ask.misconceptions.push({ ...m, soundsLike: 'in the nose' }))).toEqual([
      'ideas[0].points[0].ask.misconceptions[1].id: "breathing-is-respiration" is used twice in this question',
    ]);
    // `breathing-is-respiration` already sits on q-where and c-release in the fixture.
    expect(validatePlan(PLAN).ok).toBe(true);
  });

  it("refuses an id that is an idea's teach-back id", () => {
    expect(after((p) => (p.ideas[1].check[1].id = 'idea-what#teach-back'))).toEqual([
      'ideas[1].check[1].id: "idea-what#teach-back" is the id idea "idea-what"\'s teach-back is held under',
    ]);
  });
});

describe('validatePlan: the board', () => {
  it('checks beat ids only when the board lesson is given', () => {
    expect(after((p) => (p.ideas[1].board.beatId = 'b9'))).toEqual([]);
    expect(after((p) => (p.ideas[1].board.beatId = 'b9'), { beatIds: new Set(['b1', 'b2']) })).toEqual([
      'ideas[1].board.beatId: "b9" is not a beat of the board lesson',
    ]);
  });

  it('checks focus element ids only when the elements are given', () => {
    expect(after(() => undefined, { elementIds: new Set(['e2']) })).toEqual([
      'ideas[0].board.focus[0]: "e1" is not an element of the board lesson',
    ]);
    expect(after(() => undefined, { beatIds: new Set(['b1', 'b2']) })).toEqual([]);
  });
});

describe('validatePlan: nothing said while a question is held gives its answer away', () => {
  it('refuses a hint that holds the answer as written, case-insensitively', () => {
    expect(after((p) => (p.ideas[0].points[1].ask.hint = 'It is CARBON DIOXIDE, the gas that turns limewater milky.'))).toEqual([
      'ideas[0].points[1].ask.hint: contains the answer "Carbon dioxide"',
    ]);
  });

  it('refuses a follow-up or an alternate that holds the answer', () => {
    expect(after((p) => (p.ideas[1].points[0].ask.alternates[0].say = 'Lactic acid is the sour stuff left behind.'))).toEqual([
      'ideas[1].points[0].ask.alternates[0].say: contains the answer "Lactic acid"',
    ]);
    expect(after((p) => (p.ideas[0].points[1].ask.misconceptions[0].followUp = 'Is it oxygen, or carbon dioxide?'))).toEqual([
      'ideas[0].points[1].ask.misconceptions[0].followUp: contains the answer "Carbon dioxide"',
    ]);
  });

  it('refuses help that gives away the expect under the leak check (number words included)', () => {
    const p = planCopy();
    const q = p.ideas[0].check[1];
    q.expect = 'x = 7';
    q.answer = 'seven';
    q.hint = 'Try 7 and see.';
    expect(problemsOf(p)).toEqual(['ideas[0].check[1].hint: gives away the answer ("x = 7")']);
  });

  it('refuses a worked example or a misconception reason that gives the answer away', () => {
    expect(after((p) => (p.ideas[0].check[0].workedExample = { steps: [{ say: 'Food gives energy.', line: 'food → energy' }] }))).toEqual([
      'ideas[0].check[0].workedExample.steps[0].say: gives away the answer ("energy")',
      'ideas[0].check[0].workedExample.steps[0].line: gives away the answer ("energy")',
    ]);
    expect(after((p) => (p.ideas[0].check[0].misconceptions[0].why = 'Air is breathed; food gives energy.'))).toEqual([
      'ideas[0].check[0].misconceptions[0].why: gives away the answer ("energy")',
    ]);
  });

  it('catches a one-word expect as a whole word, not inside another word', () => {
    // The prediction's expect is "yes". "eyes" is not it.
    expect(after((p) => (p.ideas[0].predict!.hint = 'Close your eyes: does a plant stop living at night?'))).toEqual([]);
    expect(after((p) => (p.ideas[0].predict!.hint = 'Yes or no: does a plant stop living at night?'))).toEqual([
      'ideas[0].predict.hint: gives away the answer ("yes")',
    ]);
  });

  it("refuses a point that states its own quick question's answer: the question would be an echo, its right answer no evidence", () => {
    expect(after((p) => (p.ideas[0].points[1].say = 'Cells give out carbon dioxide and water as waste.'))).toEqual([
      'ideas[0].points[1].say: contains the answer "Carbon dioxide"',
    ]);
    expect(after((p) => (p.ideas[0].points[0].say = 'Respiration happens in every cell of the body.'))).toEqual([
      'ideas[0].points[0].say: gives away the answer ("in every cell")',
    ]);
  });

  it('finds the answer as written where the leak check has no needle, and only at word boundaries', () => {
    // An answer of joining words only: leakTokens reduces it to nothing.
    const withHint = (hint: string) =>
      after((p) => {
        const q = p.ideas[0].check[2];
        q.answer = 'is';
        q.hint = hint;
      });
    expect(withHint('Say what it is.')).toEqual(['ideas[0].check[2].hint: contains the answer "is"']);
    expect(withHint('Think about this.')).toEqual([]);
  });
});
