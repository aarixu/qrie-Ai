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

    // A wrong prediction is fine: acknowledged, not graded, resolved, then the point.
    const explain = c.hear(r('wrong'));
    expect(explain).toMatchObject({
      kind: 'explain',
      heldQuestionId: 'q-where',
      ack: { of: 'wrong' },
      content: { say: `${IDEA0.predict!.answer}. ${IDEA0.predict!.why} ${IDEA0.points[0].say}`, ask: Q_WHERE.question },
      maxSentences: 4,
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

    // The reveal stays on q-where: the answer and why, then q-where again to say back.
    const reveal = c.hear(r('wrong'));
    expect(reveal).toMatchObject({
      kind: 'reveal',
      ack: { of: 'wrong' },
      heldQuestionId: 'q-where',
      helped: 8,
      strategy: 'reveal',
      handsOver: true,
      content: { say: `In every living cell. ${Q_WHERE.why}`, ask: Q_WHERE.question },
      evidence: { questionId: 'q-where', correct: false, rung: 7 },
      maxSentences: 3,
      mustNotReveal: [],
    });
    expect(reveal.because).toMatch(/answer and why \(L8\).*put again for them to say it back/);

    const readBack = c.hear(r('right'));
    expect(readBack).toMatchObject({ kind: 'explain', heldQuestionId: 'q-gas', evidence: { questionId: 'q-where', correct: true, rung: 8 } });
    expect(readBack.because).toMatch(/retest c-hungry queued/);

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

  it('lets a queued retest on the same node stand in for a second one', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('wrong'));
    expect(c.hear(r('right')).because).toMatch(/retest c-hungry queued .*\(on resp\.site\)/);
    c.hear(r('right')); // q-gas → c-release, on resp.definition
    c.hear(r('wrong'));
    expect(c.hear(r('right')).because).toMatch(/retest c-hungry, already queued, is on resp\.definition too/);
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
    expect(c.hear(r('wrong'))).toMatchObject({ kind: 'reveal', heldQuestionId: 'q-gas' });
    expect(c.hear(r('wrong'))).toMatchObject({ kind: 'check', heldQuestionId: 'c-release', evidence: { questionId: 'q-gas', rung: 8 } });
  });

  it('asks for the missing part on a first partly, then treats a second like a miss', () => {
    const { c } = setup();
    toQWhere(c);
    const probe = c.hear(r('partly'));
    expect(probe).toMatchObject({
      kind: 'probeMore',
      ack: { of: 'partly' },
      content: { ask: Q_WHERE.question },
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
    // The reason sits in the ack and in `say` (said once), and the cap holds both and the question.
    expect(c.hear(r('dontKnow'))).toMatchObject({ kind: 'check', maxSentences: 3, heldQuestionId: 'c-release' });
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

  it('redirects off-topic, asks to hear it again after unclear, and nudges after chat, with no evidence', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.hear(r('offTopic'))).toMatchObject({ kind: 'redirect', ack: { of: 'offTopic' }, content: { ask: Q_WHERE.question }, helped: null });
    expect(c.hear(r('unclear'))).toMatchObject({ kind: 'sayAgain', ack: { of: 'unclear' }, content: { ask: Q_WHERE.question } });
    expect(c.hear(r('chat'))).toMatchObject({ kind: 'nudge', helped: null, content: { ask: Q_WHERE.question } });
    expect(c.snapshot()).toMatchObject({ attempt: 1, rung: 0, evidence: [] });
  });

  it('reads a class outside the contract as unclear', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.hear({ class: 'banana' as StudentClass, said: '' })).toMatchObject({ kind: 'sayAgain', ack: { of: 'unclear' } });
  });
});

