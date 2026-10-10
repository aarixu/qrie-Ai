import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FAST_WRONG_MS,
  FRAMES,
  LINES,
  RECOGNISE,
  decide,
  leakTokens,
  leaks,
  type Action,
  type AskInput,
  type DecideInput,
  type Verdict,
} from '../src/index';

/**
 * THE LADDER, AS A TABLE (E1a, TD1).
 *
 * L0 alone → L1 a rethink line → L3 the authored hint → L5 a worked example
 * (only where one is authored) → L8 the answer and why. Right at any rung is
 * praise. Silence is a content-free nudge. A hint request climbs to L3 and no
 * further. Every action says why, for the ledger.
 */

const OPEN: AskInput = {
  question: 'Solve 2x + 3 = 11. What is x?',
  expect: 'x = 4',
  hint: 'Take 3 from both sides first.',
};

const OPTIONS: AskInput = {
  question: 'Which of these is a prime number?',
  options: [
    { text: '9', correct: false, why: 'Nine is three threes, so it has a factor besides itself.', hint: 'Can 9 be split into equal groups?' },
    { text: '7', correct: true, why: 'Seven has only two factors: one and itself.' },
    { text: '15', correct: false, why: 'Fifteen is three fives.' },
  ],
};

const NO_HINT: AskInput = { question: 'Which gas do leaves take in?', expect: 'carbon dioxide' };

const LEAKY_HINT: AskInput = { ...OPEN, hint: 'It is four — just check it.' };

const WITH_EXAMPLE: AskInput = {
  ...OPEN,
  workedExample: {
    steps: [
      { say: 'Here is a similar one: three y plus five is twenty.', line: '3y + 5 = 20' },
      { say: 'Take five from both sides.', line: '3y = 15' },
      { say: 'Then divide both sides by three.', line: 'y = 5' },
    ],
  },
};

const LEAKY_EXAMPLE: AskInput = {
  ...OPEN,
  workedExample: { steps: [{ say: 'Watch: x becomes four.', line: 'x = 4' }] },
};

const OPEN_WITH_PROBE: AskInput = {
  question: 'Why does the sugar seem to disappear in water?',
  expect: 'it dissolves',
  whyProbe: {
    askedAs: 'open',
    options: [
      { text: 'it dissolves', correct: true, why: 'The sugar breaks into pieces too small to see and spreads through the water.' },
      { text: 'it melts', correct: false, why: 'Melting needs heat; nothing here heated the sugar.' },
    ],
  },
};

const NOTHING_TO_REVEAL: AskInput = { question: 'What would you try first?' };

const base = (over: Partial<DecideInput> = {}): DecideInput => ({
  verdict: 'wrong',
  attempt: 1,
  rungSoFar: 0,
  ask: OPEN,
  lang: 'en',
  now: 1_000_000,
  ...over,
});

const say = (a: Action): string => a.say ?? '';

