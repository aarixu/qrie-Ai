import { describe, expect, it } from 'vitest';
import {
  STUDENT_CLASSES,
  createConductor,
  leaks,
  validatePlan,
  type Conductor,
  type ConductorOptions,
  type Move,
  type PlanQuestion,
  type Reading,
  type StudentClass,
  type TeachingPlan,
} from '../src/index';
import { PLAN, planCopy } from './fixtures/respirationPlan';

/**
 * THE CONDUCTOR, TURN BY TURN.
 *
 * A live class from a plan: the opener, then per idea predict → explain →
 * check → teach back, a recap, a close. Code picks every move; `decide()` is
 * the help ladder on graded questions; every move says why; `preview` is
 * `hear` without the change.
 */

const T0 = 1_000_000;
const MIN = 60_000;

const IDEA0 = PLAN.ideas[0];
const IDEA1 = PLAN.ideas[1];
const Q_WHERE = IDEA0.points[0].ask;
const Q_GAS = IDEA0.points[1].ask;
const MIS = Q_WHERE.misconceptions[0];
const SECRETS_WHERE = ['in every cell', 'In every living cell'];

function setup(over: Partial<ConductorOptions> = {}, plan: TeachingPlan = PLAN) {
  let t = T0;
  const c = createConductor(plan, { lang: 'en', now: () => t, ...over });
  return {
    c,
    tick: (ms: number) => {
      t += ms;
    },
    at: (ms: number) => {
      t = T0 + ms;
    },
  };
}

const r = (cls: StudentClass, misconceptionId?: string): Reading => ({
  class: cls,
  said: `(${cls})`,
  ...(misconceptionId ? { misconceptionId } : {}),
});

/** Start, answer the opener and the prediction: `q-where` is held. */
function toQWhere(c: Conductor): Move {
  c.start();
  c.hear(r('right'));
  return c.hear(r('right'));
}

/** On to `idea-what`'s teach-back, every answer right and cold. */
function toTeachBack(c: Conductor): Move {
  toQWhere(c);
  c.hear(r('right')); // q-where
  c.hear(r('right')); // q-gas
  return c.hear(r('right')); // c-release
}

