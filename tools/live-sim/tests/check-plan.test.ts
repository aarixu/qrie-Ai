import { describe, expect, it } from 'vitest';
import { checkPlan, keyTerms, loadPlanContext } from '../check-plan.mjs';

/**
 * THE RESPIRATION PLAN, AND THE CHECK THAT GUARDS IT. The plan is authored
 * JSON that TypeScript cannot check (see check-plan.mjs), so the committed
 * plan is held to the checker here, and the checker is held to the mistakes
 * it exists to catch, each one made on purpose in a copy of the real plan.
 */

// The plan as parsed JSON: the tests reach into it freely to break it.
type Json = any;

const load = () => loadPlanContext();

/** A deep copy of the committed plan to break, with the real board and graph. */
const copy = (): { plan: Json; context: ReturnType<typeof load>['context'] } => {
  const { plan, context } = load();
  return { plan: JSON.parse(JSON.stringify(plan)), context };
};

describe('the committed Respiration plan', () => {
  it('passes every check, with no warnings', () => {
    const { plan, context } = load();
    const result = checkPlan(plan, context);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.counts.ideas).toBe(5);
  });
});

describe('the checker catches', () => {
  it('a hint that says the answer', () => {
    const { plan, context } = copy();
    // oxygen-check-1: "Where in the cell is pyruvate broken down using oxygen?"
    plan.ideas[2].check[0].hint = 'Is it in the mitochondria?';
    const { errors } = checkPlan(plan, context);
    expect(errors.some((e) => e.startsWith('ideas[2].check[0].hint') && e.includes('contains the answer'))).toBe(true);
  });

  it('a follow-up that carries every key term of a short answer', () => {
    const { plan, context } = copy();
    // muscle-check-1's answer: "Lactic acid. When it builds up in the muscles, it causes cramps."
    plan.ideas[3].check[0].misconceptions[0].followUp = 'Did you know lactic acid causes cramps?';
    const { errors } = checkPlan(plan, context);
    expect(
      errors.some((e) => e.startsWith('ideas[3].check[0].misconceptions[0].followUp') && e.includes('every key term')),
    ).toBe(true);
  });

  it('a worked example that gives the answer only across its steps', () => {
    const { plan, context } = copy();
    // Neither step alone holds all four key terms of muscle-check-1; the two together do.
    plan.ideas[3].check[0].workedExample = {
      steps: [
        { say: 'The muscle makes lactic acid.', line: 'lactic acid' },
        { say: 'And that is what causes cramps.', line: 'cramps' },
      ],
    };
    const { errors } = checkPlan(plan, context);
    expect(errors.filter((e) => e.startsWith('ideas[3].check[0].workedExample'))).toEqual([
      "ideas[3].check[0].workedExample (all steps together): carries every key term of muscle-check-1's answer (lactic, acid, causes, cramps)",
    ]);
  });

  it('a focus id the beat does not show', () => {
    const { plan, context } = copy();
    // x_yeast is on the board, but the hook beat does not show it.
    plan.ideas[0].board.focus = ['x_yeast'];
    const { errors } = checkPlan(plan, context);
    expect(errors).toContain('ideas[0].board.focus: "x_yeast" is not shown by beat "hook"');
  });

  it('a beat the board lesson does not have', () => {
    const { plan, context } = copy();
    plan.ideas[1].board.beatId = 'equations';
    const { errors } = checkPlan(plan, context);
    expect(errors).toContain('ideas[1].board.beatId: "equations" is not a beat of class10-respiration');
  });

  it('a key the type does not have, and a missing one', () => {
    const { plan, context } = copy();
    plan.ideas[0].checks = plan.ideas[0].check;
    delete plan.ideas[0].check;
    const { errors } = checkPlan(plan, context);
    expect(errors).toContain('ideas[0]: "checks" is not a field of idea');
    expect(errors).toContain('ideas[0]: missing "check"');
  });

  it('an id used twice', () => {
    const { plan, context } = copy();
    plan.ideas[1].check[1].id = 'breathing-check-2';
    const { errors } = checkPlan(plan, context);
    expect(errors).toContain('ideas[1].check[1].id: id "breathing-check-2" is already used at ideas[0].check[1].id');
  });

  it('an outcome from another topic, and one that does not exist', () => {
    const { plan, context } = copy();
    plan.ideas[0].nodeIds = ['sci10-lp-heart-is-pump', 'sci10-lp-no-such-node'];
    const { errors } = checkPlan(plan, context);
    expect(errors.some((e) => e.includes('"sci10-lp-heart-is-pump" belongs to'))).toBe(true);
    expect(errors.some((e) => e.includes('"sci10-lp-no-such-node" is not a knowledge-graph node'))).toBe(true);
  });

  it('a topic outcome nothing claims, as a warning', () => {
    const { plan, context } = copy();
    // Take sci10-lp-lactic-acid off every idea and question that claims it.
    const strip = (ids: string[]) => ids.filter((id) => id !== 'sci10-lp-lactic-acid');
    for (const idea of plan.ideas) {
      idea.nodeIds = strip(idea.nodeIds);
      for (const q of [idea.predict, ...idea.points.map((p: Json) => p.ask), ...idea.check]) {
        q.nodeIds = strip(q.nodeIds);
        if (q.nodeIds.length === 0) q.nodeIds = ['sci10-lp-aerobic-vs-anaerobic'];
      }
    }
    const { errors, warnings } = checkPlan(plan, context);
    expect(errors).toEqual([]);
    expect(warnings).toEqual(['plan: no question or idea claims sci10-lp-lactic-acid (Lactic acid in muscles)']);
  });

  it('a hint that is two questions, and markdown', () => {
    const { plan, context } = copy();
    plan.opener.hint = 'What did you eat? Why?';
    plan.facts[0] = '**Breathing** moves air.';
    const { errors } = checkPlan(plan, context);
    expect(errors).toContain('opener.hint: must be exactly one question');
    expect(errors.some((e) => e.startsWith('facts[0]') && e.includes('markdown'))).toBe(true);
  });
});

describe('keyTerms', () => {
  it('keeps what the answer turns on and drops what the question already says', () => {
    expect(
      keyTerms({
        question: 'Where in the cell is pyruvate broken down using oxygen?',
        expect: 'In the mitochondria.',
        answer: 'In the mitochondria.',
      }),
    ).toEqual(['mitochondria']);
    expect(
      keyTerms({
        question: 'What do your muscle cells make when they run short of oxygen, and what does it cause?',
        expect: 'Lactic acid, whose build-up causes cramps.',
        answer: 'Lactic acid. When it builds up in the muscles, it causes cramps.',
      }),
    ).toEqual(['lactic', 'acid', 'causes', 'cramps']);
  });
});