describe('decide: the wrong-answer ladder (TD1)', () => {
  it('meets a first wrong answer with a rethink line, L1', () => {
    const a = decide(base());
    expect(a.kind).toBe('rethink');
    expect(a.rung).toBe(1);
    expect(a.helped).toBe(1);
    expect(LINES.rethink.en).toContain(say(a));
    expect(a.mustNotReveal).toContain('x = 4');
    expect(a.scheduleRetest).toBe(false);
    expect(a.errorClass).toBe('unclassified');
  });

  it('meets the second with the authored hint, L3, written in the work area', () => {
    const a = decide(base({ attempt: 2, rungSoFar: 1 }));
    expect(a.kind).toBe('hint');
    expect(a.rung).toBe(3);
    expect(a.helped).toBe(3);
    expect(say(a)).toContain(OPEN.hint);
    expect(a.boardIntent).toEqual({ kind: 'writeInWorkArea', text: OPEN.hint });
  });

  it('prefers the chosen wrong option’s own hint over the ask’s', () => {
    const a = decide(base({ ask: OPTIONS, attempt: 2, rungSoFar: 1, matchedOption: 0 }));
    expect(a.kind).toBe('hint');
    expect(say(a)).toContain('Can 9 be split into equal groups?');
    expect(a.mustNotReveal).toContain('7');
  });

  it('meets the third with the answer and why, L8, when no worked example is authored', () => {
    const a = decide(base({ attempt: 3, rungSoFar: 3 }));
    expect(a.kind).toBe('reveal');
    expect(a.rung).toBe(8);
    expect(a.helped).toBe(8);
    expect(say(a)).toContain('x = 4');
    expect(a.boardIntent).toEqual({ kind: 'writeInWorkArea', text: 'x = 4' });
    expect(a.mustNotReveal).toEqual([]);
    expect(a.scheduleRetest).toBe(true);
  });

  it('reveals the correct option and its why on an options ask', () => {
    const a = decide(base({ ask: OPTIONS, attempt: 3, rungSoFar: 3, matchedOption: 2 }));
    expect(a.kind).toBe('reveal');
    expect(say(a)).toContain('7');
    expect(say(a)).toContain('Seven has only two factors');
  });

  it('reveals with the why-probe’s reason on an open ask that has one', () => {
    const a = decide(base({ ask: OPEN_WITH_PROBE, attempt: 3, rungSoFar: 3 }));
    expect(say(a)).toContain('it dissolves');
    expect(say(a)).toContain('too small to see');
  });

  it('offers the worked example, L5, only where one is authored', () => {
    const a = decide(base({ ask: WITH_EXAMPLE, attempt: 3, rungSoFar: 3 }));
    expect(a.kind).toBe('workedExample');
    expect(a.rung).toBe(5);
    expect(a.helped).toBe(5);
    expect(say(a)).toContain('Take five from both sides.');
    expect(a.boardIntent).toEqual({ kind: 'writeInWorkArea', text: '3y + 5 = 20\n3y = 15\ny = 5' });
    expect(a.mustNotReveal).toContain('x = 4');
  });

  it('reveals after the worked example', () => {
    const a = decide(base({ ask: WITH_EXAMPLE, attempt: 4, rungSoFar: 5 }));
    expect(a.kind).toBe('reveal');
    expect(a.rung).toBe(8);
  });

  it('moves on, and schedules a retest, when they miss again after the reveal', () => {
    const a = decide(base({ attempt: 4, rungSoFar: 8 }));
    expect(a.kind).toBe('moveOn');
    expect(a.rung).toBe(8);
    expect(a.helped).toBeNull();
    expect(a.scheduleRetest).toBe(true);
    expect(LINES.moveOn.en).toContain(say(a));
  });

  it('skips a rung with nothing authored for it rather than inventing one', () => {
    const a = decide(base({ ask: NO_HINT, attempt: 2, rungSoFar: 1 }));
    expect(a.kind).toBe('reveal');
    expect(a.because).toMatch(/no usable hint/i);
  });

  it('refuses an authored hint that gives the answer away', () => {
    const a = decide(base({ ask: LEAKY_HINT, attempt: 2, rungSoFar: 1 }));
    expect(a.kind).not.toBe('hint');
    expect(say(a)).not.toContain('It is four');
    expect(a.because).toMatch(/leak/i);
  });

  it('refuses a Hinglish hint that says the answer as a Hindi number (D27)', () => {
    const hinglish: AskInput = { ...OPEN, hint: 'Dekho, x chaar hai, check karo.' };
    const a = decide(base({ ask: hinglish, attempt: 2, rungSoFar: 1, lang: 'hi-en' }));
    expect(a.kind).not.toBe('hint');
    expect(say(a)).not.toContain('chaar');
    expect(a.because).toMatch(/leak/i);
    // The same hint in an English class is not read as a number: "chaar" is
    // not an English word for four.
    expect(decide(base({ ask: hinglish, attempt: 2, rungSoFar: 1 })).kind).toBe('hint');
  });

  it('refuses a worked example that gives the answer away', () => {
    const a = decide(base({ ask: LEAKY_EXAMPLE, attempt: 3, rungSoFar: 3 }));
    expect(a.kind).toBe('reveal');
    expect(a.because).toMatch(/leak/i);
  });

  it('moves on without pretending when there is no answer to reveal', () => {
    const a = decide(base({ ask: NOTHING_TO_REVEAL, attempt: 3, rungSoFar: 3 }));
    expect(a.kind).toBe('moveOn');
    expect(a.helped).toBeNull();
    expect(a.scheduleRetest).toBe(true);
    expect(a.because).toMatch(/no authored answer/i);
  });

  it('treats an answer the judge could not place like a wrong one', () => {
    const a = decide(base({ verdict: 'unmatched' }));
    expect(a.kind).toBe('rethink');
    expect(a.because).toMatch(/unmatched/);
  });

  it('counts a second attempt as at least a nudge even with no rung recorded (B4)', () => {
    const a = decide(base({ attempt: 2, rungSoFar: 0 }));
    expect(a.kind).toBe('hint');
  });
});