describe('a whole class', () => {
  it('runs opener → prediction → points → check → teach-back → the next idea → an interleaved retest → recap → close', () => {
    const { c } = setup();

    const open = c.start();
    expect(open).toMatchObject({
      seq: 1,
      kind: 'open',
      ideaId: null,
      heldQuestionId: 'opener',
      handsOver: true,
      board: { beatId: 'b1', focus: ['e1'] },
      content: { ask: PLAN.opener.question },
      helped: null,
      requested: false,
      maxSentences: 3,
      final: false,
    });
    expect(open.ack).toBeUndefined();
    expect(open.because).toMatch(/question from the student's life, not an announcement/);

    const predict = c.hear(r('right'));
    expect(predict).toMatchObject({
      seq: 2,
      kind: 'predict',
      ideaId: 'idea-what',
      heldQuestionId: 'predict-plants',
      board: null,
      ack: { of: 'right', why: PLAN.opener.why },
      content: { ask: IDEA0.predict!.question },
    });
    expect(predict.evidence).toBeUndefined();

    // A wrong prediction is fine: acknowledged, not graded, then the point.
    const explain = c.hear(r('wrong'));
    expect(explain).toMatchObject({
      kind: 'explain',
      heldQuestionId: 'q-where',
      ack: { of: 'wrong' },
      content: { say: IDEA0.points[0].say, ask: Q_WHERE.question },
      maxSentences: 3,
      board: null,
      mustNotReveal: SECRETS_WHERE,
    });
    expect(explain.ack?.why).toBeUndefined();
    expect(explain.evidence).toBeUndefined();

    const probe = c.hear(r('wrong', 'breathing-is-respiration'));
    expect(probe).toMatchObject({
      kind: 'probeWhy',
      heldQuestionId: 'q-where',
      ack: { of: 'wrong', misconceptionId: 'breathing-is-respiration' },
      content: { ask: MIS.followUp },
      evidence: { questionId: 'q-where', nodeIds: ['resp.site'], correct: false, rung: 0 },
      helped: 1,
      requested: false,
      strategy: 'followUp',
    });
    expect(probe.content.say).toBeUndefined();
    expect(probe.because).toMatch(/misconception breathing-is-respiration: ask its follow-up before explaining anything \(C7\)/);

    // Their reply to the follow-up is reasoning: the misconception's why, the question again, no evidence.
    const reasoned = c.hear(r('partly'));
    expect(reasoned).toMatchObject({
      kind: 'explain',
      heldQuestionId: 'q-where',
      ack: { of: 'partly', misconceptionId: 'breathing-is-respiration', why: MIS.why },
      content: { say: MIS.why, ask: Q_WHERE.question },
      helped: null,
      strategy: 'after-follow-up',
    });
    expect(reasoned.evidence).toBeUndefined();
    expect(c.snapshot().attempt).toBe(2);

    const next = c.hear(r('right'));
    expect(next).toMatchObject({
      kind: 'explain',
      heldQuestionId: 'q-gas',
      ack: { of: 'right', why: Q_WHERE.why },
      evidence: { questionId: 'q-where', correct: true, rung: 1 },
      content: { say: IDEA0.points[1].say, ask: Q_GAS.question },
    });
    expect(next.because).toMatch(/retest c-hungry queued for after idea idea-oxygen's points/);

    const check = c.hear(r('right'));
    expect(check).toMatchObject({
      kind: 'check',
      ideaId: 'idea-what',
      heldQuestionId: 'c-release',
      board: null,
      evidence: { questionId: 'q-gas', correct: true, rung: 0 },
    });
    expect(c.snapshot().phase).toBe('idea:check');

    const teachBack = c.hear(r('right'));
    expect(teachBack).toMatchObject({ kind: 'teachBack', heldQuestionId: 'idea-what#teach-back', content: { ask: IDEA0.teachBack.prompt } });
    expect(c.held()).toMatchObject({ id: 'idea-what#teach-back', expect: IDEA0.teachBack.expect, nodeIds: IDEA0.nodeIds });

    const idea2 = c.hear(r('right'));
    expect(idea2).toMatchObject({
      kind: 'explain',
      ideaId: 'idea-oxygen',
      heldQuestionId: 'q-sprint',
      board: { beatId: 'b2' },
      content: { say: IDEA1.points[0].say },
      evidence: { questionId: 'idea-what#teach-back', nodeIds: ['resp.definition', 'resp.site'], correct: true, rung: 0 },
    });

    // The retest of idea-what comes after idea-oxygen's points and before its check.
    const retest = c.hear(r('right'));
    expect(retest).toMatchObject({ kind: 'check', ideaId: 'idea-what', heldQuestionId: 'c-hungry', strategy: 'retest', board: null });
    expect(c.snapshot().phase).toBe('idea:retest');

    expect(c.hear(r('right'))).toMatchObject({ kind: 'check', ideaId: 'idea-oxygen', heldQuestionId: 'c-aerobic', board: null });
    expect(c.hear(r('right'))).toMatchObject({ kind: 'teachBack', heldQuestionId: 'idea-oxygen#teach-back' });

    const recap = c.hear(r('right'));
    expect(recap).toMatchObject({ kind: 'recap', ideaId: null, heldQuestionId: null, mustNotReveal: [], content: { ask: PLAN.recap.prompts[0] } });
    expect(c.held()).toBeNull();

    const recap2 = c.hear(r('partly'));
    expect(recap2).toMatchObject({ kind: 'recap', ack: { of: 'partly' }, content: { ask: PLAN.recap.prompts[1] } });
    expect(recap2.evidence).toBeUndefined();

    const close = c.hear(r('right'));
    expect(close).toMatchObject({
      seq: 15,
      kind: 'close',
      final: true,
      handsOver: false,
      heldQuestionId: null,
      ideaId: null,
      ack: { of: 'right' },
      content: { say: 'Today we worked through What respiration is and With and without oxygen.' },
      maxSentences: 3,
    });
    expect(close.content.ask).toBeUndefined();

    expect(c.snapshot()).toMatchObject({ done: true, phase: 'close', seq: 15, heldQuestionId: null, attempt: 0 });
    expect(c.snapshot().evidence.map((e) => [e.questionId, e.correct, e.rung])).toEqual([
      ['q-where', false, 0],
      ['q-where', true, 1],
      ['q-gas', true, 0],
      ['c-release', true, 0],
      ['idea-what#teach-back', true, 0],
      ['q-sprint', true, 0],
      ['c-hungry', true, 0],
      ['c-aerobic', true, 0],
      ['idea-oxygen#teach-back', true, 0],
    ]);
  });
});

describe('the help ladder on a graded question', () => {
  it('climbs rethink → hint → worked example → another way → reveal, then moves on with a retest asked later', () => {
    const { c } = setup();
    toQWhere(c);

    const rethink = c.hear(r('wrong'));
    expect(rethink).toMatchObject({ kind: 'probeMore', ack: { of: 'wrong' }, content: { ask: Q_WHERE.question }, helped: 1, strategy: 'rethink' });
    expect(rethink.evidence).toEqual({ questionId: 'q-where', nodeIds: ['resp.site'], correct: false, rung: 0 });

    const hint = c.hear(r('dontKnow'));
    expect(hint).toMatchObject({ kind: 'hint', ack: { of: 'dontKnow' }, content: { say: Q_WHERE.hint, ask: Q_WHERE.question }, helped: 3 });
    expect(hint.evidence).toMatchObject({ correct: false, rung: 1 });

    const worked = c.hear(r('wrong'));
    expect(worked).toMatchObject({ kind: 'workedExample', content: { steps: Q_WHERE.workedExample!.steps, ask: Q_WHERE.question }, helped: 5 });
    expect(worked.evidence).toMatchObject({ rung: 3 });

    const another = c.hear(r('wrong'));
    expect(another).toMatchObject({ kind: 'anotherWay', content: { say: Q_WHERE.alternates[0].say, ask: Q_WHERE.question }, helped: 7, strategy: 'analogy' });
    expect(another.evidence).toMatchObject({ rung: 5 });

    for (const m of [rethink, hint, worked, another]) {
      expect(m.heldQuestionId).toBe('q-where');
      expect(m.mustNotReveal).toEqual(SECRETS_WHERE);
      expect(m.handsOver).toBe(true);
    }

    const reveal = c.hear(r('wrong'));
    expect(reveal).toMatchObject({
      kind: 'reveal',
      ack: { of: 'wrong' },
      heldQuestionId: 'q-gas',
      helped: 8,
      strategy: 'reveal',
      handsOver: true,
      content: { ask: Q_GAS.question },
      evidence: { questionId: 'q-where', correct: false, rung: 7 },
      // It carries the next point's explanation, so it takes the explain cap.
      maxSentences: 3,
    });
    expect(reveal.content.say).toBe(`In every living cell. ${Q_WHERE.why} ${IDEA0.points[1].say}`);
    expect(reveal.mustNotReveal).toEqual(['carbon dioxide', 'Carbon dioxide']);
    expect(reveal.because).toMatch(/answer and why \(L8\).*retest c-hungry queued/);

    c.hear(r('right')); // q-gas → c-release
    c.hear(r('right')); // → teach-back
    c.hear(r('right')); // → q-sprint
    const retest = c.hear(r('right'));
    expect(retest).toMatchObject({ kind: 'check', heldQuestionId: 'c-hungry', ideaId: 'idea-what' });

    // The retest needs help too: the next fresh check (c-name) is queued, and left over before the recap.
    c.hear(r('wrong'));
    const helped = c.hear(r('right'));
    expect(helped.because).toMatch(/retest c-name queued for before the recap/);
    expect(helped.heldQuestionId).toBe('c-aerobic');
    c.hear(r('right')); // → teach-back
    const leftover = c.hear(r('right'));
    expect(leftover).toMatchObject({ kind: 'check', heldQuestionId: 'c-name', ideaId: 'idea-what' });
    expect(c.snapshot().phase).toBe('retest');
    expect(c.hear(r('right')).kind).toBe('recap');
  });

  it('keeps one queued retest per idea', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('wrong'));
    expect(c.hear(r('right')).because).toMatch(/retest c-hungry queued/);
    c.hear(r('wrong'));
    expect(c.hear(r('right')).because).toMatch(/a retest of idea idea-what is already queued/);
  });

  it('skips the worked example where none is authored', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('right')); // → q-gas
    expect(c.hear(r('wrong')).kind).toBe('probeMore');
    expect(c.hear(r('wrong')).kind).toBe('hint');
    const alt = c.hear(r('wrong'));
    expect(alt).toMatchObject({ kind: 'anotherWay', content: { say: Q_GAS.alternates[0].say } });
    expect(alt.because).toMatch(/no usable worked example: none authored/);
    expect(c.hear(r('wrong'))).toMatchObject({ kind: 'reveal', heldQuestionId: 'c-release' });
  });

  it('asks for the missing part on a first partly, then treats a second like a miss', () => {
    const { c } = setup();
    toQWhere(c);
    const probe = c.hear(r('partly'));
    expect(probe).toMatchObject({
      kind: 'probeMore',
      ack: { of: 'partly' },
      content: { ask: Q_WHERE.hint },
      helped: 1,
      strategy: 'probe-more',
      evidence: { correct: false, rung: 0 },
      mustNotReveal: SECRETS_WHERE,
    });
    const hint = c.hear(r('partly'));
    expect(hint).toMatchObject({ kind: 'hint', ack: { of: 'partly' }, helped: 3, evidence: { correct: false, rung: 1 } });
    expect(c.hear(r('right')).evidence).toMatchObject({ questionId: 'q-where', correct: true, rung: 3 });
  });

  it('gives a different alternate on a second "another way", files L7 and does not climb', () => {
    const { c } = setup();
    toQWhere(c);
    const first = c.hear(r('explainRequest'));
    expect(first).toMatchObject({ kind: 'anotherWay', ack: { of: 'explainRequest' }, content: { say: Q_WHERE.alternates[0].say }, helped: 7, requested: true });
    expect(first.evidence).toBeUndefined();
    const second = c.hear(r('explainRequest'));
    expect(second).toMatchObject({ kind: 'anotherWay', content: { say: Q_WHERE.alternates[1].say }, strategy: 'everyday', requested: true });
    // No climb: the first miss after it is still the rethink, and the answer is filed at the L7 help it had.
    const miss = c.hear(r('wrong'));
    expect(miss).toMatchObject({ kind: 'probeMore', evidence: { rung: 7 } });
  });

  it('gives a hint on request, never past L3', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.hear(r('hintRequest'))).toMatchObject({ kind: 'hint', ack: { of: 'hintRequest' }, helped: 3, requested: true, content: { say: Q_WHERE.hint } });
    expect(c.hear(r('hintRequest'))).toMatchObject({ kind: 'hint', helped: 3, requested: true });
    expect(c.snapshot()).toMatchObject({ heldQuestionId: 'q-where', attempt: 1, rung: 3 });
  });

  it('retests after a cold right answer against a weak record', () => {
    const { c } = setup({ mastery: () => 0.2 });
    toQWhere(c);
    const next = c.hear(r('right'));
    expect(next.evidence).toMatchObject({ questionId: 'q-where', correct: true, rung: 0 });
    expect(next.because).toMatch(/weak unassisted record.*retest c-hungry queued/);
  });
});

