import { describe, expect, it, vi } from 'vitest';
import {
  CLOSE_SYSTEM,
  JUDGE_SYSTEM,
  describeAsk,
  judgeSpokenAnswer,
  parseFollowUp,
  parseVerdict,
  resolveCrossQuestion,
  type JudgeDeps,
  type SpokenAsk,
} from '../src/index';

/**
 * This decides right from wrong for every answer a student speaks aloud, and
 * until it moved into a package its only test covered the JSON parser. The
 * prompt itself — where all the teaching decisions actually live — was
 * unverified, which meant any of them could be softened in a hurry and nothing
 * would notice.
 */

const ask: SpokenAsk = {
  question: 'Why does a resting animal still need oxygen everywhere?',
  options: [
    { text: 'Every cell is alive', correct: true, why: 'each cell respires on its own' },
    { text: 'Only the brain', hint: 'think about a cut on your finger healing' },
  ],
};

type Screened = ReturnType<JudgeDeps['screen']>;

/** A judge wired to a canned reply and a screener that passes words through. */
const deps = (reply: string, screened?: Screened) => ({
  complete: vi.fn(async (_system: string, _user: string) => reply),
  screen: (text: string): Screened => screened ?? { text },
});

/** A judge whose screener stops the turn — the model must never be reached. */
const stopped = (say: string | null) => deps('', { text: null, say });

describe('the pedagogy in the prompt', () => {
  const sys = JUDGE_SYSTEM();

  it('forbids praise, because praise ends the thinking', () => {
    expect(sys).toMatch(/NEVER say "correct" or congratulate/);
  });

  it('makes a RIGHT answer earn the reason rather than receive it', () => {
    // A right answer is not the exit: one cross-question about their own
    // answer, then stop. The reason is what they get for thinking one step
    // further, not for being right.
    expect(sys).toMatch(/ask ONE cross-question about their own answer/);
    expect(sys).toMatch(/STOP THERE/);
    expect(sys).toMatch(/Do not give the reason yet/);
  });

  it('never lets a wrong answer be handed the answer', () => {
    expect(sys).toMatch(/wrong: never reveal the answer/);
  });

  it('counts "I don\'t know" as WRONG, not unclear', () => {
    // Unclear records no evidence at all. A student who says they do not know
    // has told us something real, and filing it as noise loses it.
    expect(sys).toMatch(/"I don't know" is wrong, not unclear/);
  });

  it('judges the idea rather than the language', () => {
    expect(sys).toMatch(/English, Hindi or a mix/);
    expect(sys).toMatch(/Judge the IDEA, not the wording or the language/);
  });

  it('keeps the close free of praise too', () => {
    expect(CLOSE_SYSTEM()).toMatch(/NEVER say "correct" or congratulate/);
    expect(CLOSE_SYSTEM()).toMatch(/never the word "wrong"/);
  });
});

describe('describing the held question', () => {
  it('letters the options and marks the right one', () => {
    const out = describeAsk(ask);
    expect(out).toContain('A. Every cell is alive [THE RIGHT ONE]');
    expect(out).toContain('(why: each cell respires on its own)');
    expect(out).toContain('B. Only the brain');
    expect(out).toContain('(hint: think about a cut on your finger healing)');
  });

  it('passes the planner\'s own words through for an open question', () => {
    // The judge's leading question should build on what the lesson already
    // decided to say, not invent a second pedagogy at runtime.
    const out = describeAsk({
      question: 'What happens to the sugar?',
      expect: 'it fits into the gaps between water particles',
      hint: 'the level did not rise',
    });
    expect(out).toContain('A right answer contains: it fits into the gaps between water particles');
    expect(out).toContain('If they are wrong, lead with this nudge: the level did not rise');
  });

  it('says so plainly when an open question has nothing authored', () => {
    const out = describeAsk({ question: 'What do you notice?' });
    expect(out).toContain('An open question - no options');
  });
});

describe('a disclosure', () => {
  it('never reaches the model at all', async () => {
    const d = stopped('That sounds heavy. Is there someone you can tell?');
    const out = await judgeSpokenAnswer(ask, 'something serious', d);
    expect(d.complete).not.toHaveBeenCalled();
    expect(out.halt).toBe(true);
    expect(out.say).toContain('someone you can tell');
  });

  it('is recorded as unclear, never as a wrong answer', async () => {
    // This is not evidence that the student got the question wrong, and the
    // outcome map must not be told that it is.
    const d = stopped('x');
    expect((await judgeSpokenAnswer(ask, 'anything', d)).verdict).toBe('unclear');
  });

  it('stops the close as well, rather than resolving over them', async () => {
    const d = stopped('I am glad you told me.');
    const out = await resolveCrossQuestion(ask, 'every cell', 'why?', 'because…', d);
    expect(d.complete).not.toHaveBeenCalled();
    expect(out.halt).toBe(true);
  });

  it('tolerates a screener that removed something but has nothing to add', async () => {
    const d = stopped(null);
    await expect(judgeSpokenAnswer(ask, 'x', d)).resolves.toMatchObject({ say: '', halt: true });
  });
});