/**
 * STILL QUIET AFTER THE NUDGE AND THE HINT (2026-10-01). The class shows no
 * question and nothing to tap, so a held question that nobody answers has to
 * end somewhere: she gives the answer and its why, and the class goes on.
 */
describe('decide: still silent after the help', () => {
  it('gives the answer and its why, L8, as help they did not ask for', () => {
    const a = decide(base({ verdict: 'stillSilent', rungSoFar: 3 }));
    expect(a.kind).toBe('reveal');
    expect(a.rung).toBe(8);
    expect(a.helped).toBe(8);
    expect(a.requested).toBe(false);
    expect(say(a)).toContain('x = 4');
    expect(a.scheduleRetest).toBe(true);
  });

  it('gives the answer even before any rung was climbed', () => {
    const a = decide(base({ verdict: 'stillSilent', ask: OPEN_WITH_PROBE }));
    expect(a.kind).toBe('reveal');
    expect(say(a)).toContain('too small to see');
  });

  it('moves on with nothing to reveal, and once the answer is already out', () => {
    expect(decide(base({ verdict: 'stillSilent', ask: NOTHING_TO_REVEAL })).kind).toBe('moveOn');
    const after = decide(base({ verdict: 'stillSilent', rungSoFar: 8 }));
    expect(after.kind).toBe('moveOn');
    expect(after.helped).toBeNull();
    expect(LINES.moveOn.en).toContain(say(after));
  });
});

describe('decide: a right answer', () => {
  it('is praised warmly and briefly when it came cold, with no retest', () => {
    const a = decide(base({ verdict: 'right' }));
    expect(a.kind).toBe('praise');
    expect(a.rung).toBe(0);
    expect(a.helped).toBeNull();
    expect(LINES.praise.en.some((line) => say(a).startsWith(line))).toBe(true);
    expect(a.scheduleRetest).toBe(false);
    expect(a.errorClass).toBe('none');
    expect(a.mustNotReveal).toEqual([]);
  });

  it('is praised for sticking with it, and retested on another item, after help', () => {
    const a = decide(base({ verdict: 'right', attempt: 3, rungSoFar: 3 }));
    expect(a.kind).toBe('praise');
    expect(a.rung).toBe(3);
    expect(LINES.praiseAfterHelp.en.some((line) => say(a).startsWith(line))).toBe(true);
    expect(a.scheduleRetest).toBe(true);
  });

  /**
   * "You worked it out" is not true of an answer read back off the reveal, and
   * a child hears the difference.
   */
  it('does not claim they worked it out when the answer had just been shown', () => {
    const a = decide(base({ verdict: 'right', attempt: 4, rungSoFar: 8 }));
    expect(a.kind).toBe('praise');
    expect(LINES.praiseAfterReveal.en.some((line) => say(a).startsWith(line))).toBe(true);
    expect(say(a)).not.toMatch(/worked it out|got there/i);
    const hi = decide(base({ verdict: 'right', attempt: 4, rungSoFar: 8, lang: 'hi-en' }));
    expect(LINES.praiseAfterReveal['hi-en'].some((line) => say(hi).startsWith(line))).toBe(true);
  });

  it('does not praise twice when the authored why opens with its own "yes" (overnight review #33)', () => {
    const affirming: AskInput = {
      question: 'Which is prime?',
      options: [
        { text: '7', correct: true, why: 'Yes — seven has only two factors, one and itself.' },
        { text: '9', correct: false, why: 'Nine is three threes.' },
      ],
    };
    for (const lang of ['en', 'hi-en'] as const) {
      const a = decide(base({ verdict: 'right', ask: affirming, matchedOption: 0, lang }));
      expect(say(a)).toContain('Seven has only two factors');
      expect(say(a)).not.toMatch(/Yes —/);
    }
  });

  it('says what was right about it, from the authored why', () => {
    const a = decide(base({ verdict: 'right', ask: OPTIONS, matchedOption: 1 }));
    expect(say(a)).toContain('Seven has only two factors');
  });

  it('retests a cold right answer that goes against a weak record', () => {
    expect(decide(base({ verdict: 'right', mastery: { unassisted: 0.3 } })).scheduleRetest).toBe(true);
    expect(decide(base({ verdict: 'right', mastery: { unassisted: 0.9 } })).scheduleRetest).toBe(false);
    expect(decide(base({ verdict: 'right', mastery: {} })).scheduleRetest).toBe(false);
  });

  it('does not praise when the judge’s verdict and its match disagree', () => {
    const a = decide(base({ verdict: 'right', ask: OPTIONS, matchedOption: 0 }));
    expect(a.kind).not.toBe('praise');
    expect(LINES.sayAgain.en).toContain(say(a));
    const b = decide(base({ verdict: 'wrong', ask: OPTIONS, matchedOption: 1 }));
    expect(LINES.sayAgain.en).toContain(say(b));
  });
});