describe('a named misconception', () => {
  it('drops the follow-up when help is asked for, and grades the next answer', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('wrong', 'breathing-is-respiration'));
    expect(c.hear(r('question'))).toMatchObject({ kind: 'answerDoubt', content: { ask: MIS.followUp } });
    expect(c.silence(5000)).toMatchObject({ kind: 'nudge', content: { ask: MIS.followUp } });
    const hint = c.hear(r('hintRequest'));
    expect(hint).toMatchObject({ kind: 'hint', content: { ask: Q_WHERE.question } });
    const worked = c.hear(r('wrong'));
    expect(worked).toMatchObject({ kind: 'workedExample', evidence: { correct: false } });
  });

  it('asks the follow-up only on the first miss', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.hear(r('wrong', 'breathing-is-respiration')).kind).toBe('probeWhy');
    expect(c.hear(r('wrong')).kind).toBe('explain'); // reasoning
    const again = c.hear(r('wrong', 'breathing-is-respiration'));
    expect(again).toMatchObject({ kind: 'hint', ack: { of: 'wrong', misconceptionId: 'breathing-is-respiration' } });
  });

  it('ignores a misconception id the held question does not have', () => {
    const { c } = setup();
    toQWhere(c);
    const m = c.hear(r('wrong', 'oxygen-out'));
    expect(m).toMatchObject({ kind: 'probeMore', ack: { of: 'wrong' } });
    expect(m.ack?.misconceptionId).toBeUndefined();
  });

  it('re-asks a check (not an explain) after the reasoning on a check', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('right'));
    c.hear(r('right')); // → c-release
    expect(c.hear(r('wrong', 'breathing-is-respiration')).kind).toBe('probeWhy');
    expect(c.hear(r('dontKnow'))).toMatchObject({ kind: 'check', maxSentences: 2, heldQuestionId: 'c-release' });
  });
});

