import { describe, expect, it } from 'vitest';
import { FRAMES, LINES, RECOGNISE, decide, type Action, type AskInput, type DecideInput } from '../src/index';

/**
 * THE LADDER READS THE LEARNER'S HISTORY (lam-one-brain Task 6; D11, D12, SF11).
 *
 * The same wrong answer is not the same moment for every child. A wrong idea
 * they have shown before skips "look again" for another way to see it; an
 * outcome they keep missing cold gets a worked example first; a child who
 * keeps pulling the hint before trying is asked for a try first. Each of those
 * moves opens with a fixed recognition phrase, and only those moves do. With
 * no history the ladder is exactly as before (decide.test.ts stays as it is).
 */

const ASK: AskInput = {
  question: 'Why does the sugar seem to disappear in water?',
  expect: 'it dissolves',
  hint: 'Think about what happens to the grains.',
  options: [
    { text: 'it dissolves', correct: true, why: 'The sugar breaks into pieces too small to see.' },
    { text: 'it melts', correct: false, why: 'Melting needs heat.', followUp: 'What would you need to melt something?' },
  ],
  alternates: [{ mode: 'everyday', say: 'Stir salt into dal: you taste it everywhere, but you cannot see a grain.' }],
  workedExample: {
    steps: [
      { say: 'Drop a spoon of salt into warm water and stir.', line: 'salt + water' },
      { say: 'The grains spread out until you cannot see them.', line: 'spread out, still there' },
    ],
  },
};

const base = (over: Partial<DecideInput> = {}): DecideInput => ({
  verdict: 'wrong',
  attempt: 1,
  rungSoFar: 0,
  ask: ASK,
  matchedOption: 1,
  lang: 'en',
  now: 1_000_000,
  ...over,
});

const say = (a: Action): string => a.say ?? '';
const opensWithRecognition = (a: Action): boolean =>
  [...RECOGNISE.idea.en, ...RECOGNISE.idea['hi-en'], ...RECOGNISE.stuck.en, ...RECOGNISE.stuck['hi-en']].some((p) =>
    say(a).startsWith(p),
  );

describe('decide with history: a wrong idea shown before', () => {
  it('without history, the first miss on a named idea gets its follow-up question (today)', () => {
    const a = decide(base());
    expect(a.followUp).toBe(true);
    expect(a.rung).toBe(1);
    expect(opensWithRecognition(a)).toBe(false);
  });

  it('with the idea seen before, skips "look again" for another way to explain it, opened by recognition', () => {
    const a = decide(base({ history: { repeatedMisconception: 'it melts' } }));
    expect(a.kind).toBe('explainAgain');
    expect(a.rung).toBe(7);
    expect(a.helped).toBe(7);
    expect(a.followUp).toBeUndefined();
    expect(say(a)).toContain('Stir salt into dal');
    expect(RECOGNISE.idea.en.some((p) => say(a).startsWith(p))).toBe(true);
    expect(a.because).toMatch(/shown before/);
  });

  it('speaks the recognition in the child’s language', () => {
    const a = decide(base({ lang: 'hi-en', history: { repeatedMisconception: 'it melts' } }));
    expect(RECOGNISE.idea['hi-en'].some((p) => say(a).startsWith(p))).toBe(true);
  });

  it('does not apply to a right answer, or to a wrong answer that matched no option', () => {
    const right = decide(base({ verdict: 'right', matchedOption: 0, history: { repeatedMisconception: 'it melts' } }));
    expect(right.kind).toBe('praise');
    expect(opensWithRecognition(right)).toBe(false);
    const unmatched = decide(base({ verdict: 'unmatched', matchedOption: undefined, history: { repeatedMisconception: 'it melts' } }));
    expect(unmatched.kind).toBe('rethink');
    expect(opensWithRecognition(unmatched)).toBe(false);
  });

  it('falls back to the plain ladder when no other way is authored, and then says nothing about history', () => {
    const { alternates: _none, ...bare } = ASK;
    const a = decide(base({ ask: bare, history: { repeatedMisconception: 'it melts' } }));
    expect(a.followUp).toBe(true);
    expect(opensWithRecognition(a)).toBe(false);
  });

  it('never climbs down: after the other way was given, the next miss is the answer', () => {
    const a = decide(base({ attempt: 2, rungSoFar: 7, history: { repeatedMisconception: 'it melts' } }));
    expect(a.kind).toBe('reveal');
  });
});