describe('decide: silence, a request, and an answer nobody could hear', () => {
  it('meets silence with a content-free nudge, filed as L1 help', () => {
    const a = decide(base({ verdict: 'silent' }));
    expect(a.kind).toBe('nudge');
    expect(a.helped).toBe(1);
    expect(LINES.nudge.en).toContain(say(a));
    expect(say(a)).not.toContain(OPEN.hint);
  });

  /**
   * The nudge is help for the RECORD — the next answer is not cold — but it is
   * not a step on the ladder: nothing about the answer was said. So the first
   * wrong answer after a silence still gets the rethink, not the hint.
   */
  it('does not spend the rethink on a silence', () => {
    const nudge = decide(base({ verdict: 'silent' }));
    expect(nudge.rung).toBe(0);
    const next = decide(base({ verdict: 'wrong', rungSoFar: nudge.rung }));
    expect(next.kind).toBe('rethink');
  });

  it('never climbs the ladder on silence', () => {
    const a = decide(base({ verdict: 'silent', rungSoFar: 3, attempt: 2 }));
    expect(a.kind).toBe('nudge');
    expect(a.rung).toBe(3);
  });

  it('asks to hear an unclear answer again, and gives no help for it', () => {
    const a = decide(base({ verdict: 'unclear', rungSoFar: 1, attempt: 2 }));
    expect(a.kind).toBe('nudge');
    expect(a.helped).toBeNull();
    expect(a.rung).toBe(1);
    expect(LINES.sayAgain.en).toContain(say(a));
  });

  it('answers a hint request with the hint, L3, marked as asked for', () => {
    const a = decide(base({ verdict: 'hintRequest' }));
    expect(a.kind).toBe('hint');
    expect(a.rung).toBe(3);
    expect(a.requested).toBe(true);
    expect(say(a)).toContain(OPEN.hint);
  });

  it('restates the hint on a second request rather than climbing past L3', () => {
    const a = decide(base({ verdict: 'hintRequest', rungSoFar: 3 }));
    expect(a.kind).toBe('hint');
    expect(a.rung).toBe(3);
  });

  it('never lets a request pull out the worked example or the answer', () => {
    for (const rungSoFar of [0, 1, 3, 5, 7] as const) {
      for (const ask of [OPEN, OPTIONS, NO_HINT, WITH_EXAMPLE]) {
        const a = decide(base({ verdict: 'hintRequest', rungSoFar, ask }));
        expect(['reveal', 'workedExample']).not.toContain(a.kind);
        // A request climbs to L3 and no further; above it, it adds nothing.
        expect(a.rung).toBeLessThanOrEqual(Math.max(rungSoFar, 3));
        if (a.helped !== null) expect(a.helped).toBeLessThanOrEqual(3);
      }
    }
  });

  it('asks for a first step when a hint is requested and none is authored', () => {
    const cold = decide(base({ verdict: 'hintRequest', ask: NO_HINT }));
    // They have not answered yet, so no line that says their answer missed.
    expect(cold.kind).toBe('nudge');
    expect(LINES.haveAGo.en).toContain(say(cold));
    expect(LINES.rethink.en).not.toContain(say(cold));
    expect(cold.helped).toBe(1);
    expect(cold.requested).toBe(true);
    // And the request climbs nothing: their first wrong answer still gets the rethink.
    expect(cold.rung).toBe(0);
    const again = decide(base({ verdict: 'hintRequest', ask: NO_HINT, rungSoFar: 1 }));
    expect(again.kind).toBe('nudge');
    expect(LINES.haveAGo.en).toContain(say(again));
  });
});