describe('doubts, off-topic, unclear and chat', () => {
  it('answers a doubt and asks again, changing nothing', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('wrong'));
    const before = c.snapshot();
    const doubt = c.hear(r('question'));
    expect(doubt).toMatchObject({
      kind: 'answerDoubt',
      ack: { of: 'question' },
      content: { ask: Q_WHERE.question },
      helped: null,
      strategy: 'doubt',
      heldQuestionId: 'q-where',
      mustNotReveal: SECRETS_WHERE,
    });
    expect(doubt.evidence).toBeUndefined();
    const after = c.snapshot();
    expect(after).toMatchObject({ attempt: before.attempt, rung: before.rung, heldQuestionId: before.heldQuestionId });
    expect(after.evidence).toEqual(before.evidence);
  });

  it('redirects off-topic, and asks again after unclear or chat, with no evidence', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.hear(r('offTopic'))).toMatchObject({ kind: 'redirect', ack: { of: 'offTopic' }, content: { ask: Q_WHERE.question }, helped: null });
    expect(c.hear(r('unclear'))).toMatchObject({ kind: 'sayAgain', ack: { of: 'unclear' }, content: { ask: Q_WHERE.question } });
    expect(c.hear(r('chat'))).toMatchObject({ kind: 'sayAgain', ack: { of: 'chat' } });
    expect(c.snapshot()).toMatchObject({ attempt: 1, rung: 0, evidence: [] });
  });

  it('reads a class outside the contract as unclear', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.hear({ class: 'banana' as StudentClass, said: '' })).toMatchObject({ kind: 'sayAgain', ack: { of: 'unclear' } });
  });
});