describe('the ordinary path', () => {
  it('sends the SCREENED words, never the raw ones', async () => {
    // Unescaped, a quote mark ends the block and everything after it reads as a
    // new turn — so an answer box was a second system prompt.
    const d = deps('{"verdict":"right","say":"And why?"}', { text: 'cleaned words' });
    await judgeSpokenAnswer(ask, 'raw " words', d);
    const [, user] = d.complete.mock.calls[0];
    expect(user).toContain('The student said: "cleaned words"');
    expect(user).not.toContain('raw " words');
  });

  it('returns the verdict and her next line', async () => {
    const d = deps('{"verdict":"wrong","say":"Where does the energy come from?","gave":"question"}');
    await expect(judgeSpokenAnswer(ask, 'the brain', d)).resolves.toEqual({
      verdict: 'wrong',
      say: 'Where does the energy come from?',
      gave: 'question',
      heard: 'the brain',
    });
  });

  /**
   * THE SCREENED WORDS ARE THE ONLY ONES THAT COME BACK.
   *
   * One of the screen's verdicts is `clean`: it finds something a child should
   * not have had to put in an answer, takes it out, records a flag, and
   * deliberately does NOT stop the class over it. That cleaned text went to the
   * model and was then discarded, and the classroom passed the RAW transcript
   * to the ledger — so the one path that detected a phone number was also the
   * path that wrote it down. `halt` did not save it: halt is for a redirect or
   * a disclosure, not for a clean.
   */
  it('hands back what may be kept, not what was heard', async () => {
    // A `clean` verdict: the screen took the number out and let the class run
    // on, which is exactly the case `halt` does not cover.
    const d = deps('{"verdict":"right","say":"Why is that?"}', { text: 'my number is', say: null });
    const out = await judgeSpokenAnswer(ask, 'my number is 98765 43210', d);
    expect(out.heard).toBe('my number is');
    expect(out.heard).not.toContain('98765');
  });

  it('keeps nothing at all when the screen stopped the turn', async () => {
    const d = deps('{"verdict":"right","say":"hi"}');
    d.screen = () => ({ text: null, say: 'That sounds hard. Talk to someone you trust.' });
    const out = await judgeSpokenAnswer(ask, 'something a child should not carry alone', d);
    expect(out.halt).toBe(true);
    expect(out.heard).toBeUndefined();
    expect(d.complete).not.toHaveBeenCalled();
  });
});

/**
 * WHICH RUNG SHE JUST STOOD ON.
 *
 * The classroom records the rung of assistance in force when an answer lands,
 * and rung 0 — left alone — is the only one the learner model will ever accept
 * as mastery. A wrong spoken answer is always followed by help, so if the
 * judge does not say what it gave, the retry is filed as unassisted and the
 * whole assisted/unassisted split is a fiction. Every voice-answered question
 * in the product hit this on its first miss.
 */
describe('the help she gave, so the class can record it', () => {
  it('carries the leading question as rung 2, the hint as rung 3', () => {
    expect(parseVerdict('{"verdict":"wrong","say":"Why?","gave":"question"}').gave).toBe('question');
    expect(parseVerdict('{"verdict":"wrong","say":"Remember the equation.","gave":"hint"}').gave).toBe('hint');
  });

  it('still records help when the model forgot to say which it gave', () => {
    // She was told to do one or the other and her reply proves she did. The
    // rung may be off by one; "unassisted" would be off by everything.
    expect(parseVerdict('{"verdict":"wrong","say":"Think again about the roots."}').gave).toBe('question');
  });

  it('says nothing about help on a right or unclear answer, because none was given', () => {
    expect(parseVerdict('{"verdict":"right","say":"Why is that?","gave":"hint"}').gave).toBeUndefined();
    expect(parseVerdict('{"verdict":"unclear","say":"Say that again?"}').gave).toBeUndefined();
  });
});

describe('holding the reply to shape', () => {
  it('falls back to unclear rather than inventing a verdict', () => {
    expect(parseVerdict('{"verdict":"maybe","say":"hm"}').verdict).toBe('unclear');
  });

  it('finds the object in a reply wrapped in prose or fences', () => {
    expect(parseVerdict('```json\n{"verdict":"right","say":"Why?"}\n```').say).toBe('Why?');
  });

  it('refuses a verdict with nothing to say', () => {
    // The class is holding on this question; something has to be spoken before
    // it can move, so silence is a failure rather than a quiet pass.
    expect(() => parseVerdict('{"verdict":"right","say":"  "}')).toThrow(/nothing to say/);
    expect(() => parseVerdict('no json here')).toThrow(/without a verdict/);
  });

  it('refuses a close with nothing to say', () => {
    expect(() => parseFollowUp('{}')).toThrow(/without words/);
  });
});