describe('decide: her language and her lines', () => {
  it('speaks the child’s language: Hinglish in Roman script', () => {
    const a = decide(base({ lang: 'hi-en' }));
    expect(LINES.rethink['hi-en']).toContain(say(a));
    expect(say(a)).not.toMatch(/[ऀ-ॿ]/);
  });

  it('keeps several lines for every persona moment, in both languages', () => {
    for (const [moment, byLang] of Object.entries(LINES)) {
      for (const lang of ['en', 'hi-en'] as const) {
        const lines = (byLang as Record<string, readonly unknown[]>)[lang];
        expect(lines.length, `${moment} ${lang}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('never says the same line twice in a row', () => {
    const verdicts: Verdict[] = ['wrong', 'silent', 'unclear', 'right', 'hintRequest'];
    for (const verdict of verdicts) {
      for (const lang of ['en', 'hi-en'] as const) {
        for (const question of ['a', 'b', 'c', 'd', 'e', 'f']) {
          const ask = { ...OPEN, question };
          const input = base({ verdict, lang, ask, rungSoFar: verdict === 'hintRequest' ? 3 : 0 });
          const first = decide(input);
          const second = decide({ ...input, recentLines: [say(first)] });
          expect(say(second), `${verdict} ${lang} ${question}`).not.toBe(say(first));
        }
      }
    }
  });

  it('has no number word in any fixed line, read in either language (D27)', () => {
    // A fixed line with a number in it would be refused whenever the answer is
    // that number, and a moment can run out of lines (`say` left out). Hindi
    // words such as "ek baar" or "saath mein" read as numbers in a hi-en line.
    const moments: Array<[string, Record<string, readonly unknown[]>]> = [
      ...Object.entries(LINES),
      ...Object.entries(RECOGNISE),
      ...Object.entries(FRAMES),
    ];
    for (const [moment, byLang] of moments) {
      for (const lang of ['en', 'hi-en'] as const) {
        byLang[lang].forEach((entry, i) => {
          const line = typeof entry === 'function' ? (entry as (s: string) => string)('content') : String(entry);
          const numbers = leakTokens(line, lang).filter((t) => /^\d/.test(t));
          expect(numbers, `${moment} ${lang} #${i}: ${line}`).toEqual([]);
        });
      }
    }
  });

  it('still speaks to a Hinglish child when the answer is 1 and a rethink line was just said (D27)', () => {
    const ask: AskInput = { question: 'How many hearts does a human have?', expect: '1' };
    for (const newest of LINES.rethink['hi-en']) {
      const a = decide(base({ ask, lang: 'hi-en', recentLines: [newest] }));
      expect(a.say, newest).toBeDefined();
      expect(a.say).not.toBe(newest);
    }
  });

  it('reads authored content in the child’s language: an English hint with "do" is refused for an answer of 2 in Hinglish (D27)', () => {
    // The ask does not say what language its hint is in. Read as Hinglish, every
    // line refused in English is refused too, so the check errs toward a leak:
    // here the help is skipped, never the answer said.
    const ask: AskInput = { question: 'Solve x + 3 = 5.', expect: 'x = 2', hint: 'What do you get when you take 3 from both sides?' };
    const hi = decide(base({ ask, attempt: 2, rungSoFar: 1, lang: 'hi-en' }));
    expect(hi.kind).not.toBe('hint');
    expect(hi.because).toMatch(/the authored hint leaks the answer/);
    expect(decide(base({ ask, attempt: 2, rungSoFar: 1 })).kind).toBe('hint');
  });

  it('is deterministic: the same input gives the same action', () => {
    expect(decide(base({ attempt: 2, rungSoFar: 1 }))).toEqual(decide(base({ attempt: 2, rungSoFar: 1 })));
  });
});

describe('decide: response-time rules, built and off until TD14', () => {
  const fast = { askedAt: 1_000_000 - (FAST_WRONG_MS - 500) };

  it('ignores how fast the answer came while the rules are off', () => {
    const a = decide(base({ attempt: 2, rungSoFar: 1, timing: { ...fast, rules: false } }));
    expect(a.kind).toBe('hint');
    expect(decide(base({ attempt: 2, rungSoFar: 1, timing: fast })).kind).toBe('hint');
  });

  it('asks a fast wrong answer to re-read, without climbing, once they are on', () => {
    const a = decide(base({ attempt: 2, rungSoFar: 1, timing: { ...fast, rules: true } }));
    expect(a.kind).toBe('rethink');
    expect(a.rung).toBe(1);
    expect(LINES.reread.en).toContain(say(a));
    expect(a.because).toMatch(/fast/i);
  });

  it('lets a slow wrong answer climb as usual with the rules on', () => {
    const slow = { askedAt: 1_000_000 - (FAST_WRONG_MS + 500), rules: true };
    expect(decide(base({ attempt: 2, rungSoFar: 1, timing: slow })).kind).toBe('hint');
  });
});