describe('silence', () => {
  it('nudges, then checks in, then gives help as a hint request they did not make, then moves on', () => {
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

    const right = c.hear(r('right'));
    expect(right.evidence).toMatchObject({ questionId: 'q-where', correct: true, rung: 3 });
    expect(right.because).toMatch(/retest c-hungry queued/);

    // A fourth silence in a row moves on with no evidence (the review tests below follow it further).
    const quiet = setup().c;
    toQWhere(quiet);
    for (let i = 0; i < 3; i += 1) quiet.silence(5000);
    expect(quiet.silence(5000)).toMatchObject({ kind: 'explain', heldQuestionId: 'q-gas', helped: null });
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
    toTeachBack(c);
    c.hear(r('right')); // → q-sprint
    c.hear(r('right')); // → c-aerobic
    c.hear(r('right')); // → idea-oxygen's teach-back
    expect(c.hear(r('right'))).toMatchObject({ kind: 'recap', content: { ask: PLAN.recap.prompts[0] } });
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

  it('gives the core once on a miss, files it, and moves on after the reply with no ladder', () => {
    for (const cls of ['wrong', 'dontKnow'] as const) {
      const { c } = setup();
      toTeachBack(c);
      const m = c.hear(r(cls));
      expect(m.evidence).toEqual({ questionId: 'idea-what#teach-back', nodeIds: IDEA0.nodeIds, correct: false, rung: 0 });
      expect(m).toMatchObject({ kind: 'reveal', heldQuestionId: 'idea-what#teach-back', ack: { of: cls }, content: { say: IDEA0.points[0].say }, helped: 8 });
      const on = c.hear(r(cls));
      expect(on).toMatchObject({ kind: 'explain', ideaId: 'idea-oxygen', evidence: { correct: false, rung: 8 } });
      expect(on.because).toMatch(/again after the core.*no ladder on a teach-back/);
    }
  });

  it('helps once another way (L7), then gives the core, then moves on without evidence', () => {
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
    const core = c.hear(r('explainRequest'));
    expect(core).toMatchObject({ kind: 'reveal', heldQuestionId: 'idea-what#teach-back', content: { say: IDEA0.points[0].say }, helped: 8, requested: true });
    expect(core.evidence).toBeUndefined();
    const on = c.hear(r('explainRequest'));
    expect(on).toMatchObject({ kind: 'explain', ideaId: 'idea-oxygen', ack: { of: 'explainRequest' } });
    expect(on.ack?.why).toBeUndefined();
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

  it('protects nothing once the question is revealed, and the next question from the move that reaches it', () => {
    const { c } = setup();
    toQWhere(c);
    for (let i = 0; i < 5; i += 1) c.hear(r('wrong'));
    expect(c.snapshot()).toMatchObject({ heldQuestionId: 'q-where', rung: 8 });
    // After the reveal, a nudge on the same question has nothing left to protect.
    expect(c.silence(4000)).toMatchObject({ kind: 'nudge', heldQuestionId: 'q-where', mustNotReveal: [] });
    expect(c.hear(r('right'))).toMatchObject({ heldQuestionId: 'q-gas', mustNotReveal: ['carbon dioxide', 'Carbon dioxide'] });
  });

  it('leaves out, on a move that stays, a secret its own content states', () => {
    // A teach-back's alternate that states the teach-back's expect (no plan check covers it).
    const plan = planCopy();
    plan.ideas[0].teachBack.expect = 'each cell is a tiny kitchen';
    plan.ideas[0].points[0].ask.alternates[0].say = 'Think of it this way: each cell is a tiny kitchen.';
    expect(validatePlan(plan).ok).toBe(true);
    const { c } = setup({}, plan);
    expect(toTeachBack(c).mustNotReveal).toEqual(['each cell is a tiny kitchen']);
    expect(c.hear(r('hintRequest'))).toMatchObject({ kind: 'anotherWay', mustNotReveal: [] });
  });
});

describe('time', () => {
  it('goes straight to the recap once time is up, at the next step', () => {
    const { c, at } = setup();
    c.start();
    c.hear(r('right')); // → predict
    at(20 * MIN);
    const m = c.hear(r('wrong'));
    expect(m).toMatchObject({ kind: 'recap', ack: { of: 'wrong' }, content: { ask: GENERAL_RECAP }, heldQuestionId: null });
    expect(m.because).toMatch(
      /time is up \(20\.0 of 20 min\): straight to the recap, skipping the rest of idea idea-what \(point p-what, point p-waste, check c-release, its teach-back\), 1 idea\(s\) not begun, 0 queued retest\(s\)/,
    );
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
    expect(recap).toMatchObject({ kind: 'recap', content: { ask: GENERAL_RECAP }, heldQuestionId: null });
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

// ─── The phase-1 reviews' findings, each as the scenario that showed it ────

const GENERAL_RECAP = 'Tell me one thing you learned today.';
const Q_HUNGRY = IDEA0.check[1];

describe('review: a misconception follow-up answered right', () => {
  it('is the answer: praised with both reasons, filed after help, moved on, retested', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('wrong', 'breathing-is-respiration')); // the follow-up
    const m = c.hear(r('right'));
    expect(m).toMatchObject({
      kind: 'explain',
      heldQuestionId: 'q-gas',
      ack: { of: 'right', why: `${MIS.why} ${Q_WHERE.why}` },
      evidence: { questionId: 'q-where', correct: true, rung: 1 },
    });
    expect(m.because).toMatch(/right after help/);
    expect(m.because).toMatch(/retest c-hungry queued/);
  });
});

describe('review: an opener or a prediction not answered right is resolved', () => {
  const P = IDEA0.predict!;

  it('a wrong prediction naming a misconception: the answer and why it is not so, before the point', () => {
    const { c } = setup();
    c.start();
    c.hear(r('right'));
    const m = c.hear(r('wrong', 'plants-only-photosynthesise'));
    expect(m).toMatchObject({ kind: 'explain', heldQuestionId: 'q-where', ack: { of: 'wrong', misconceptionId: 'plants-only-photosynthesise' } });
    expect(m.content.say).toBe(`${P.answer}. ${P.misconceptions[0].why} ${IDEA0.points[0].say}`);
    expect(m.maxSentences).toBeGreaterThanOrEqual(4);
  });

  it('"don\'t know" to a prediction: the answer and its reason', () => {
    const { c } = setup();
    c.start();
    c.hear(r('right'));
    expect(c.hear(r('dontKnow')).content.say).toBe(`${P.answer}. ${P.why} ${IDEA0.points[0].say}`);
  });

  it('a wrong opener, and an opener left in silence, are resolved before the prediction', () => {
    const resolved = `${PLAN.opener.answer}. ${PLAN.opener.why}`;
    const a = setup().c;
    a.start();
    expect(a.hear(r('wrong'))).toMatchObject({ kind: 'predict', content: { say: resolved, ask: P.question } });
    const b = setup().c;
    b.start();
    for (let i = 0; i < 3; i += 1) b.silence(4000);
    expect(b.silence(4000)).toMatchObject({ kind: 'predict', content: { say: resolved } });
  });

  it('a right opener gets its reason in the reaction and nothing more', () => {
    const { c } = setup();
    c.start();
    const m = c.hear(r('right'));
    expect(m.ack?.why).toBe(PLAN.opener.why);
    expect(m.content.say).toBeUndefined();
  });
});

describe('review: a class cut short recaps only what was taught', () => {
  it('cut by time before any teach-back: one general prompt, and the skipped steps named', () => {
    const { c, at } = setup();
    toQWhere(c);
    at(21 * MIN);
    const m = c.hear(r('right'));
    expect(m).toMatchObject({ kind: 'recap', content: { ask: GENERAL_RECAP } });
    expect(m.because).toMatch(/skipping the rest of idea idea-what \(point p-waste, check c-release, its teach-back\), 1 idea\(s\) not begun, 0 queued retest\(s\)/);
    expect(m.because).toMatch(/one general prompt/);
    expect(c.hear(r('right')).kind).toBe('close');
  });

  it('cut by time after one idea: that idea\'s teach-back prompt only', () => {
    const { c, at } = setup();
    toTeachBack(c);
    c.hear(r('right')); // → q-sprint
    at(20 * MIN);
    const m = c.hear(r('right'));
    expect(m).toMatchObject({ kind: 'recap', content: { ask: IDEA0.teachBack.prompt } });
    expect(c.hear(r('right')).kind).toBe('close');
  });

  it('end() mid-ladder: the general prompt, never the answer not yet given', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('wrong'));
    const m = c.end();
    expect(m).toMatchObject({ kind: 'recap', content: { ask: GENERAL_RECAP } });
    expect(m.because).toMatch(/skipping the rest of idea idea-what \(q-where unanswered, point p-waste, check c-release, its teach-back\)/);
  });
});

describe('review: silence on a graded question', () => {
  it('after the hint, moves on with no evidence and a retest queued', () => {
    const { c } = setup();
    toQWhere(c);
    expect(c.silence(5000).kind).toBe('nudge');
    expect(c.silence(5000).kind).toBe('checkIn');
    expect(c.silence(5000).kind).toBe('hint');
    const on = c.silence(5000);
    expect(on).toMatchObject({ kind: 'explain', heldQuestionId: 'q-gas', helped: null });
    expect(on.evidence).toBeUndefined();
    expect(on.because).toMatch(/silence 4 .*move on with no evidence; retest c-hungry queued/);
  });

  it('a student who never speaks reaches the recap, with at most one hint per question', () => {
    const { c, tick } = setup();
    c.start();
    const moves: Move[] = [];
    for (let i = 0; i < 200 && !c.snapshot().done; i += 1) {
      tick(20_000);
      moves.push(c.silence(20_000));
    }
    expect(moves.some((m) => m.kind === 'recap')).toBe(true);
    const hints = new Map<string, number>();
    for (const m of moves) if (m.kind === 'hint') hints.set(m.heldQuestionId!, (hints.get(m.heldQuestionId!) ?? 0) + 1);
    for (const n of hints.values()) expect(n).toBe(1);
  });
});

describe('review: nothing said on reaching a question gives its answer away', () => {
  it('a right answer\'s reason that holds the next question\'s answer is left unsaid, and that answer stays protected', () => {
    const plan = planCopy();
    plan.ideas[0].points[1].ask.why = 'Breaking glucose down with oxygen releases energy and leaves carbon dioxide behind.';
    expect(validatePlan(plan).ok).toBe(true);
    const { c } = setup({}, plan);
    toQWhere(c);
    c.hear(r('right')); // → q-gas
    const m = c.hear(r('right')); // → c-release, expect "energy"
    expect(m).toMatchObject({ kind: 'check', heldQuestionId: 'c-release', ack: { of: 'right' }, mustNotReveal: ['energy', 'Energy'] });
    expect(m.ack?.why).toBeUndefined();
    expect(m.because).toMatch(/1 reason\(s\) left unsaid: .*c-release/);
  });

  it('a missed teach-back no longer carries the core into the next question', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('wrong'));
    c.hear(r('right')); // c-hungry queued (resp.site)
    c.hear(r('right')); // → c-release
    c.hear(r('right')); // → teach-back
    c.hear(r('right')); // → q-sprint
    c.hear(r('right')); // → retest c-hungry
    c.hear(r('wrong'));
    c.hear(r('right')); // c-name queued (resp.definition), → c-aerobic
    c.hear(r('right')); // → idea-oxygen's teach-back
    expect(c.hear(r('wrong'))).toMatchObject({ kind: 'reveal', heldQuestionId: 'idea-oxygen#teach-back', content: { say: IDEA1.points[0].say } });
    const retest = c.hear(r('right'));
    expect(retest).toMatchObject({ kind: 'check', heldQuestionId: 'c-name', mustNotReveal: ['energy', 'Energy'] });
    expect(retest.ack?.why).toBeUndefined();
  });
});

describe('review: one teaching per turn, and a cap that holds it', () => {
  it('the reveal stays on the revealed question, files L8 there, and hands it back', () => {
    const { c } = setup();
    toQWhere(c);
    for (let i = 0; i < 4; i += 1) c.hear(r('wrong'));
    const reveal = c.hear(r('wrong'));
    expect(reveal).toMatchObject({
      kind: 'reveal',
      heldQuestionId: 'q-where',
      helped: 8,
      board: null,
      content: { say: `${Q_WHERE.answer}. ${Q_WHERE.why}`, ask: Q_WHERE.question },
      evidence: { questionId: 'q-where', correct: false, rung: 7 },
      mustNotReveal: [],
    });
    expect(reveal.maxSentences).toBeGreaterThanOrEqual(3);
    const next = c.hear(r('right'));
    expect(next).toMatchObject({
      kind: 'explain',
      heldQuestionId: 'q-gas',
      content: { say: IDEA0.points[1].say },
      evidence: { questionId: 'q-where', correct: true, rung: 8 },
      mustNotReveal: ['carbon dioxide', 'Carbon dioxide'],
    });
    expect(next.because).toMatch(/at rung 8.*right after help.*retest c-hungry queued/);
  });

  it('a wrong read-back after the reveal moves on, filed at L8, with the retest', () => {
    const { c } = setup();
    toQWhere(c);
    for (let i = 0; i < 5; i += 1) c.hear(r('wrong'));
    const on = c.hear(r('partly'));
    expect(on).toMatchObject({ kind: 'explain', heldQuestionId: 'q-gas', evidence: { questionId: 'q-where', correct: false, rung: 8 } });
    expect(on.because).toMatch(/retest c-hungry queued/);
  });

  it('a worked example of two steps gets a cap of steps + the question', () => {
    const plan = planCopy();
    const ask = plan.ideas[0].points[0].ask;
    ask.workedExample = {
      steps: [...ask.workedExample!.steps, { say: 'Take a root: it respires underground, far from any lungs.', line: 'root: no lungs, still respires' }],
    };
    expect(validatePlan(plan).ok).toBe(true);
    const { c } = setup({}, plan);
    toQWhere(c);
    c.hear(r('wrong'));
    c.hear(r('wrong'));
    const worked = c.hear(r('wrong'));
    expect(worked.kind).toBe('workedExample');
    expect(worked.maxSentences).toBe(3);
  });

  it('a missed teach-back: the core on the teach-back itself, handed back; the next idea after, with no reason carried', () => {
    const { c } = setup();
    toTeachBack(c);
    const miss = c.hear(r('wrong'));
    expect(miss).toMatchObject({
      kind: 'reveal',
      ideaId: 'idea-what',
      heldQuestionId: 'idea-what#teach-back',
      helped: 8,
      board: null,
      content: { say: IDEA0.points[0].say, ask: IDEA0.teachBack.prompt },
      evidence: { questionId: 'idea-what#teach-back', correct: false, rung: 0 },
      mustNotReveal: [],
    });
    const on = c.hear(r('partly'));
    expect(on).toMatchObject({ kind: 'explain', ideaId: 'idea-oxygen', ack: { of: 'partly' }, evidence: { questionId: 'idea-what#teach-back', correct: true, rung: 8 } });
    expect(on.ack?.why).toBeUndefined();
  });
});

describe('review: "don\'t know", "haan" and "ok"', () => {
  it('"pata nahi" before any help gets the hint as the smaller step, not the same question', () => {
    const { c } = setup();
    toQWhere(c);
    const m = c.hear(r('dontKnow'));
    expect(m).toMatchObject({
      kind: 'hint',
      ack: { of: 'dontKnow' },
      content: { say: Q_WHERE.hint, ask: Q_WHERE.question },
      helped: 3,
      requested: false,
      evidence: { questionId: 'q-where', correct: false, rung: 0 },
    });
    expect(c.hear(r('wrong')).kind).toBe('workedExample');
  });

  it('"haan" to her check-in takes the hint she offered', () => {
    const { c } = setup();
    toQWhere(c);
    c.silence(5000);
    c.silence(5000);
    const m = c.hear(r('chat'));
    expect(m).toMatchObject({ kind: 'hint', ack: { of: 'chat' }, content: { say: Q_WHERE.hint, ask: Q_WHERE.question }, helped: 3, requested: false });
    expect(m.evidence).toBeUndefined();
  });

  it('"haan" to her check-in on the opener takes its hint; on a teach-back, the other way', () => {
    const a = setup().c;
    a.start();
    a.silence(4000);
    a.silence(4000);
    expect(a.hear(r('chat'))).toMatchObject({ kind: 'hint', content: { say: PLAN.opener.hint }, helped: null });
    const b = setup().c;
    toTeachBack(b);
    b.silence(4000);
    b.silence(4000);
    expect(b.hear(r('chat'))).toMatchObject({ kind: 'anotherWay', helped: 7, requested: false });
  });

  it('"ok" with no offer made puts the question again as a nudge, filing nothing', () => {
    const { c } = setup();
    toQWhere(c);
    const m = c.hear(r('chat'));
    expect(m).toMatchObject({ kind: 'nudge', helped: null, content: { ask: Q_WHERE.question }, heldQuestionId: 'q-where' });
    expect(m.ack).toBeUndefined();
    expect(m.evidence).toBeUndefined();
  });
});

describe('review: `because` says what was filed and what comes next', () => {
  it('right after another way asked for, or after a silence nudge, is "right after help", not "right cold"', () => {
    const a = setup().c;
    toQWhere(a);
    a.hear(r('explainRequest'));
    const m = a.hear(r('right'));
    expect(m.evidence).toMatchObject({ correct: true, rung: 7 });
    expect(m.because).toMatch(/right after help/);
    expect(m.because).not.toMatch(/right cold/);

    const b = setup().c;
    toQWhere(b);
    b.silence(4000);
    const n = b.hear(r('right'));
    expect(n.evidence).toMatchObject({ correct: true, rung: 1 });
    expect(n.because).toMatch(/right after help/);
  });

  it('asking to be told on the opener does not promise the explanation next; the answer is given', () => {
    const { c } = setup();
    c.start();
    const m = c.hear(r('explainRequest'));
    expect(m).toMatchObject({ kind: 'predict', content: { say: `${PLAN.opener.answer}. ${PLAN.opener.why}` } });
    expect(m.because).not.toMatch(/explanation comes next/);
  });
});

describe('review: a retest is on the node that failed', () => {
  it('a missed q-where (resp.site) is retested by the check on resp.site', () => {
    const { c } = setup();
    toQWhere(c);
    c.hear(r('wrong'));
    expect(c.hear(r('right')).because).toMatch(/retest c-hungry queued/);
    expect(Q_HUNGRY.nodeIds).toContain('resp.site');
  });

  it('says so when no check is on that node', () => {
    const plan = planCopy();
    plan.ideas[0].check[1].nodeIds = ['resp.definition'];
    const { c } = setup({}, plan);
    toQWhere(c);
    c.hear(r('wrong'));
    const m = c.hear(r('right'));
    expect(m.because).toMatch(/no unused check of idea idea-what is on resp\.site, so it is not retested/);
    expect(m.because).not.toMatch(/retest c-hungry queued/);
  });
});

describe('review: a first partly', () => {
  it('asks for the missing part with nothing new said; the hint comes once, on the next miss', () => {
    const { c } = setup();
    toQWhere(c);
    const probe = c.hear(r('partly'));
    expect(probe).toMatchObject({ kind: 'probeMore', ack: { of: 'partly' }, content: { ask: Q_WHERE.question }, helped: 1 });
    expect(probe.content.say).toBeUndefined();
    const hint = c.hear(r('partly'));
    expect(hint).toMatchObject({ kind: 'hint', content: { say: Q_WHERE.hint }, helped: 3 });
  });
});

describe('review: preview and hear across the time limit', () => {
  it('hear after a preview runs at the preview\'s clock reading, so it makes the move previewed', () => {
    const { c, at } = setup();
    c.start();
    c.hear(r('right'));
    c.hear(r('right')); // q-where held
    at(19 * MIN + 58_500);
    const preview = c.preview({ class: 'right' });
    expect(preview).toMatchObject({ kind: 'explain', heldQuestionId: 'q-gas' });
    at(20 * MIN + 500);
    expect(c.preview({ class: 'right' })).toEqual(preview);
    expect(c.hear(r('right'))).toEqual(preview);
    // The next turn reads the clock afresh: time is up.
    expect(c.hear(r('right')).kind).toBe('recap');
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

/** A fresh class with `events` played, `stepMs` of clock apart; `tick` moves its clock on. */
function replay(events: readonly Ev[], stepMs: number): { c: Conductor; tick: (ms: number) => void } {
  const { c, tick } = setup();
  c.start();
  for (const e of events) {
    tick(stepMs);
    apply(c, e);
  }
  tick(stepMs);
  return { c, tick };
}

/** Sentences in a text, split after `.`, `!` or `?` and a space — counted here independently of the conductor. */
function sentenceCount(t: string | undefined): number {
  const s = t?.trim() ?? '';
  return s ? s.split(/(?<=[.!?])\s+/).filter((x) => x.trim()).length : 0;
}

/**
 * The contract's promises about any single move, given the move before it
 * (null for the first) and the questions revealed so far.
 */
function checkMove(m: Move, held: PlanQuestion | null, prev: Move | null, revealed: ReadonlySet<string>): void {
  expect(m.because.trim().length).toBeGreaterThan(0);
  expect(m.final).toBe(m.kind === 'close');
  expect(m.handsOver).toBe(m.kind !== 'close');
  if (m.handsOver) expect(m.content.ask?.trim()).toBeTruthy();
  expect(m.heldQuestionId).toBe(held?.id ?? null);
  if (m.kind === 'nudge' || m.kind === 'checkIn' || m.kind === 'open') expect(m.ack).toBeUndefined();

  // The cap is the kind's own at least, and always holds what the move must say.
  const base = m.kind === 'open' || m.kind === 'explain' || m.kind === 'close' ? 3 : 2;
  const needed =
    sentenceCount(m.ack?.why) +
    sentenceCount(m.content.say) +
    (m.content.steps ?? []).reduce((n, s) => n + sentenceCount(s.say), 0) +
    sentenceCount(m.content.ask);
  expect(m.maxSentences).toBe(Math.max(base, needed));

  // Help and evidence are about the question they name: help is filed on a
  // move that stays on what was held; evidence is about what was held before.
  if (m.helped !== null) {
    expect(m.heldQuestionId).not.toBeNull();
    expect(m.heldQuestionId).toBe(prev?.heldQuestionId);
  }
  if (m.evidence) {
    expect(m.evidence.rung).toBeGreaterThanOrEqual(0);
    expect(m.evidence.questionId).toBe(prev?.heldQuestionId);
  }

  // Nothing the move itself says gives away what it must not reveal.
  const spoken = [m.content.say, m.ack?.why, ...(m.content.steps ?? []).flatMap((s) => [s.say, s.line])].filter(
    (t): t is string => typeof t === 'string',
  );
  for (const t of spoken) expect(leaks(t, m.mustNotReveal)).toBe(false);

  if (!held) {
    expect(m.mustNotReveal).toEqual([]);
    return;
  }
  // A move that reaches a question protects all of it. One that stays on it
  // may leave out only a secret its own content states, or one already revealed.
  const arrived = prev === null || prev.heldQuestionId !== m.heldQuestionId;
  for (const secret of [held.expect, held.answer]) {
    if (arrived) expect(m.mustNotReveal).toContain(secret.trim());
    else expect(m.mustNotReveal.includes(secret.trim()) || revealed.has(held.id) || spoken.some((t) => leaks(t, [secret]))).toBe(true);
  }
}

describe('properties', () => {
  it('every move keeps the contract, across 40 scripted classes', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { c, tick } = setup();
      const revealed = new Set<string>();
      let last = c.start();
      checkMove(last, c.held(), null, revealed);
      for (const e of script(seed, 120, true)) {
        tick(STEP_MS);
        const m = apply(c, e);
        if (last.kind === 'close') {
          expect(m).toBe(last);
          continue;
        }
        expect(m.seq).toBe(last.seq + 1);
        if (m.helped === 8 && m.heldQuestionId) revealed.add(m.heldQuestionId);
        checkMove(m, c.held(), last, revealed);
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
        const probe = replay(prefix, stepMs).c;
        phases.add(probe.snapshot().phase);
        const held = probe.held();
        const readings: Omit<Reading, 'said'>[] = [
          ...STUDENT_CLASSES.map((cls) => ({ class: cls })),
          ...(held?.misconceptions ?? []).map((m) => ({ class: 'wrong' as const, misconceptionId: m.id })),
          { class: 'wrong', misconceptionId: 'not-in-the-plan' },
        ];
        for (const reading of readings) {
          const { c, tick } = replay(prefix, stepMs);
          const snapshot = c.snapshot();
          const before = c.held();
          const preview = c.preview(reading);
          expect(c.snapshot()).toEqual(snapshot);
          expect(c.held()).toEqual(before);
          // The words layer takes its time: the clock moves on between the preview and the hear.
          tick(2_500);
          expect(c.preview(reading)).toEqual(preview);
          tick(2_500);
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