describe('silence', () => {
  it('nudges, then checks in, then gives help as a hint request they did not make', () => {
    const { c } = setup();
    toQWhere(c);
    const nudge = c.silence(5000);
    expect(nudge).toMatchObject({ kind: 'nudge', helped: 1, requested: false, content: { ask: Q_WHERE.question }, heldQuestionId: 'q-where' });
    expect(nudge.ack).toBeUndefined();
    expect(nudge.content.say).toBeUndefined();
    expect(nudge.evidence).toBeUndefined();

    const checkIn = c.silence(5000);
    expect(checkIn).toMatchObject({ kind: 'checkIn', helped: null, content: { ask: 'Would a hint help, or shall I explain it another way?' } });
    expect(checkIn.ack).toBeUndefined();

    const hint = c.silence(5000);
    expect(hint).toMatchObject({ kind: 'hint', helped: 3, requested: false, content: { say: Q_WHERE.hint, ask: Q_WHERE.question } });
    expect(hint.because).toMatch(/silence 3 \(5000 ms\), answered as a hint request they did not make/);
    expect(c.silence(5000)).toMatchObject({ kind: 'hint', helped: 3, requested: false });

    const right = c.hear(r('right'));
    expect(right.evidence).toMatchObject({ questionId: 'q-where', correct: true, rung: 3 });
    expect(right.because).toMatch(/retest c-hungry queued/);
  });

  it('counts only silences in a row: any spoken turn resets it', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.silence(4000).kind).toBe('nudge');
    c.hear(r('unclear'));
    expect(c.silence(4000).kind).toBe('nudge');
    expect(c.silence(4000).kind).toBe('checkIn');
  });

  it('on the opener: nudge, check in, its hint, then move on — nothing filed', () => {
    const { c } = setup();
    c.start();
    expect(c.silence(4000)).toMatchObject({ kind: 'nudge', helped: null, content: { ask: PLAN.opener.question } });
    expect(c.silence(4000)).toMatchObject({ kind: 'checkIn', content: { ask: 'Would a hint help, or shall we find out together?' } });
    expect(c.silence(4000)).toMatchObject({ kind: 'hint', helped: null, requested: false, content: { say: PLAN.opener.hint } });
    const on = c.silence(4000);
    expect(on).toMatchObject({ kind: 'predict', heldQuestionId: 'predict-plants' });
    expect(on.ack).toBeUndefined();
    expect(c.snapshot().evidence).toEqual([]);
  });

  it('in the recap: nudge, check in, then the next prompt', () => {
    const { c } = setup();
    toQWhere(c);
    c.end(); // → recap
    expect(c.silence(4000)).toMatchObject({ kind: 'nudge', content: { ask: PLAN.recap.prompts[0] }, heldQuestionId: null });
    expect(c.silence(4000)).toMatchObject({ kind: 'checkIn' });
    expect(c.silence(4000)).toMatchObject({ kind: 'recap', content: { ask: PLAN.recap.prompts[1] } });
  });
});

describe('the opener and predictions are not graded', () => {
  const answerLike: StudentClass[] = ['right', 'partly', 'wrong', 'dontKnow', 'chat'];

  for (const cls of answerLike) {
    it(`${cls} to the opener and to a prediction: acknowledged, moved on, no evidence`, () => {
      const { c } = setup();
      c.start();
      const toPredict = c.hear(r(cls));
      expect(toPredict).toMatchObject({ kind: 'predict', ack: { of: cls } });
      expect(toPredict.evidence).toBeUndefined();
      expect(toPredict.ack?.why).toBe(cls === 'right' ? PLAN.opener.why : undefined);
      const toExplain = c.hear(r(cls));
      expect(toExplain).toMatchObject({ kind: 'explain', ack: { of: cls } });
      expect(toExplain.evidence).toBeUndefined();
      expect(c.snapshot().evidence).toEqual([]);
    });
  }

  it('a hint request on the opener gets its hint once, then moves on', () => {
    const { c } = setup();
    c.start();
    expect(c.hear(r('hintRequest'))).toMatchObject({ kind: 'hint', helped: null, requested: true, content: { say: PLAN.opener.hint, ask: PLAN.opener.question } });
    expect(c.hear(r('hintRequest'))).toMatchObject({ kind: 'predict', ack: { of: 'hintRequest' } });
  });

  it('asking to be told on a prediction moves on to the explanation', () => {
    const { c } = setup();
    c.start();
    c.hear(r('right'));
    expect(c.hear(r('explainRequest'))).toMatchObject({ kind: 'explain', ack: { of: 'explainRequest' }, heldQuestionId: 'q-where' });
  });

  it('a wrong prediction naming a misconception is acknowledged with it, still not graded', () => {
    const { c } = setup();
    c.start();
    c.hear(r('right'));
    const m = c.hear(r('wrong', 'plants-only-photosynthesise'));
    expect(m).toMatchObject({ kind: 'explain', ack: { of: 'wrong', misconceptionId: 'plants-only-photosynthesise' } });
    expect(m.evidence).toBeUndefined();
  });

  it('skips the prediction when every node of the idea is held cold, never the check', () => {
    const cold = setup({ mastery: () => 0.9 }).c;
    cold.start();
    const first = cold.hear(r('right'));
    expect(first).toMatchObject({ kind: 'explain', heldQuestionId: 'q-where' });
    expect(first.because).toMatch(/no prediction: every node of the idea is held cold/);

    const partial = setup({ mastery: (n) => (n === 'resp.definition' ? 0.9 : undefined) }).c;
    partial.start();
    expect(partial.hear(r('right')).kind).toBe('predict');
  });
});