/**
 * EVERY BRANCH, EVERY RUNG: the properties no single row can prove.
 */
describe('decide: over every branch', () => {
  afterEach(() => vi.restoreAllMocks());

  const verdicts: Verdict[] = ['right', 'wrong', 'unmatched', 'unclear', 'silent', 'stillSilent', 'hintRequest', 'explainRequest'];
  const WITH_ALTS: AskInput = {
    ...WITH_EXAMPLE,
    alternates: [{ mode: 'analogy', say: 'Think of a balance: take the same from both pans.' }],
  };
  const asks = { OPEN, OPTIONS, NO_HINT, LEAKY_HINT, WITH_EXAMPLE, LEAKY_EXAMPLE, OPEN_WITH_PROBE, NOTHING_TO_REVEAL, WITH_ALTS };
  const grid = (): Array<[string, DecideInput]> => {
    const rows: Array<[string, DecideInput]> = [];
    for (const verdict of verdicts) {
      for (const [name, ask] of Object.entries(asks)) {
        for (let rungSoFar = 0; rungSoFar <= 8; rungSoFar += 1) {
          for (const attempt of [1, 2, 3]) {
            for (const lang of ['en', 'hi-en'] as const) {
              for (const matchedOption of [undefined, 0, 1]) {
                rows.push([
                  `${verdict} ${name} rung ${rungSoFar} attempt ${attempt} ${lang} match ${matchedOption}`,
                  base({ verdict, ask, rungSoFar: rungSoFar as DecideInput['rungSoFar'], attempt, lang, matchedOption }),
                ]);
              }
            }
          }
        }
      }
    }
    return rows;
  };

  it('gives a reason on 100% of actions', () => {
    for (const [label, input] of grid()) {
      expect(decide(input).because.trim().length, label).toBeGreaterThan(0);
    }
  });

  it('never says or writes the answer before the reveal', () => {
    for (const [label, input] of grid()) {
      const a = decide(input);
      if (a.kind === 'reveal' || a.kind === 'praise') continue;
      expect(leaks(say(a), a.mustNotReveal), `${label}: ${say(a)}`).toBe(false);
      expect(leaks(a.boardIntent?.text ?? '', a.mustNotReveal), label).toBe(false);
    }
  });

  it('never moves the rung backwards, and never files more help than it gives', () => {
    for (const [label, input] of grid()) {
      const a = decide(input);
      const floor = Math.max(input.rungSoFar, input.attempt > 1 ? 1 : 0);
      expect(a.rung, label).toBeGreaterThanOrEqual(floor);
      // A content-free nudge is filed at L1 without moving the ladder; nothing
      // else files help above the rung it leaves in force — except another
      // explanation ASKED FOR, filed as the L7 it is while the ladder stays put
      // so a request never brings the answer nearer (H4).
      if (a.helped !== null && !(a.kind === 'explainAgain' && a.requested))
        expect(a.helped, label).toBeLessThanOrEqual(Math.max(a.rung, 1));
    }
  });

  it('climbs at most one delivered step per wrong answer', () => {
    const order = [0, 1, 3, 5, 7, 8];
    for (const [label, input] of grid()) {
      if (input.verdict !== 'wrong' && input.verdict !== 'unmatched') continue;
      const a = decide(input);
      if (a.helped === null) continue;
      const floor = Math.max(input.rungSoFar, input.attempt > 1 ? 1 : 0);
      const skipped = order.filter((r) => r > floor && r < a.helped!);
      // Only rungs with nothing usable authored for them may be skipped.
      for (const r of skipped) expect([3, 5, 7], `${label} skipped ${r}`).toContain(r);
    }
  });

  it('never reads the clock', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('decide read the clock');
    });
    for (const [, input] of grid().slice(0, 500)) expect(() => decide(input)).not.toThrow();
  });
});

