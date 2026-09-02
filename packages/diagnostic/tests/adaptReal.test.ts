import { describe, expect, it } from 'vitest';
import {
  GAP_THRESHOLD,
  GraphIndex,
  applyTaught,
  edgeKey,
  gapsFrom,
  type Answer,
  type DiagnosticResult,
} from '@ai-tutor/knowledge-graph';
import { MAX_NEW_STEPS, MAX_PLAN_STEPS, learnFromQuiz } from '../src';

/**
 * THE SAME LOOP, AGAINST A MAP THE SIZE OF A REAL ONE.
 *
 * adapt.test.ts uses three nodes and starts from `gaps: []`, and every one of
 * these failures hid behind that fixture. A real map is twenty to three
 * hundred nodes and a real student is below the line on most of them: the
 * placement test finds dozens of gaps and has room to schedule twelve.
 *
 * Which is the whole point. Two of the bugs here were not logic errors at all
 * — they were a small fixture agreeing with the code.
 */

const node = (id: string, prerequisites: string[], difficulty: number) => ({
  id,
  klass: 9,
  subject: 'Science',
  chapter: 'matter',
  title: id,
  outcome: `State ${id}`,
  prerequisites,
  difficulty,
  topicRef: `class9-science/matter/${id}`,
});

/** Twenty nodes in a chain, which is how a chapter actually looks. */
const ids = Array.from({ length: 20 }, (_, i) => `n${i + 1}`);
const index = new GraphIndex({
  version: 1,
  nodes: ids.map((id, i) => node(id, i === 0 ? [] : [ids[i - 1]], i + 1)),
});

const answer = (nodeId: string, correct: boolean, n = 1): Answer => ({
  probeId: `p-${nodeId}-${n}`,
  nodeId,
  chosenIndex: correct ? 0 : 1,
  correct,
  ms: 4000,
});

/**
 * A student the app really produces: taught two things, below the line on the
 * other eighteen, and working through a plan with room for two of them.
 */
const student = (planIds: string[] = ['n1', 'n2']): DiagnosticResult => {
  /**
   * Taught the first two, and below the line from n6 on.
   *
   * The beliefs have to be written down. An unprobed node sits at PRIOR, PRIOR
   * is exactly GAP_THRESHOLD, and gapsFrom skips a node at the line — so a
   * fixture that only calls applyTaught has NO gaps at all, which is the state
   * that hid the bug this file exists for.
   */
  const mastery: Record<string, number> = { ...applyTaught({}, ['n1', 'n2'], 1) };
  for (const id of ids.slice(5)) mastery[id] = 0.3;
  return {
    mastery,
    gaps: gapsFrom(mastery, index, { threshold: GAP_THRESHOLD }),
    plan: planIds.map((nodeId) => ({ nodeId, reason: `${nodeId} is below the line` })),
    answers: [],
  };
};

describe('a test the student passed', () => {
  it('adds nothing, however many gaps the map still has elsewhere', () => {
    const before = student();
    // The state that hid this: eighteen gaps, none of them anything to do
    // with the two questions just answered.
    expect(before.gaps.length).toBeGreaterThan(10);

    const { added, after } = learnFromQuiz(
      before,
      [answer('n1', true), answer('n2', true)],
      index,
    );

    expect(added).toEqual([]);
    expect(after.plan.map((s) => s.nodeId)).not.toContain('n3');
  });

  it('takes off the plan what the student has now shown they hold', () => {
    const { dropped } = learnFromQuiz(
      student(),
      [answer('n1', true), answer('n1', true, 2), answer('n1', true, 3)],
      index,
    );
    expect(dropped.map((s) => s.nodeId)).toContain('n1');
  });
});

describe('a test the student failed', () => {
  it('adds what the failure actually revealed', () => {
    const { added } = learnFromQuiz(student(), [answer('n2', false)], index);
    expect(added.length).toBeGreaterThan(0);
    expect(added.length).toBeLessThanOrEqual(MAX_NEW_STEPS);
  });

  it('never adds a pre-existing gap the test did not ask about', () => {
    // The gaps at the far end of the chain were already gaps and were already
    // passed over by the plan that had room for twelve. A quiz about n2 is not
    // a reason to revisit that decision.
    const before = student();
    const { added } = learnFromQuiz(before, [answer('n2', false)], index);
    const wasAGap = new Set(before.gaps.map((g) => g.nodeId));
    const askedAbout = new Set(['n2']);
    for (const step of added) {
      expect(!wasAGap.has(step.nodeId) || askedAbout.has(step.nodeId)).toBe(true);
    }
  });
});

