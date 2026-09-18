import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhyProbe } from '@ai-tutor/lesson-format';

/**
 * THE Rs 5 DECISION, TESTED AT ITS BOUNDARY.
 *
 * The saving is not the point of these tests — the REFUSAL is. A wrong verdict
 * reached locally has nothing behind it to catch it, and telling a child who
 * answered correctly in Hinglish that they are wrong is the worst thing this
 * product can do to somebody (matchSpokenAnswer's own header says so). So the
 * assertions that matter most are the ones that prove an unconfident local
 * read still reaches the model.
 */

/** Counts the model calls, so "no LLM call" is measured and not asserted. */
const completions: { system: string; user: string }[] = [];
let reply = '{"verdict":"right","say":"Because the gaps hold it."}';

vi.mock('../src/lib/browserLlm', () => ({
  createBrowserLlm: () => ({
    complete: (system: string, user: string) => {
      completions.push({ system, user });
      return Promise.resolve(reply);
    },
  }),
  createBrowserImageArtist: () => ({}),
  createBrowserVision: () => ({}),
}));

const probe = (): WhyProbe => ({
  askedAs: 'open',
  options: [
    {
      text: 'the water rises because the gaps between the particles fill up',
      correct: true,
      why: 'Yes — the sugar slips into the gaps, so the level barely moves.',
    },
    {
      text: 'the sugar melted into the water',
      why: 'Melting needs heat. This is dissolving, which is a different thing.',
      hint: 'Was anything heated?',
    },
  ],
});

const ask = (extra: Record<string, unknown> = {}) => ({
  question: 'Why does the level barely move?',
  hint: 'Think about the spaces between the particles.',
  ...extra,
});

beforeEach(() => {
  completions.length = 0;
  reply = '{"verdict":"right","say":"Because the gaps hold it."}';
  localStorage.clear();
});

describe('a spoken answer against an authored whyProbe', () => {
  it('resolves a verbatim right answer with NO model call, and speaks the authored why', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: probe() }),
      'the water rises because the gaps between the particles fill up',
    );
    expect(completions).toHaveLength(0);
    expect(resolved.path).toBe('local');
    expect(resolved.verdict.verdict).toBe('right');
    expect(resolved.verdict.say).toContain('slips into the gaps');
  });

  it('reads Hinglish without a model when a list WAS shown — "B hoga na" is option B', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    // The confusable-pairs exception: askedAs 'options' AND a shown ask.options
    // mirroring the probe. Only here does a letter have a referent.
    const shown = probe();
    shown.askedAs = 'options';
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: shown, options: shown.options.map((o) => ({ text: o.text })) }),
      'B hoga na',
    );
    expect(completions).toHaveLength(0);
    expect(resolved.path).toBe('local');
    expect(resolved.verdict.verdict).toBe('wrong');
    // The nudge, not the correction: the same authored material the tap path
    // reaches for first.
    expect(resolved.verdict.say).toBe('Was anything heated?');
    expect(resolved.verdict.gave).toBe('hint');
  });

  /**
   * THE LIST SHOWN MUST BE THE LIST INDEXED.
   *
   * `askedAs: 'options'` plus a non-empty `ask.options` was the whole guard,
   * and it passes for a shown list that does not correspond to the probe's.
   * The ordinal readings index `probe.options`; the child is reading
   * `ask.options`. Nothing upstream requires the two to match — the format
   * validator checks the probe alone, and class-prep's prompt sanctions
   * 'options' without mentioning correspondence — so both of these resolved
   * locally, at confidence 1, against an option that was never on screen.
   */
  it('escalates a letter when the shown list is SHORTER than the probe', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const shown = probe();
    shown.askedAs = 'options';
    shown.options.push({
      text: 'the sugar pushed the water aside',
      why: 'That would raise the level. It barely moved.',
    });
    // Three in the probe, two on screen. "C" names nothing the child saw.
    const resolved = await resolveSpokenAnswer(
      ask({
        whyProbe: shown,
        options: shown.options.slice(0, 2).map((o) => ({ text: o.text })),
      }),
      'C',
    );
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
  });

  it('escalates a letter when the shown list is REORDERED against the probe', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const shown = probe();
    shown.askedAs = 'options';
    // Same two options, same count, opposite order: "A" is the correct answer
    // on screen and the distractor in the probe. Equal lengths would have let
    // this through, which is why the guard compares the text and not the size.
    const resolved = await resolveSpokenAnswer(
      ask({
        whyProbe: shown,
        options: [...shown.options].reverse().map((o) => ({ text: o.text })),
      }),
      'A',
    );
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
  });

  it('still reads locally when the shown list mirrors the probe but for case and spacing', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const shown = probe();
    shown.askedAs = 'options';
    // The same list written twice by a planner, not a different list. Refusing
    // here would cost a model call on every correctly-authored options ask.
    const resolved = await resolveSpokenAnswer(
      ask({
        whyProbe: shown,
        options: shown.options.map((o) => ({ text: '  ' + o.text.toUpperCase() + ' ' })),
      }),
      'B hoga na',
    );
    expect(completions).toHaveLength(0);
    expect(resolved.path).toBe('local');
  });

  it('ESCALATES an unconfident read rather than guessing at it', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"wrong","say":"Think about the spaces.","gave":"hint"}';
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: probe() }),
      'something about water and sugar and particles maybe',
    );
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
    expect(resolved.verdict.verdict).toBe('wrong');
  });

  it('escalates when the beat carries no whyProbe at all', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(ask(), 'the gaps fill up');
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
  });

  it('answers "pata nahi" locally as WRONG with the authored hint — never unclear', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(ask({ whyProbe: probe() }), 'pata nahi');
    expect(completions).toHaveLength(0);
    expect(resolved.path).toBe('local');
    expect(resolved.verdict.verdict).toBe('wrong');
    expect(resolved.verdict.say).toBe('Think about the spaces between the particles.');
  });

  it('escalates "pata nahi" when the ask authored no hint — there is nothing to say', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"wrong","say":"Have a guess.","gave":"question"}';
    const resolved = await resolveSpokenAnswer(
      { question: 'Why?', whyProbe: probe() },
      'pata nahi',
    );
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
  });
});