describe('decide: a named misconception is diagnosed before it is corrected (brief §2, C7)', () => {
  const PROBED: AskInput = {
    question: 'Solve 3(x + 4) = 21. What is x?',
    expect: 'x = 3',
    hint: 'Open the bracket first.',
    whyProbe: {
      askedAs: 'open',
      options: [
        { text: 'x is three', correct: true, why: 'Three times seven is twenty-one.' },
        {
          text: 'x is five',
          correct: false,
          why: 'That comes from multiplying only the x by three.',
          followUp: 'What did you get when you opened the bracket?',
        },
      ],
    },
  };

  it('asks the distractor’s follow-up question on the first miss, not a generic rethink', () => {
    const a = decide(base({ ask: PROBED, matchedOption: 1 }));
    expect(a.kind).toBe('rethink');
    expect(a.helped).toBe(1);
    expect(say(a)).toContain('What did you get when you opened the bracket');
    expect(a.because).toMatch(/follow-up/i);
  });

  it('falls back to the generic rethink when the matched option has no follow-up', () => {
    const a = decide(base({ ask: OPEN_WITH_PROBE, matchedOption: 1 }));
    expect(a.kind).toBe('rethink');
    expect(LINES.rethink.en).toContain(say(a));
  });

  it('asks it on a TAPPED option too, from the probe option with the same words (second review)', () => {
    // Class-prep writes follow-ups on the probe's distractors; the chips a
    // child taps are the ask's own options. Same words, same misconception.
    const shown: AskInput = {
      ...PROBED,
      options: [
        { text: 'x is three', correct: true, why: 'Three times seven is twenty-one.' },
        { text: 'X is five ', correct: false, why: 'That comes from multiplying only the x by three.' },
      ],
    };
    const a = decide(base({ ask: shown, matchedOption: 1 }));
    expect(say(a)).toContain('What did you get when you opened the bracket');
  });

  it('never asks a follow-up that gives the answer away', () => {
    const leaky: AskInput = {
      ...PROBED,
      whyProbe: {
        askedAs: 'open',
        options: [PROBED.whyProbe!.options[0], { ...PROBED.whyProbe!.options[1], followUp: 'Is x equal to 3?' }],
      },
    };
    const a = decide(base({ ask: leaky, matchedOption: 1 }));
    expect(say(a)).not.toContain('Is x equal to 3?');
  });
});

describe('decide: an authored why keeps its content words', () => {
  it('strips a leading "yes" but never a first word that is content', () => {
    const ask = (why: string): AskInput => ({
      question: 'Q?',
      options: [
        { text: 'a', correct: true, why },
        { text: 'b', correct: false, why: 'No.' },
      ],
    });
    const praised = (why: string) => decide({ verdict: 'right', attempt: 1, rungSoFar: 0, ask: ask(why), matchedOption: 0, lang: 'en', now: 0 }).say ?? '';
    expect(praised('Right angles are ninety degrees.')).toContain('Right angles are ninety degrees.');
    expect(praised('Right-angled triangles obey it.')).toContain('Right-angled triangles obey it.');
    expect(praised('Good conductors let heat through.')).toContain('Good conductors let heat through.');
    expect(praised('Exactly! The gaps hold it.')).toContain('The gaps hold it.');
    expect(praised('Exactly! The gaps hold it.')).not.toContain('Exactly! The');
  });
});

describe('decide: a follow-up is marked as one', () => {
  it('flags the C7 follow-up so its reply is heard as reasoning, not a second answer', () => {
    const ask: AskInput = {
      question: 'Solve 3(x + 2) = 21.',
      expect: 'x = 5',
      whyProbe: {
        askedAs: 'open',
        options: [
          { text: 'x is five', correct: true, why: 'Three times seven is twenty-one.' },
          { text: 'x is seven', correct: false, why: 'Only the x was multiplied.', followUp: 'What did you get when you opened the bracket?' },
        ],
      },
    };
    const a = decide({ verdict: 'wrong', attempt: 1, rungSoFar: 0, ask, matchedOption: 1, lang: 'en', now: 0 });
    expect(a.followUp).toBe(true);
    const plain = decide({ verdict: 'wrong', attempt: 1, rungSoFar: 0, ask: { question: 'Q?', expect: 'x = 5' }, lang: 'en', now: 0 });
    expect(plain.followUp).toBeUndefined();
  });
});

describe('decide: an authored why, as written (fifth review)', () => {
  const praisedWith = (why: string) =>
    decide({
      verdict: 'right', attempt: 1, rungSoFar: 0, lang: 'en', now: 0, matchedOption: 0,
      ask: { question: 'Q?', options: [{ text: 'a', correct: true, why }, { text: 'b', correct: false, why: 'No.' }] },
    }).say ?? '';

  it('keeps the case of a why it took nothing off', () => {
    expect(praisedWith('x = 3 because 2x = 6.')).toContain('x = 3 because 2x = 6.');
    expect(praisedWith('pH 7 is neutral.')).toContain('pH 7 is neutral.');
    expect(praisedWith('mRNA carries the message.')).toContain('mRNA carries the message.');
  });

  it('takes off the openers teachers really write', () => {
    for (const opener of ['Precisely.', 'Perfect!', 'Absolutely!', "That's correct!", 'Exactly right!', 'Good job!', 'You got it!', 'Bilkul sahi!', 'Sahi hai!'])
      expect(praisedWith(`${opener} The gaps hold it.`), opener).not.toContain(opener);
  });
});