describe('the plan cap', () => {
  it('holds across many tests, which is where it used to be lost', () => {
    // Measured before the fix: six quizzes took a two-step plan to eighteen
    // steps, and it kept growing with the map.
    let result = student();
    for (let i = 0; i < 8; i += 1) {
      result = learnFromQuiz(result, [answer(`n${i + 2}`, false, i)], index).after;
      expect(result.plan.length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
    }
  });

  it('bites when a full plan meets a test that finds more', () => {
    /**
     * The case the eight-quiz loop above could not reach. That one starts from
     * a student who is ALREADY a gap almost everywhere, so each failure finds
     * little that is new and the plan crawls. Here the far end of the chain
     * sits just above the line, one wrong answer at the near end drags a dozen
     * nodes under it at once, and the plan is already full.
     */
    const onTheLine: Record<string, number> = { ...applyTaught({}, ['n1', 'n2'], 1) };
    for (const id of ids.slice(2)) onTheLine[id] = 0.55;
    const before: DiagnosticResult = {
      mastery: onTheLine,
      gaps: gapsFrom(onTheLine, index, { threshold: GAP_THRESHOLD }),
      // A full plan made of the FAR end, so the gaps the failure opens up at
      // n4-n8 are genuinely new steps competing for room that is gone.
      plan: ids.slice(8).map((nodeId) => ({ nodeId, reason: 'from the test' })),
      answers: [],
    };
    expect(before.plan).toHaveLength(MAX_PLAN_STEPS);

    const { after, added } = learnFromQuiz(before, [answer('n3', false)], index);

    // The failure really did find new gaps — otherwise this proves nothing.
    expect(after.gaps.length).toBeGreaterThan(before.gaps.length);
    expect(after.plan).toHaveLength(MAX_PLAN_STEPS);
    expect(added).toEqual([]);
  });

  it('reports as added only what survived the cap', () => {
    // "I have added 3 classes to your plan" over a plan that grew by none of
    // them is the one sentence a student would go looking for and not find.
    const full = student(ids.slice(0, MAX_PLAN_STEPS));
    const { added, after } = learnFromQuiz(full, [answer('n15', false)], index);
    const inPlan = new Set(after.plan.map((s) => s.nodeId));
    for (const step of added) expect(inPlan.has(step.nodeId)).toBe(true);
  });

  it('keeps the steps the student can already see, not the newest ones', () => {
    const full = student(ids.slice(0, MAX_PLAN_STEPS));
    const { after } = learnFromQuiz(full, [answer('n15', false)], index);
    // Nothing was dropped by mastery, so every original step stays put.
    expect(after.plan.slice(0, MAX_PLAN_STEPS).map((s) => s.nodeId)).toEqual(
      ids.slice(0, MAX_PLAN_STEPS),
    );
  });
});

describe('retaking the same test', () => {
  const failed = [answer('n3', false), answer('n4', false)];

  it('changes nothing the second time when the answers are the same', () => {
    // The quiz is deterministic so a retake is a real retest — which means the
    // identical probes come back. Folding them in again compounded belief
    // toward the ceiling and grew a localStorage-backed array by a whole quiz
    // each time.
    const once = learnFromQuiz(student(), failed, index).after;
    const twice = learnFromQuiz(once, failed, index);

    expect(twice.after).toBe(once);
    expect(twice.added).toEqual([]);
    expect(twice.after.answers).toHaveLength(failed.length);
  });

  it('does not let three retries talk a node over the line', () => {
    const right3 = [answer('n3', true), answer('n4', true)];
    let r = learnFromQuiz(student(), failed, index).after;
    const afterFirstFix = learnFromQuiz(r, right3, index).after;
    r = afterFirstFix;
    for (let i = 0; i < 3; i += 1) r = learnFromQuiz(r, right3, index).after;

    expect(r.mastery.n3).toBeCloseTo(afterFirstFix.mastery.n3, 10);
  });

  it('still counts an answer that CHANGED — that is what the retry was for', () => {
    const once = learnFromQuiz(student(), failed, index).after;
    const fixed = learnFromQuiz(once, [answer('n3', true), answer('n4', false)], index);

    expect(fixed.after).not.toBe(once);
    expect(fixed.after.mastery.n3).toBeGreaterThan(once.mastery.n3!);
    // One changed answer stored, not a second whole quiz.
    expect(fixed.after.answers).toHaveLength(failed.length + 1);
  });
});

describe('the trained model', () => {
  it('is used when it is given, so an untrusted edge carries nothing', () => {
    // A WRONG answer speaks downward, about everything built on the gap: n5 is
    // n6's prerequisite, so failing n5 drags n6 with it. Unless the
    // calibration has watched students hold n6 without n5 and concluded the
    // edge is fiction — which is what support 0 says.
    const answers = [answer('n5', false)];
    const untrusting = learnFromQuiz(student(), answers, index, {
      params: {
        version: 1,
        items: {},
        edges: { [edgeKey('n6', 'n5')]: { support: 0, violations: 40, observations: 40 } },
        updatedAt: null,
        observations: 40,
      },
    });
    const trusting = learnFromQuiz(student(), answers, index);

    expect(untrusting.after.mastery.n6!).toBeGreaterThan(trusting.after.mastery.n6!);
    // And the node actually asked about moves the same either way: the
    // calibration governs what travels, not what was measured.
    expect(untrusting.after.mastery.n5!).toBeCloseTo(trusting.after.mastery.n5!, 10);
  });
});