/**
 * THE READINGS THAT NEED A LIST IN FRONT OF THE STUDENT.
 *
 * `matchSpokenAnswer` was built for the placement test and the quiz, where the
 * options are ON SCREEN. Two of its three readings — the bare letter and the
 * position word — only mean anything there, and both return confidence 1, so
 * MATCH_FLOOR cannot catch them. A whyProbe with `askedAs: 'open'` was never
 * shown, so on those asks a letter or a position has no referent at all and
 * the local read must refuse.
 */
describe('an open ask was never a list, so list-shaped readings must refuse', () => {
  /** Four PROSE options — the shape the planner actually authors. */
  const chambers = (): WhyProbe => ({
    askedAs: 'open',
    options: [
      {
        text: 'four chambers, two atria and two ventricles',
        correct: true,
        why: 'Yes — two atria on top, two ventricles below.',
      },
      { text: 'two chambers, one in and one out', why: 'That is a fish heart, not ours.' },
      { text: 'three chambers like a frog', why: 'A frog has three; a human has four.' },
      { text: 'one chamber that pumps everything', why: 'One chamber could not keep the two circuits apart.' },
    ],
  });
  const heart = (extra: Record<string, unknown> = {}) => ({
    question: 'How many chambers does the human heart have?',
    hint: 'Count the ones on top and the ones below.',
    ...extra,
  });

  it('does NOT read a correct "four" as the fourth option — it escalates', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"right","say":"Two atria, two ventricles."}';
    const resolved = await resolveSpokenAnswer(heart({ whyProbe: chambers() }), 'four');
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
    expect(resolved.verdict.verdict).toBe('right');
  });

  it('escalates a bare letter on an open ask instead of picking that option', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"unclear","say":"Say that once more?"}';
    const resolved = await resolveSpokenAnswer(ask({ whyProbe: probe() }), 'B hoga na');
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
  });

  it('escalates a position word on an open ask — "doosra" names nothing', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"unclear","say":"Say that once more?"}';
    const resolved = await resolveSpokenAnswer(heart({ whyProbe: chambers() }), 'doosra');
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
  });

  it('still reads the WORDS locally on an open ask — that reading has a referent', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(
      heart({ whyProbe: chambers() }),
      'four chambers, two atria and two ventricles',
    );
    expect(completions).toHaveLength(0);
    expect(resolved.path).toBe('local');
    expect(resolved.verdict.verdict).toBe('right');
  });
});

/**
 * A HEDGE IS NOT AN ABSENCE OF AN ANSWER.
 *
 * `matchSpokenAnswer` matches "pata nahi" at the START or the END of an
 * utterance, not only as the whole of it — which is right for the quiz, where
 * "pata nahi B" is a shrug at a letter. On a class ask it means a student who
 * gave a full answer and then hedged it, and reading that as "I don't know"
 * throws away the sentence in front of the hedge and marks a right answer
 * wrong, locally, with nothing behind it.
 */
describe('a hedged answer reaches the model', () => {
  it('escalates a right answer that ends in "pata nahi" rather than filing it wrong', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"right","say":"That is it — the gaps take the sugar."}';
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: probe() }),
      'the water rises because the gaps between the particles fill up, pata nahi',
    );
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
    expect(resolved.verdict.verdict).toBe('right');
  });

  it('escalates "... i am not sure" too, for the same reason', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"right","say":"Yes."}';
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: probe() }),
      'the gaps between the particles fill up i am not sure',
    );
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
  });
});

describe('the safety screen still runs, once, on every path', () => {
  it('stops the turn on a disclosure without asking any model', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: probe() }),
      'i want to kill myself',
    );
    expect(completions).toHaveLength(0);
    expect(resolved.path).toBe('screened');
    expect(resolved.verdict.halt).toBe(true);
    expect(resolved.verdict.verdict).toBe('unclear');
  });

  it('records ONE cleaned flag when a phone number is taken out, not two', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const { flagStore } = await import('../src/stores/flags');
    reply = '{"verdict":"unclear","say":"Say that once more?"}';
    await resolveSpokenAnswer(ask(), 'call me on 9876543210 and I will tell you');
    const cleaned = flagStore.get().flags.filter((f) => f.kind === 'cleaned');
    expect(cleaned).toHaveLength(1);
  });

  it('never hands a caller the raw transcript — only the screened copy', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: probe() }),
      'the sugar melted into the water, call 9876543210',
    );
    expect(resolved.verdict.heard ?? '').not.toContain('9876543210');
  });
});