describe('the teach-back', () => {
  it('counts right or partly as correct evidence on the idea', () => {
    for (const cls of ['right', 'partly'] as const) {
      const { c } = setup();
      toTeachBack(c);
      const m = c.hear(r(cls));
      expect(m.evidence).toEqual({ questionId: 'idea-what#teach-back', nodeIds: IDEA0.nodeIds, correct: true, rung: 0 });
      expect(m).toMatchObject({ kind: 'explain', ideaId: 'idea-oxygen', ack: { of: cls } });
    }
  });

  it('gives the core once on a miss, files it, and moves on with no ladder', () => {
    for (const cls of ['wrong', 'dontKnow'] as const) {
      const { c } = setup();
      toTeachBack(c);
      const m = c.hear(r(cls));
      expect(m.evidence).toEqual({ questionId: 'idea-what#teach-back', nodeIds: IDEA0.nodeIds, correct: false, rung: 0 });
      expect(m).toMatchObject({ kind: 'explain', ideaId: 'idea-oxygen', ack: { of: cls, why: IDEA0.points[0].say } });
    }
  });

  it('helps once another way (L7), then moves on without evidence', () => {
    const { c } = setup();
    toTeachBack(c);
    const help = c.hear(r('hintRequest'));
    expect(help).toMatchObject({
      kind: 'anotherWay',
      heldQuestionId: 'idea-what#teach-back',
      content: { say: Q_WHERE.alternates[0].say, ask: IDEA0.teachBack.prompt },
      helped: 7,
      requested: true,
      strategy: 'analogy',
    });
    const on = c.hear(r('explainRequest'));
    expect(on).toMatchObject({ kind: 'explain', ideaId: 'idea-oxygen', ack: { of: 'explainRequest', why: IDEA0.points[0].say } });
    expect(on.evidence).toBeUndefined();
  });

  it('files an answer after that help at its rung', () => {
    const { c } = setup();
    toTeachBack(c);
    c.hear(r('explainRequest'));
    expect(c.hear(r('right')).evidence).toMatchObject({ correct: true, rung: 7 });
  });
});

describe('mustNotReveal', () => {
  it('holds the expect and answer until a right answer or the reveal, then the next question takes over', () => {
    const { c } = setup();
    const moves = [toQWhere(c), c.hear(r('wrong')), c.hear(r('question')), c.silence(3000), c.hear(r('hintRequest')), c.hear(r('wrong'))];
    for (const m of moves) expect(m.mustNotReveal).toEqual(SECRETS_WHERE);
    const next = c.hear(r('right'));
    expect(next.heldQuestionId).toBe('q-gas');
    expect(next.mustNotReveal).toEqual(['carbon dioxide', 'Carbon dioxide']);
    expect(next.mustNotReveal).not.toContain(SECRETS_WHERE[0]);
  });

  it('also holds the opener, a prediction and a teach-back, which ask before they tell', () => {
    const { c } = setup();
    expect(c.start().mustNotReveal).toEqual([PLAN.opener.expect, PLAN.opener.answer]);
    expect(c.hear(r('right')).mustNotReveal).toEqual([IDEA0.predict!.expect, IDEA0.predict!.answer]);
    const tb = setup().c;
    expect(toTeachBack(tb).mustNotReveal).toEqual([IDEA0.teachBack.expect]);
  });

  it('is empty when nothing is held', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.end().mustNotReveal).toEqual([]);
    expect(c.end().mustNotReveal).toEqual([]);
  });

  it('leaves out, for that move only, a secret the move itself must say', () => {
    const plan = planCopy();
    plan.ideas[0].points[1].say = 'Cells give out carbon dioxide and water as waste.';
    expect(validatePlan(plan).ok).toBe(true);
    const { c } = setup({}, plan);
    toQWhere(c);
    const explain = c.hear(r('right'));
    expect(explain).toMatchObject({ kind: 'explain', heldQuestionId: 'q-gas', mustNotReveal: [] });
    expect(c.hear(r('wrong')).mustNotReveal).toEqual(['carbon dioxide', 'Carbon dioxide']);
  });
});

