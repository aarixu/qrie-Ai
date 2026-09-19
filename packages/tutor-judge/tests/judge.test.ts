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

/**
 * WHETHER THE REASONING STOOD UP, WHICH SHE DECIDES AND NEVER SAID.
 *
 * The cross-question exists to find out one thing: can they justify what they
 * already produced — mastery rather than recall. `CLOSE_SYSTEM` branches on
 * exactly that and used to return only the sentence she speaks, so the answer
 * was reached inside the model and thrown away, and the ledger had no source
 * for it. That is `gave` again, which went missing the same way.
 */
describe('what the close made of their reasoning', () => {
  it('is asked for in so many words, and never spoken', () => {
    const sys = CLOSE_SYSTEM();
    expect(sys).toMatch(/"held":true\|false/);
    expect(sys).toMatch(/recorded, never spoken/);
  });

  it('carries a verdict that held and one that wobbled', () => {
    expect(parseFollowUp('{"say":"That is it exactly.","held":true}').held).toBe(true);
    expect(parseFollowUp('{"say":"Here is the why.","held":false}').held).toBe(false);
  });

  /**
   * Unlike `gave`, there is NO default here and there must not be. A wrong
   * answer is always followed by one of two moves, so a missing `gave` can be
   * inferred from the fact that she replied at all; the close is spoken
   * whichever way the reasoning went, so there is nothing to infer from. A
   * default would file "we never asked" as a judgement about the student.
   */
  it('stays silent rather than guessing when the model omitted it', () => {
    expect(parseFollowUp('{"say":"Here is the why."}').held).toBeUndefined();
    expect(parseFollowUp('{"say":"Here is the why.","held":"yes"}').held).toBeUndefined();
  });

  /**
   * The same hole `SpokenVerdict.heard` was added to close, one turn later:
   * this call screens the reasoning, sends the screened copy, and used to
   * discard it — leaving the raw transcript as the caller's only handle, on
   * the one path (`clean`) that found something and deliberately did not halt.
   */
  it('hands back the screened reasoning, not the raw transcript', async () => {
    const d = deps('{"say":"That is it.","held":true}', { text: 'my number is', say: null });
    const out = await resolveCrossQuestion(ask, 'every cell', 'why?', 'my number is 98765 43210', d);
    expect(out.heard).toBe('my number is');
    expect(out.heard).not.toContain('98765');
  });

  it('keeps nothing of a turn the screen stopped', async () => {
    const out = await resolveCrossQuestion(ask, 'every cell', 'why?', 'x', stopped('Talk to someone.'));
    expect(out.halt).toBe(true);
    expect(out.heard).toBeUndefined();
    expect(out.held).toBeUndefined();
  });
});

/**
 * WHAT THE PLANNER AUTHORED, PUT IN FRONT OF THE JUDGE.
 *
 * A whyProbe is the tutor's judgement written at prep time: the right answer,
 * the named misconceptions as a student who holds one would SAY it, and the
 * reply she gives for each. `SpokenAsk` had no field for it, so `describeAsk`
 * could not carry it — and the escalated model call, the only one anybody pays
 * for, was the least informed thing in the loop.
 *
 * Wave 3 made that worse rather than better: it refused the two ordinal
 * readings on an open ask, so escalation is now the outcome for most spoken
 * answers that are not close to verbatim. The judge is on the path far more
 * often than it was, and it was arriving blind.
 *
 * TWO RULES THESE TESTS EXIST TO HOLD.
 *
 *  1. IT MUST NOT BECOME A LIST THE MODEL PICKS FROM. The pedagogy is explicit
 *     that a student picking from a list is recognising rather than thinking
 *     (lesson-format types.ts:41), and the student was shown none of this. A
 *     lettered list in the prompt is one paraphrase away from being read out.
 *  2. THE AUTHORED WORDS ARE HERS AND ALREADY WRITTEN. `why` is what she SAYS
 *     on a match — the local path speaks it verbatim — so if the model reaches
 *     for it, a tap and a spoken answer to the same question must not come back
 *     differently worded.
 */