/**
 * H4: ANOTHER WAY TO EXPLAIN IT — L7, after the worked example and before
 * the answer, or when the student asks. Never the answer; a request never
 * brings the reveal nearer.
 */
describe('decide: another way to explain it (L7)', () => {
  const WITH_ALTERNATES: AskInput = {
    ...OPEN,
    alternates: [
      { mode: 'analogy', say: 'Think of the equation as a balance: whatever you take from one pan, take from the other.' },
      { mode: 'everyday', say: 'If three friends share some sweets plus four extra, work back from the total.' },
    ],
  };

  it('explains it another way after the hint, before the answer, when there is no worked example', () => {
    const a = decide(base({ ask: WITH_ALTERNATES, rungSoFar: 3, attempt: 3 }));
    expect(a.kind).toBe('explainAgain');
    expect(a.rung).toBe(7);
    expect(a.helped).toBe(7);
    expect(say(a)).toContain('balance');
    // And the next miss reveals.
    expect(decide(base({ ask: WITH_ALTERNATES, rungSoFar: 7, attempt: 4 })).kind).toBe('reveal');
  });

  it('comes after the worked example when both exist', () => {
    const both: AskInput = { ...WITH_EXAMPLE, alternates: WITH_ALTERNATES.alternates };
    expect(decide(base({ ask: both, rungSoFar: 3, attempt: 3 })).kind).toBe('workedExample');
    expect(decide(base({ ask: both, rungSoFar: 5, attempt: 4 })).kind).toBe('explainAgain');
  });

  it('explains it another way when asked, without climbing towards the answer', () => {
    const a = decide(base({ verdict: 'explainRequest', ask: WITH_ALTERNATES }));
    expect(a.kind).toBe('explainAgain');
    expect(a.requested).toBe(true);
    expect(a.rung).toBe(0);
    // The next wrong answer still gets the rethink, not the answer.
    expect(decide(base({ ask: WITH_ALTERNATES, rungSoFar: a.rung })).kind).toBe('rethink');
  });

  it('gives a different explanation the second time it is asked', () => {
    const first = decide(base({ verdict: 'explainRequest', ask: WITH_ALTERNATES }));
    const second = decide(base({ verdict: 'explainRequest', ask: WITH_ALTERNATES, recentLines: [first.say!] }));
    expect(second.say).not.toBe(first.say);
  });

  it('never explains it with the answer in it', () => {
    const leaky: AskInput = { ...OPEN, alternates: [{ mode: 'steps', say: 'Take three, then divide: x is four.' }] };
    expect(decide(base({ verdict: 'explainRequest', ask: leaky })).kind).not.toBe('explainAgain');
    expect(decide(base({ ask: leaky, rungSoFar: 3, attempt: 3 })).kind).toBe('reveal');
  });

  // Second review: every class kept before H4 answered "phir se samjhao" with
  // an empty "have a go" while its hint sat unused.
  it('answers a request with no alternates with the hint, and with nothing authored by asking for a first step', () => {
    const a = decide(base({ verdict: 'explainRequest', ask: OPEN }));
    expect(a.kind).toBe('hint');
    expect(a.requested).toBe(true);
    expect(say(a)).toContain('Take 3 from both sides first.');
    const bare = decide(base({ verdict: 'explainRequest', ask: { question: OPEN.question, expect: OPEN.expect } }));
    expect(LINES.haveAGo.en).toContain(say(bare));
  });

  it('keeps the skipped rungs in the reason when L7 is earned', () => {
    const a = decide(base({ ask: WITH_ALTERNATES, rungSoFar: 3, attempt: 3 }));
    expect(a.because).toContain('no usable worked example');
  });
});

describe('decide: the strategy tag (H5)', () => {
  it('tags each help with how she helped', () => {
    expect(decide(base({ rungSoFar: 0 })).strategy).toBe('rethink');
    expect(decide(base({ rungSoFar: 1, attempt: 2 })).strategy).toBe('hint');
    const alt: AskInput = { ...OPEN, alternates: [{ mode: 'everyday', say: 'Like sharing sweets fairly.' }] };
    expect(decide(base({ verdict: 'explainRequest', ask: alt })).strategy).toBe('everyday');
  });
});