describe('time', () => {
  it('goes straight to the recap once time is up, at the next step', () => {
    const { c, at } = setup();
    c.start();
    c.hear(r('right')); // → predict
    at(20 * MIN);
    const m = c.hear(r('wrong'));
    expect(m).toMatchObject({ kind: 'recap', ack: { of: 'wrong' }, content: { ask: PLAN.recap.prompts[0] }, heldQuestionId: null });
    expect(m.because).toMatch(/time is up \(20\.0 of 20 min\): straight to the recap, skipping 1 idea\(s\) not begun and 0 queued retest\(s\)/);
  });

  it('does not cut a ladder short, and closes at the hard stop keeping the answer as evidence', () => {
    const { c, at } = setup();
    toQWhere(c);
    at(21 * MIN);
    expect(c.hear(r('wrong')).kind).toBe('probeMore');
    at(23 * MIN);
    const end = c.hear(r('right'));
    expect(end).toMatchObject({ kind: 'close', final: true, handsOver: false, ack: { of: 'right' }, evidence: { questionId: 'q-where', correct: true, rung: 1 } });
    expect(end.because).toMatch(/hard stop: 23\.0 min is past 20 \+ 3 min, so close/);
    expect(c.snapshot().evidence).toHaveLength(2);
  });

  it('closes a recap that runs past the hard stop', () => {
    const { c, at } = setup();
    toQWhere(c);
    at(20 * MIN);
    expect(c.hear(r('right')).kind).toBe('recap');
    at(23 * MIN);
    expect(c.silence(4000)).toMatchObject({ kind: 'close', final: true });
  });

  it('takes opts.minutes over the plan', () => {
    const { c, at } = setup({ minutes: 5 });
    toQWhere(c);
    at(5 * MIN);
    expect(c.hear(r('right')).kind).toBe('recap');
  });

  it('closes when time is up before any idea began', () => {
    const { c, at } = setup();
    c.start();
    at(20 * MIN);
    expect(c.hear(r('right'))).toMatchObject({ kind: 'close', content: { say: 'We stopped before the first idea of Respiration.' } });
  });
});

describe('end, stop and the close', () => {
  it('end(): the recap if it has not run and an idea began, else the close', () => {
    const early = setup().c;
    early.start();
    const closed = early.end();
    expect(closed).toMatchObject({ kind: 'close', final: true });
    expect(closed.because).toMatch(/no idea has begun: close/);

    const { c } = setup();
    toQWhere(c);
    const recap = c.end();
    expect(recap).toMatchObject({ kind: 'recap', content: { ask: PLAN.recap.prompts[0] }, heldQuestionId: null });
    expect(recap.ack).toBeUndefined();
    expect(recap.because).toMatch(/the recap first/);
    expect(c.end()).toMatchObject({ kind: 'close', content: { say: 'Today we worked through What respiration is.' } });
  });

  it('stop closes at once, and the close is returned for every call after, seq unchanged', () => {
    const { c, tick } = setup();
    toQWhere(c);
    const close = c.hear(r('stop'));
    expect(close).toMatchObject({ kind: 'close', final: true, handsOver: false, ack: { of: 'stop' }, seq: 4 });
    tick(30 * MIN);
    for (const again of [c.hear(r('right')), c.silence(1000), c.end(), c.start(), c.preview({ class: 'wrong' })]) {
      expect(again).toBe(close);
    }
    expect(c.snapshot()).toMatchObject({ seq: 4, done: true });
  });

  it('before start(): hear starts the class; end closes it; preview changes nothing', () => {
    const a = setup().c;
    expect(a.preview({ class: 'right' })).toMatchObject({ seq: 1, kind: 'open' });
    expect(a.snapshot()).toMatchObject({ seq: 0, phase: 'ready', done: false });
    expect(a.hear(r('right'))).toMatchObject({ seq: 1, kind: 'open' });
    expect(a.start()).toMatchObject({ seq: 1, kind: 'open' });

    const b = setup().c;
    expect(b.end()).toMatchObject({ seq: 1, kind: 'close', content: { say: 'We stopped before the first idea of Respiration.' } });
  });
});

// ─── Properties over many states ───────────────────────────────────────────

type Ev = { hear: StudentClass; m?: string } | { silence: number } | { end: true };

