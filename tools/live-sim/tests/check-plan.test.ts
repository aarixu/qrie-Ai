import { describe, expect, it } from 'vitest';
import { checkPlan, fold, keyTerms, loadPlanContext } from '../check-plan.mjs';

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
    // oxygen-check-2: "Where in the cell is pyruvate broken down using oxygen?"
    plan.ideas[2].check[1].hint = 'Is it in the mitochondria?';
    const { errors } = checkPlan(plan, context);
    expect(errors.some((e) => e.startsWith('ideas[2].check[1].hint') && e.includes('contains the answer'))).toBe(true);
  });

  it('a follow-up that carries every key term of a short answer, a plural ending apart', () => {
    const { plan, context } = copy();
    // muscle-check-2's answer: "Lactic acid. When it builds up in the muscles, it causes cramps."
    // "build" and "cramp" are its "builds" and "cramps" with the ending off.
    plan.ideas[3].check[1].misconceptions[0].followUp = 'Did you know that lactic acid can build up and give you a cramp?';
    const { errors } = checkPlan(plan, context);
    expect(
      errors.some((e) => e.startsWith('ideas[3].check[1].misconceptions[0].followUp') && e.includes('every key term')),
    ).toBe(true);
  });

  it('a worked example that gives the answer only across its steps', () => {
    const { plan, context } = copy();
    // Neither step alone holds all four key terms of muscle-check-2; the two together do.
    plan.ideas[3].check[1].workedExample = {
      steps: [
        { say: 'The muscle makes lactic acid.', line: 'lactic acid' },
        { say: 'When it builds up, it gives you cramps.', line: 'cramps' },
      ],
    };
    const { errors } = checkPlan(plan, context);
    expect(errors.filter((e) => e.startsWith('ideas[3].check[1].workedExample'))).toEqual([
      "ideas[3].check[1].workedExample (all steps together): carries every key term of muscle-check-2's answer (lactic, acid, builds, cramps)",
    ]);
  });

  it("a reason that gives away the next question's answer in the same move", () => {
    const { plan, context } = copy();
    // The plan as it was before the pedagogy review: the definitional check
    // first, after a reason that names its answer.
    const idea = plan.ideas[2];
    idea.check = [idea.check[1], idea.check[0]];
    idea.points[1].ask.why =
      'The pathway with oxygen releases far more energy than any pathway without it, and that pathway runs in the mitochondria.';
    const { errors } = checkPlan(plan, context);
    const at = 'ideas[2].points[1].ask.why, said in the move that asks ideas[2].check[0]';
    expect(errors).toContain(`${at}: contains the answer or expect of oxygen-check-2`);
    expect(errors).toContain(`${at}: carries every key term of oxygen-check-2's answer (mitochondria)`);
  });

  it('a reason that gives away a retest asked after it', () => {
    const { plan, context } = copy();
    // A retest of idea 2 (check[1]) is asked after idea 3's points, straight after this reason.
    plan.ideas[3].points[1].ask.why = 'Lactic acid is made when pyruvate never reaches the mitochondria.';
    const { errors } = checkPlan(plan, context);
    expect(errors).toContain(
      "ideas[3].points[1].ask.why, said in the move that asks ideas[2].check[1]: carries every key term of oxygen-check-2's answer (mitochondria)",
    );
  });

  it("a question longer than its move's cap", () => {
    const { plan, context } = copy();
    plan.ideas[4].predict.question =
      'Picture this. You stir some yeast into sugar water in a bottle and stretch a balloon over its mouth. What do you think happens to the balloon?';
    const { errors } = checkPlan(plan, context);
    expect(errors).toContain("ideas[4].predict.question: 3 sentences; a predict move's cap is 2");
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
    // "causes" is dropped because the question already says "cause"; "builds" is kept against "build-up".
    expect(
      keyTerms({
        question: 'What do your muscle cells make when they run short of oxygen, and what does it cause?',
        expect: 'Lactic acid, whose build-up causes cramps.',
        answer: 'Lactic acid. When it builds up in the muscles, it causes cramps.',
      }),
    ).toEqual(['lactic', 'acid', 'builds', 'cramps']);
  });
});

describe('fold', () => {
  it('takes plural and tense endings off, and errs toward missing', () => {
    expect(fold('cramps')).toBe(fold('cramp'));
    expect(fold('causes')).toBe(fold('caused'));
    expect(fold('causes')).toBe(fold('cause'));
    expect(fold('building')).toBe(fold('builds'));
    expect(fold('gases')).toBe(fold('gas'));
    expect(fold('glass')).toBe('glass');
    // Irregular forms stay apart: a missed match, never a false one.
    expect(fold('used')).not.toBe(fold('use'));
    expect(fold('ran')).not.toBe(fold('run'));
  });
});