describe('decide with history: an outcome they keep missing cold (wheel-spinning)', () => {
  it('goes to a worked example on the first miss, opened by recognition', () => {
    const a = decide(base({ matchedOption: undefined, verdict: 'unmatched', history: { wheelSpin: true } }));
    expect(a.kind).toBe('workedExample');
    expect(a.rung).toBe(5);
    expect(RECOGNISE.stuck.en.some((p) => say(a).startsWith(p))).toBe(true);
    expect(say(a)).toContain('Drop a spoon of salt');
  });

  it('with no worked example, another way to explain it instead', () => {
    const { workedExample: _none, ...bare } = ASK;
    const a = decide(base({ ask: bare, matchedOption: undefined, verdict: 'unmatched', history: { wheelSpin: true } }));
    expect(a.kind).toBe('explainAgain');
    expect(RECOGNISE.stuck.en.some((p) => say(a).startsWith(p))).toBe(true);
  });

  it('a wrong idea shown before wins over spinning: it is the more specific reading', () => {
    const a = decide(base({ history: { repeatedMisconception: 'it melts', wheelSpin: true } }));
    expect(a.kind).toBe('explainAgain');
    expect(RECOGNISE.idea.en.some((p) => say(a).startsWith(p))).toBe(true);
  });
});

describe('decide with history: pulling the hint before trying', () => {
  it('without the flag, a hint asked for before any try is given (today)', () => {
    const a = decide(base({ verdict: 'hintRequest', matchedOption: undefined }));
    expect(a.kind).toBe('hint');
    expect(a.helped).toBe(3);
  });

  it('with it, asks for a cold try first: no help filed, the ladder does not move', () => {
    const a = decide(base({ verdict: 'hintRequest', matchedOption: undefined, history: { hintAbuse: true } }));
    expect(a.kind).toBe('nudge');
    expect(a.strategy).toBe('tryFirst');
    expect(a.helped).toBeNull();
    expect(a.rung).toBe(0);
    expect(a.requested).toBe(true);
    expect(LINES.tryFirst.en).toContain(say(a));
  });

  it('also before another explanation is asked for', () => {
    const a = decide(base({ verdict: 'explainRequest', matchedOption: undefined, history: { hintAbuse: true } }));
    expect(a.strategy).toBe('tryFirst');
    expect(a.helped).toBeNull();
  });

  it('once they have tried, the hint they ask for is given', () => {
    const a = decide(base({ verdict: 'hintRequest', attempt: 2, rungSoFar: 1, matchedOption: undefined, history: { hintAbuse: true } }));
    expect(a.kind).toBe('hint');
  });
});

describe('decide with history: anti-illusion', () => {
  it('flipping the history flips the move, and empty history is exactly no history', () => {
    const repeated = decide(base({ history: { repeatedMisconception: 'it melts' } }));
    const none = decide(base());
    const empty = decide(base({ history: {} }));
    expect(none).toMatchObject({ kind: 'rethink', followUp: true });
    expect(repeated.kind).toBe('explainAgain');
    expect(empty).toEqual(none);
    // The plain frames are still what the ladder uses with no history.
    const plainAlt = decide(base({ attempt: 3, rungSoFar: 5, matchedOption: undefined, verdict: 'unmatched' }));
    expect(FRAMES.explainAgain.en.some((f) => say(plainAlt) === f('Stir salt into dal: you taste it everywhere, but you cannot see a grain.'))).toBe(true);
  });

  it('every recognition phrase and try-first line is free of number words, so none can collide with an answer', () => {
    const lines = [
      ...RECOGNISE.idea.en, ...RECOGNISE.idea['hi-en'], ...RECOGNISE.stuck.en, ...RECOGNISE.stuck['hi-en'],
      ...LINES.tryFirst.en, ...LINES.tryFirst['hi-en'],
    ];
    for (const line of lines) expect(line, line).not.toMatch(/\b(one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char)\b/i);
  });
});