/** A small deterministic generator (LCG), so every run replays the same scripts. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const MISCONCEPTION_IDS = ['breathing-is-respiration', 'oxygen-out', 'anaerobic-mixup', 'plants-only-photosynthesise', 'not-in-the-plan'];

function script(seed: number, n: number, allowStop: boolean): Ev[] {
  const next = rng(seed);
  const pool: StudentClass[] = ['right', 'right', 'right', 'partly', 'wrong', 'wrong', 'dontKnow', 'question', 'hintRequest', 'explainRequest', 'offTopic', 'unclear', 'chat'];
  const out: Ev[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = next();
    if (x < 0.12) out.push({ silence: 3000 + Math.floor(next() * 4000) });
    else if (allowStop && x > 0.995) out.push({ hear: 'stop' });
    else if (allowStop && x > 0.99) out.push({ end: true });
    else {
      const cls = pool[Math.floor(next() * pool.length)];
      out.push(cls === 'wrong' && next() < 0.5 ? { hear: cls, m: MISCONCEPTION_IDS[Math.floor(next() * MISCONCEPTION_IDS.length)] } : { hear: cls });
    }
  }
  return out;
}

const STEP_MS = 20_000;

function apply(c: Conductor, e: Ev): Move {
  if ('silence' in e) return c.silence(e.silence);
  if ('end' in e) return c.end();
  return c.hear(r(e.hear, e.m));
}

/** A fresh class with `events` played, `stepMs` of clock apart. */
function replay(events: readonly Ev[], stepMs: number): Conductor {
  const { c, tick } = setup();
  c.start();
  for (const e of events) {
    tick(stepMs);
    apply(c, e);
  }
  tick(stepMs);
  return c;
}

/** The contract's promises about any single move. */
function checkMove(m: Move, held: PlanQuestion | null): void {
  expect(m.because.trim().length).toBeGreaterThan(0);
  expect(m.final).toBe(m.kind === 'close');
  expect(m.handsOver).toBe(m.kind !== 'close');
  if (m.handsOver) expect(m.content.ask?.trim()).toBeTruthy();
  expect(m.heldQuestionId).toBe(held?.id ?? null);
  const cap = m.kind === 'open' || m.kind === 'explain' || m.kind === 'close' ? 3 : 2;
  expect(m.maxSentences === cap || (m.kind === 'reveal' && m.maxSentences === 3)).toBe(true);
  if (m.kind === 'nudge' || m.kind === 'checkIn' || m.kind === 'open') expect(m.ack).toBeUndefined();
  if (m.evidence) expect(m.evidence.rung).toBeGreaterThanOrEqual(0);
  if (!held) {
    expect(m.mustNotReveal).toEqual([]);
    return;
  }
  // Every secret of what is held is protected, unless this move must itself say it.
  const spoken = [m.content.say, m.ack?.why, ...(m.content.steps ?? []).flatMap((s) => [s.say, s.line])].filter(
    (t): t is string => typeof t === 'string',
  );
  for (const secret of [held.expect, held.answer]) {
    expect(m.mustNotReveal.includes(secret.trim()) || spoken.some((t) => leaks(t, [secret]))).toBe(true);
  }
}

describe('properties', () => {
  it('every move keeps the contract, across 40 scripted classes', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { c, tick } = setup();
      let last = c.start();
      checkMove(last, c.held());
      for (const e of script(seed, 120, true)) {
        tick(STEP_MS);
        const m = apply(c, e);
        if (last.kind === 'close') {
          expect(m).toBe(last);
          continue;
        }
        expect(m.seq).toBe(last.seq + 1);
        checkMove(m, c.held());
        expect(c.snapshot().seq).toBe(m.seq);
        last = m;
      }
      // 120 turns at 20 s each run past the hard stop: every class has closed.
      expect(c.snapshot().done).toBe(true);
    }
  });

  it('preview(reading) is exactly the move hear(reading) makes, for every class at every state, and changes nothing', () => {
    // 55 turns 30 s apart: each script crosses the 20-minute recap and the 23-minute hard stop.
    const stepMs = 30_000;
    const phases = new Set<string>();
    for (const seed of [7, 21, 99]) {
      const events = script(seed, 55, false);
      for (let k = 0; k <= events.length; k += 1) {
        const prefix = events.slice(0, k);
        const probe = replay(prefix, stepMs);
        phases.add(probe.snapshot().phase);
        const held = probe.held();
        const readings: Omit<Reading, 'said'>[] = [
          ...STUDENT_CLASSES.map((cls) => ({ class: cls })),
          ...(held?.misconceptions ?? []).map((m) => ({ class: 'wrong' as const, misconceptionId: m.id })),
          { class: 'wrong', misconceptionId: 'not-in-the-plan' },
        ];
        for (const reading of readings) {
          const c = replay(prefix, stepMs);
          const snapshot = c.snapshot();
          const before = c.held();
          const preview = c.preview(reading);
          expect(c.snapshot()).toEqual(snapshot);
          expect(c.held()).toEqual(before);
          expect(c.preview(reading)).toEqual(preview);
          const heard = c.hear({ ...reading, said: 'whatever they said' });
          expect(heard).toEqual(preview);
        }
      }
    }
    // The states compared include every part of a class.
    for (const phase of ['open', 'idea:predict', 'idea:explain', 'idea:check', 'idea:teachBack', 'recap', 'close']) {
      expect(phases).toContain(phase);
    }
  });
});