describe('the judgement the planner already authored', () => {
  const probed: SpokenAsk = {
    question: 'How many chambers does the human heart have?',
    // CARRIED ON PURPOSE, and the budget test below is why: class-prep asks the
    // planner for `expect` on every ask (packages/class-prep/src/prompts.ts) and
    // for a probe on every normal one, so an ask with a probe and no `expect` is
    // a shape production never emits. Pricing the block against one netted the
    // 78-character "An open question - no options" fallback off the delta and
    // understated what the product actually pays.
    expect: 'four — two atria and two ventricles',
    hint: 'Count the ones on top and the ones below.',
    whyProbe: {
      askedAs: 'open',
      options: [
        {
          text: 'four chambers, two atria and two ventricles',
          correct: true,
          why: 'Yes - two atria on top, two ventricles below.',
        },
        {
          text: 'two chambers, one in and one out',
          why: 'That is a fish heart, not ours.',
          hint: 'Where would the used blood and the fresh blood mix?',
        },
        { text: 'three chambers like a frog', why: 'A frog has three; a human has four.' },
      ],
    },
  };

  it('tells the judge what a right answer amounts to, in the planner words', () => {
    const out = describeAsk(probed);
    expect(out).toContain('four chambers, two atria and two ventricles');
  });

  it('names the wrong turns the planner expects, as a student would say them', () => {
    const out = describeAsk(probed);
    expect(out).toContain('two chambers, one in and one out');
    expect(out).toContain('three chambers like a frog');
  });

  it('carries the authored reply and nudge for each wrong turn', () => {
    const out = describeAsk(probed);
    expect(out).toContain('That is a fish heart, not ours.');
    expect(out).toContain('Where would the used blood and the fresh blood mix?');
  });

  /**
   * THE OPTIONS ARE THE JUDGE'S EARS, NOT THE STUDENT'S CHOICES.
   *
   * Said in the prompt in so many words, because the model has no other way to
   * know: everything else in this user message describes a question the student
   * can see, and these three sentences are the one part they cannot.
   */
  it('says plainly that these are the judge ears and never the student choices', () => {
    const out = describeAsk(probed);
    expect(out).toMatch(/shown none of it/i);
    expect(out).toMatch(/never read these out/i);
    expect(out).toMatch(/never ask them to pick/i);
  });

  /**
   * AND THE READING RULE, WHICH IS NOT THE SAME AS THE SPEAKING RULES.
   *
   * `JUDGE_SYSTEM` tells the model students may answer "in their own words or
   * by letter". On an open ask that was harmless while the user message carried
   * no list — a letter indexed nothing. The probe IS a list, ordered, correct
   * option first. Every other guard in the block constrains what she SAYS; none
   * of them constrains how she READS, and `apps/classroom/src/lib/judge.ts`
   * refuses a letter or a position locally and ESCALATES it, so a child who
   * says "B" on an open ask is routed to exactly this prompt. Wave 3 refused
   * that reading on purpose; the block must not hand it back.
   */
  it('refuses the model the ordinal reading the local path escalated to it', () => {
    const out = describeAsk(probed);
    expect(out).toMatch(/no letters and no order/i);
    expect(out).toMatch(/names nothing here/i);
  });

  it('does NOT letter them, because a lettered list is a list to pick from', () => {
    const out = describeAsk(probed);
    // A. / B. / C. is what `ask.options` looks like when a list really IS on
    // screen. A probe that renders the same way is one paraphrase from being
    // read out to a child who was asked an open question.
    expect(out).not.toMatch(/^[A-D]\. /m);
  });

  /**
   * HER WORDS, ALREADY WRITTEN — not a hint to paraphrase.
   *
   * The local path speaks `why` verbatim (apps/classroom/src/lib/judge.ts).
   * If the escalated path reworded it, the same misconception would be answered
   * one way by a tap and another way by a voice, and the difference would be
   * invisible to everyone except the child hearing both.
   */
  it('marks the authored words as hers and already written, not as a hint', () => {
    const out = describeAsk(probed);
    expect(out).toMatch(/already written, in her words/i);
    expect(out).toMatch(/do not paraphrase/i);
  });

  /**
   * A RIGHT ANSWER STILL DOES NOT GET THE REASON.
   *
   * `JUDGE_SYSTEM` is explicit — acknowledge, ask ONE cross-question, STOP,
   * "Do not give the reason yet". The correct option's `why` IS that reason, so
   * handing it over unlabelled would let the probe quietly repeal the one rule
   * the whole cross-question exists to enforce. It is what she CLOSES with,
   * which is a different turn.
   */
  it('does not let the right answer why be spoken in place of the cross-question', () => {
    const out = describeAsk(probed);
    // Bound to the TURN rather than to the verdict, because this same
    // description feeds `resolveCrossQuestion` too — and on that turn
    // `CLOSE_SYSTEM` asks for exactly this line. "Do not give it on a right
    // answer" was an instruction the close had to be rescued from by its
    // trailing clause.
    expect(out).toMatch(/Not on the turn you judge/i);
    expect(out).toMatch(/cross-question first/i);
    expect(out).toMatch(/closes with once they have reasoned/i);
  });

  /**
   * A WRONG TURN GETS THE NUDGE, NOT THE NUDGE AND THE ANSWER.
   *
   * `JUDGE_SYSTEM` gives a wrong answer ONE move: a question or the hint, never
   * the answer. A distractor's `why` IS the correction, and "Her nudge first /
   * Then her reply" reads as two halves of one turn. The local path is not
   * ambiguous about this — it speaks `hint ?? why`, exactly one of them
   * (apps/classroom/src/lib/judge.ts) — so the prompt says the same thing, and
   * a tap and a spoken answer to one misconception stay the same turn.
   */
  it('gives a wrong turn the nudge for this turn and holds the reply for later', () => {
    const out = describeAsk(probed);
    expect(out).toMatch(/Her nudge for this turn: "Where would the used blood/);
    expect(out).toMatch(/for later, once they have tried again: "That is a fish heart/);
  });

  it('speaks the reply on this turn for a wrong turn with no nudge, as the local path does', () => {
    // `hint ?? why`: with no hint the authored `why` IS the first move, and
    // the prompt must not tell the model to withhold what a tap would speak.
    const out = describeAsk(probed);
    expect(out).toMatch(/Her reply for this turn: "A frog has three; a human has four\."/);
  });

  /**
   * THE PROMPT IS BILLED, SO ITS SIZE IS A NUMBER SOMEBODY OWNS.
   *
   * TWO TERMS, AND ONLY ONE OF THEM IS OURS. The block costs a FIXED framing
   * cost plus the planner's own words, and the planner's words are as long as
   * the planner made them. Asserting the total for one fixture prices a probe
   * nobody ships: class-prep asks for 2-4 options, each with a misconception
   * sentence and a spoken `why` (packages/class-prep/src/prompts.ts), so a
   * four-option probe is an ordinary outcome and costs far more than this
   * three-option one. So the ceiling below is on the FRAMING - the part a
   * change to this file can actually move.
   *
   * MEASURED, both of them, by rendering probes whose authored text is one
   * character an option: the header and the right-answer scaffolding come to
   * 688 characters for the header and the right answer's own turn, 165 more
   * for the wrong-turns section and its first turn, and 91 for each wrong turn
   * after that. At four characters to the token, gemini-3.7-flash's $0.75/1M prompt
   * price and Rs 95.6 to the dollar, every 100 characters here is Rs 0.0018 on
   * every escalated judge-side call and the measured class makes eight of
   * those. The ceilings are not a style rule, they are the Rs 5 ceiling with a
   * number on it: a change that needs more room has to redo the arithmetic in
   * `describeProbe` and move these numbers on purpose.
   */
  /**
   * THE THREE TERMS, EACH PINNED SO IT CANNOT DRIFT SILENTLY.
   *
   * The header ceiling used to be 560, measured against a probe carrying one
   * option with `text` and nothing else — a shape packages/class-prep never
   * produces, because it requires a `why` on every option. That measurement
   * was 533 and it underbilled every real probe by 138 to 229 characters.
   * These three are measured against the shapes the planner is actually asked
   * for.
   */
  const HEADER_CEILING = 720;
  const FIRST_TURN_CEILING = 180;
  const PER_TURN_CEILING = 100;

  /** Everything the renderer added that the planner did not write. */
  const framingOf = (a: SpokenAsk): number => {
    const authored = (a.whyProbe?.options ?? []).reduce(
      (n, o) => n + o.text.length + (o.why?.length ?? 0) + (o.hint?.length ?? 0),
      0,
    );
    // The SAME ask minus only the probe. Building the baseline by hand dropped
    // `expect` as well, so the fallback line rendered in its place was netted
    // off the delta and the block looked 79 characters cheaper than it is.
    return describeAsk(a).length - describeAsk({ ...a, whyProbe: undefined }).length - authored;
  };

  const withOptions = (options: NonNullable<SpokenAsk['whyProbe']>['options']): SpokenAsk => ({
    ...probed,
    whyProbe: { askedAs: 'open', options },
  });

  it('keeps the fixed framing inside a budget somebody has actually priced', () => {
    // One-character options, so what is left IS the scaffolding. This is where
    // an explanatory sentence lands, and it is billed on every escalated call.
    // WITH a `why`, because class-prep requires one and a probe without one is
    // not a probe this repo can be handed.
    expect(
      framingOf(withOptions([{ text: 'x', correct: true, why: 'w' }])),
    ).toBeLessThanOrEqual(HEADER_CEILING);
  });

  it('keeps the wrong-turns section and its first turn inside their own budget', () => {
    // The step from "no wrong turns" to "one wrong turn" pays for the section
    // header as well as the turn, so it is bigger than every step after it and
    // is priced on its own rather than averaged into them.
    const one = withOptions([{ text: 'x', correct: true, why: 'w' }]);
    const two = withOptions([
      { text: 'x', correct: true, why: 'w' },
      { text: 'y', why: 'z', hint: 'h' },
    ]);
    expect(framingOf(two) - framingOf(one)).toBeLessThanOrEqual(FIRST_TURN_CEILING);
  });

  it('keeps what each further wrong turn costs inside its own budget', () => {
    const two = withOptions([
      { text: 'x', correct: true, why: 'w' },
      { text: 'y', why: 'z', hint: 'h' },
    ]);
    const three = withOptions([
      { text: 'x', correct: true, why: 'w' },
      { text: 'y', why: 'z', hint: 'h' },
      { text: 'a', why: 'b', hint: 'c' },
    ]);
    // Priced separately because THIS is the term that scales: class-prep asks
    // for 2-4 options, so the same two labels are paid for up to three times.
    expect(framingOf(three) - framingOf(two)).toBeLessThanOrEqual(PER_TURN_CEILING);
  });

  /**
   * AND THE TOTAL SCALES WITH THE PLANNER, WHICH IS THE NUMBER TO QUOTE.
   *
   * Not a ceiling - a demonstration, so the cost of a REAL probe is written
   * down somewhere rather than inferred from a miniature one. A four-option
   * probe of the length class-prep asks for is the upper bound the wave should
   * plan against, and it is roughly twice this fixture's.
   */
  it('costs what the planner writes: a four-option probe is the real upper bound', () => {
    const big: SpokenAsk = {
      ...probed,
      whyProbe: {
        askedAs: 'open',
        options: [
          {
            text: 'the sound travels faster through the solid rail than through the air',
            correct: true,
            why: 'Yes — the particles in a solid are close enough to pass the knock on at once.',
          },
          {
            text: 'the rail is louder because metal makes more noise than air',
            why: 'Loudness is not speed. The rail carries it sooner, not bigger.',
            hint: 'Which one reached your ear first?',
          },
          {
            text: 'the sound went through the gaps between the particles',
            why: 'Sound needs the particles themselves, not the gaps between them.',
            hint: 'What would happen if there were nothing there at all?',
          },
          {
            text: 'the train was simply closer to the rail than to me',
            why: 'Distance would change both the same way; this changed only one.',
            hint: 'Both sounds started at the same place.',
          },
        ],
      },
    };
    const delta = describeAsk(big).length - describeAsk({ ...big, whyProbe: undefined }).length;
    // MEASURED: 1,654 characters — ~414 prompt tokens, Rs 0.0296 a call and
    // Rs 0.237 across the eight judge-side calls the measured class makes,
    // against a judge bill of Rs 1.13. The three-option fixture above costs
    // 1,151. If this moves, the arithmetic in the report has moved with it.
    expect(delta).toBeGreaterThan(1500);
    expect(delta).toBeLessThan(1800);
  });

  it('adds nothing at all when the ask carries no probe', () => {
    const out = describeAsk({ question: 'What do you notice?' });
    expect(out).not.toMatch(/already written, in her words/i);
    expect(out).toContain('An open question - no options');
  });

  /**
   * AND IT HAS TO REACH THE WIRE, not merely the formatter.
   *
   * `describeAsk` is called from two places and the escalated judge is the one
   * that costs money. A field added to the type and rendered by the formatter
   * but dropped on the way to `complete` would pass every test above.
   */
  it('reaches the escalated judge call itself, not just the formatter', async () => {
    const d = deps('{"verdict":"wrong","say":"Count the top ones.","gave":"hint"}');
    await judgeSpokenAnswer(probed, 'two chambers', d);
    const [, user] = d.complete.mock.calls[0];
    expect(user).toContain('That is a fish heart, not ours.');
  });

  it('reaches the close as well, which speaks the authored why for real', async () => {
    // CLOSE_SYSTEM's own rule is "give the full why in one line" — so on this
    // turn the correct option's `why` is not withheld, it IS her line.
    const d = deps('{"say":"Two atria, two ventricles.","held":true}');
    await resolveCrossQuestion(probed, 'four chambers', 'why four?', 'two circuits', d);
    const [, user] = d.complete.mock.calls[0];
    expect(user).toContain('Yes - two atria on top, two ventricles below.');
  });
});
