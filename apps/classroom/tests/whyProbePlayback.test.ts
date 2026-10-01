import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * NO PROJECT, NO SIGN-IN, NO NETWORK.
 *
 * `relay.ts` asks `supabase()` for a session and, finding none, signs the
 * device in anonymously — against the REAL project, because the repo's
 * `.env.local` sets `VITE_SUPABASE_URL` and vitest loads it. The tests below
 * drive the real `relayFetch`, so without this they would mint anonymous auth
 * users on a live project every run. Null is the app's own local-only path:
 * `accessToken` returns null and no Authorization header is attached.
 */
vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));

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
  it('says which probe option it matched, so decide() can ask that option’s follow-up (second review)', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(ask({ whyProbe: probe() }), 'the sugar melted into the water');
    expect(resolved.path).toBe('local');
    expect(resolved.matched).toBe(1);
  });

  it('names no match when the child was shown a different list than the probe', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: probe(), options: [{ text: 'something else', correct: true }, { text: 'and another' }] }),
      'the sugar melted into the water',
    );
    expect(resolved.matched).toBeUndefined();
  });

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
      { listShown: true },
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
      { listShown: true },
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
      { listShown: true },
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
      { listShown: true },
    );
    expect(completions).toHaveLength(0);
    expect(resolved.path).toBe('local');
  });

  /**
   * THE CLASS SHOWS NO LIST AT ALL (Aarav, 2026-10-01): no question and no
   * options on screen. An options probe with a mirrored `ask.options` is then
   * still a student looking at nothing, so a letter names nothing — unless the
   * caller says a list really was shown.
   */
  it('reads no letter on an options probe when no list is shown, which is the default', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"unclear","say":"Say that once more?"}';
    const shown = probe();
    shown.askedAs = 'options';
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: shown, options: shown.options.map((o) => ({ text: o.text })) }),
      'B hoga na',
    );
    expect(resolved.path).toBe('model');
    expect(completions).toHaveLength(1);
  });

  it('still names the option the words matched when the two lists are the same, shown or not', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const shown = probe();
    shown.askedAs = 'options';
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: shown, options: shown.options.map((o) => ({ text: o.text })) }),
      'the sugar melted into the water',
    );
    expect(resolved.path).toBe('local');
    expect(resolved.matched).toBe(1);
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

  // It used to escalate here, "nothing to say" — and the model could call it
  // 'unclear', so the ladder never climbed (fifth review). Her fixed line.
  it('answers "pata nahi" locally as WRONG when the ask authored no hint', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const { LINES } = await import('@ai-tutor/tutor-control');
    const resolved = await resolveSpokenAnswer(
      { question: 'Why?', whyProbe: probe() },
      'pata nahi',
    );
    expect(resolved.path).toBe('local');
    expect(completions).toHaveLength(0);
    expect(resolved.verdict.verdict).toBe('wrong');
    expect(LINES.haveAGo.en).toContain(resolved.verdict.say);
    // Asking for a first step is neither a leading question nor the hint.
    expect(resolved.verdict.gave).toBeUndefined();
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
 * "pata nahi" beside anything more is a student who gave an answer and then
 * hedged it, and reading that as "I don't know" throws away the answer in
 * front of the hedge and marks a right answer wrong, locally, with nothing
 * behind it. Only the shrug ALONE is settled on the device (`dontKnowIn`);
 * everything that carries one goes to the model.
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

  /**
   * FIFTH REVIEW. A SHORT right answer with a shrug beside it fitted under the
   * old four-word limit, so "Plasma, I don't know" was filed WRONG on the
   * device — the hint said, the ladder climbed, and no model ever heard it.
   */
  const food = (): WhyProbe => ({
    askedAs: 'open',
    options: [
      { text: 'Plasma', correct: true, why: 'Yes — plasma is the liquid that carries it.' },
      { text: 'Red blood cells', why: 'Red cells carry oxygen, not food.', hint: 'Which part is liquid?' },
    ],
  });
  const carries = () => ({
    question: 'Which part of the blood carries digested food?',
    hint: 'Think about the liquid part.',
    whyProbe: food(),
  });

  it('never files a short right answer with a shrug beside it as "I don\'t know"', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    for (const said of ["Plasma, I don't know", "I don't know, plasma?", "Plasma? I can't say", 'Nahi samjha, plasma?']) {
      completions.length = 0;
      reply = '{"verdict":"right","say":"And why the liquid part?"}';
      const resolved = await resolveSpokenAnswer(carries(), said);
      expect(resolved.reading, said).not.toBe('dont-know');
      expect(resolved.verdict.verdict, said).toBe('right');
      expect(resolved.path, said).toBe('model');
    }
  });

  it('leaves a sentence about not understanding to be judged as an answer', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    for (const said of ["They don't understand", 'Usne samjha nahi']) {
      completions.length = 0;
      reply = '{"verdict":"right","say":"Why would that make them quiet?"}';
      const resolved = await resolveSpokenAnswer({ question: 'Why is Ravi quiet in class?', hint: 'Look at his face.' }, said);
      expect(resolved.path, said).toBe('model');
      expect(resolved.verdict.verdict, said).toBe('right');
    }
  });
});

/**
 * "I DON'T KNOW", ALONE, IS SETTLED ON THE DEVICE — HOWEVER IT IS SAID, AND
 * ON EVERY ASK.
 *
 * The pedagogy is explicit that it is WRONG and never unclear, so the ladder
 * climbs. Sent to the model it could come back 'unclear' and the ladder did not
 * move; and the local read used to run only on an ask with a whyProbe AND a
 * hint, and only up to four words.
 */
describe('a shrug and nothing else', () => {
  it('is wrong on the device however much filler it is wrapped in', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    for (const said of ['mujhe samajh nahi aa raha', 'I did not understand sir', 'samajh mein nahi aaya', 'nahi samajh aaya', 'hmm pata nahi yaar']) {
      const resolved = await resolveSpokenAnswer(ask({ whyProbe: probe() }), said);
      expect(resolved.path, said).toBe('local');
      expect(resolved.reading, said).toBe('dont-know');
      expect(resolved.verdict.verdict, said).toBe('wrong');
      expect(resolved.verdict.say, said).toBe('Think about the spaces between the particles.');
    }
    expect(completions).toHaveLength(0);
  });

  it('is wrong on the device on an ask with no whyProbe and no hint', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"unclear","say":"Say that once more?"}';
    for (const said of ['nahi samjha', 'pata nahi', "I don't understand"]) {
      const resolved = await resolveSpokenAnswer({ question: 'Why does the level barely move?' }, said);
      expect(resolved.path, said).toBe('local');
      expect(resolved.reading, said).toBe('dont-know');
      expect(resolved.verdict.verdict, said).toBe('wrong');
      expect(resolved.verdict.say, said).not.toBe('');
      expect(resolved.verdict.heard, said).toBe(said);
    }
    expect(completions).toHaveLength(0);
  });

  it('says the ask’s own hint when it has one, whyProbe or not', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    const resolved = await resolveSpokenAnswer(ask(), 'nahi samjha');
    expect(completions).toHaveLength(0);
    expect(resolved.verdict).toMatchObject({ verdict: 'wrong', say: 'Think about the spaces between the particles.', gave: 'hint' });
  });

  it('goes to the model when "can’t say" is itself one of the answers on screen', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"right","say":"Why can we not say?"}';
    const resolved = await resolveSpokenAnswer(
      { question: 'Will it rain on this day next year?', hint: 'Can anyone know that?', options: [{ text: 'Yes' }, { text: 'No' }, { text: "Can't say", correct: true }] },
      "can't say",
    );
    expect(resolved.path).toBe('model');
    expect(resolved.verdict.verdict).toBe('right');
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

/**
 * ==========================================================================
 * THE ESCALATED JUDGE IS NO LONGER BLIND TO WHAT THE PLANNER AUTHORED.
 * ==========================================================================
 *
 * The saving the rest of this file measures comes from NOT calling the model.
 * This is the other half: what the model is told on the calls that do happen.
 * Wave 3 refused the two ordinal readings on an open ask, so escalation is now
 * the outcome for most spoken answers that are not close to verbatim — and
 * until `SpokenAsk` carried the probe, the one call anybody pays for was the
 * one that had not been shown the named misconceptions the planner wrote down.
 */
describe('what the model is told when the local read refuses', () => {
  it('carries the authored misconceptions and her written replies into the prompt', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"wrong","say":"Was anything heated?","gave":"hint"}';
    const resolved = await resolveSpokenAnswer(
      ask({ whyProbe: probe() }),
      'something about water and sugar and particles maybe',
    );
    expect(resolved.path).toBe('model');
    const { user } = completions[0];
    // The distractor as a student who holds it would say it, and the reply she
    // already has written for it.
    expect(user).toContain('the sugar melted into the water');
    expect(user).toContain('Melting needs heat. This is dissolving, which is a different thing.');
  });

  it('tells it they are ears and not a menu, on the real escalation path', async () => {
    const { resolveSpokenAnswer } = await import('../src/lib/judge');
    reply = '{"verdict":"unclear","say":"Say that once more?"}';
    await resolveSpokenAnswer(ask({ whyProbe: probe() }), 'erm the thing with the water');
    const { user } = completions[0];
    expect(user).toMatch(/never offer them as a list/i);
    expect(user).not.toMatch(/^[A-D]\. /m);
  });
});

/**
 * ==========================================================================
 * A REFUSAL KEEPS THE ONE BIT THAT SAYS WHOSE FAULT IT IS.
 * ==========================================================================
 *
 * These belong to lib/relay.ts rather than to the judge, and they are here
 * because this is the only classroom test file this phase owns. Recorded as a
 * handoff: they want to live in tests/relay.test.ts beside the other
 * `relayError` cases.
 *
 * gate.ts:198 words five refusals for a child and the care is in the
 * DISTINCTION: 429 is the student's own rate or budget and says so, 503 is our
 * capacity or our outage and its wording deliberately does not hand a child a
 * fault they do not have. `relayError` kept the sentence and dropped the
 * status, the machine-readable `reason` and the Retry-After header — so
 * lib/refusal.ts had to recover all of it by comparing the sentence, character
 * for character, to a copy of gate.ts's prose.
 *
 * TWO OF THE THREE SURVIVE NOW. Retry-After does not, and refusal.ts still
 * reads the prose: teaching it to read `reason` needs that file and the catch
 * at screens/LiveClass.tsx that keeps only `e.message`, neither of which this
 * phase owns. Both are handoffs, and the guard below is what keeps the prose
 * coupling loud until they land.
 */
describe('a thrown relay refusal carries its status and its reason', () => {
  const budget = {
    error: { message: 'You have used up today\u2019s classes. This resets tomorrow.', reason: 'budget' },
  };
  const capped = {
    error: { message: 'Qrie has taught a lot of classes today. Please come back tomorrow.', reason: 'capped' },
  };

  it('keeps the student sentence EXACTLY as it was, for every caller that shows it', async () => {
    const relay = await import('../src/lib/relay');
    // The whole point of the 429/503 branch: a sentence somebody can respond to
    // must not be turned back into a status code. Every existing `catch` that
    // renders `error.message` must still render this.
    expect(relay.relayError(429, budget).message).toBe(budget.error.message);
    expect(relay.relayError(503, capped).message).toBe(capped.error.message);
    expect(relay.relayError(500, { error: { message: 'boom' } }).message).toBe('relay 500: boom');
    expect(relay.relayError(404, null).message).toBe('relay 404');
  });

  it('carries the status, which is the whole 429-versus-503 distinction', async () => {
    const relay = await import('../src/lib/relay');
    expect(relay.relayError(429, budget).status).toBe(429);
    expect(relay.relayError(503, capped).status).toBe(503);
    expect(relay.relayError(500, null).status).toBe(500);
  });

  it('carries the relay own reason, so nobody has to read prose to find it', async () => {
    const relay = await import('../src/lib/relay');
    expect(relay.relayError(429, budget).reason).toBe('budget');
    expect(relay.relayError(503, capped).reason).toBe('capped');
  });

  it('drops a reason that is not a string, because a body is still input', async () => {
    const relay = await import('../src/lib/relay');
    const odd = { error: { message: 'no', reason: { drop: 'table' } } } as unknown as {
      error?: { message?: string; reason?: string };
    };
    expect(relay.relayError(429, odd).reason).toBeUndefined();
  });

  it('is recognisable as a relay failure without guessing from the message', async () => {
    const relay = await import('../src/lib/relay');
    expect(relay.isRelayFailure(relay.relayError(503, capped))).toBe(true);
    expect(relay.isRelayFailure(new Error('the network went away'))).toBe(false);
    expect(relay.isRelayFailure('a string somebody kept in state')).toBe(false);
  });

  /**
   * AND NOT ANY ERROR THAT HAPPENS TO CARRY A NUMBER.
   *
   * The predicate promises `RelayFailure` — that `message` is a sentence the
   * relay wrote, which for a 429 or a 503 is a sentence written for a CHILD. A
   * Supabase error or a third-party client with its own `status` would satisfy
   * a structural check and hand a screen an internal string to read out.
   */
  it('does not mistake somebody else error for a relay refusal', async () => {
    const relay = await import('../src/lib/relay');
    const impostor = Object.assign(new Error('PGRST116: no rows'), { status: 406 });
    expect(relay.isRelayFailure(impostor)).toBe(false);
  });
});

/**
 * THE EVIDENCE HAS TO SURVIVE THE REAL PATH, NOT ONLY THE CONSTRUCTOR.
 *
 * `relayError` is called from exactly two places, and both hand it the parsed
 * body (browserLlm.ts and browserImage.ts). That body was typed without
 * `reason`, so the field arrived only by the accident that the whole parsed
 * object is passed through — tighten the cast, or rebuild the object, and Job 2
 * dies with every direct-call assertion above still passing. JOB 3 was held to
 * "assert ARRIVAL, not sending"; this is the same standard on this path.
 */
describe('a refusal thrown by the adapter a student actually uses', () => {
  const budget = {
    error: { message: 'You have used up today’s classes. This resets tomorrow.', reason: 'budget' },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carries the status and the reason out of /api/llm itself', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 429,
      json: async () => budget,
    }) as unknown as Response);
    const { createBrowserLlm } = await vi.importActual<typeof import('../src/lib/browserLlm')>(
      '../src/lib/browserLlm',
    );
    const relay = await import('../src/lib/relay');

    const thrown = await createBrowserLlm('m', { json: true })
      .complete('s', 'u')
      .then(() => null)
      .catch((e: unknown) => e);

    expect(relay.isRelayFailure(thrown)).toBe(true);
    const failure = thrown as import('../src/lib/relay').RelayFailure;
    // The sentence a screen shows is unchanged; the evidence beside it is new.
    expect(failure.message).toBe(budget.error.message);
    expect(failure.status).toBe(429);
    expect(failure.reason).toBe('budget');
  });
});

/**
 * THE COUPLING THAT IS STILL THERE, ASSERTED OUT LOUD.
 *
 * `lib/refusal.ts` still recognises a refusal by its SENTENCE — this phase
 * could not edit that file, so the string comparison stands and the handoff is
 * recorded. A silent coupling between two packages is worse than a loud one, so
 * the test below reads gate.ts's own source at test time and a rename breaks a
 * test here rather than a child's screen in production. The SENTENCES half of
 * that guard is not new and is not here: `tests/refusal.test.ts` has read the
 * same block since Wave 4A. What follows is the half nothing asserted — that
 * the five reason NAMES agree, which is what `relayError` now carries instead
 * of the prose, and which is what the handoff asks refusal.ts to read.
 */
describe('the client and gate.ts, held together on purpose', () => {
  /** gate.ts's REFUSALS block, read out of the relay's own source. */
  const refusalsBlock = (): string => {
    const at = path.join(process.cwd(), 'packages/relay/src/gate.ts');
    expect(existsSync(at), 'run vitest from the repo root').toBe(true);
    const source = readFileSync(at, 'utf8');
    const from = source.indexOf('const REFUSALS');
    expect(from).toBeGreaterThan(-1);
    return source.slice(from, source.indexOf('\n};', from));
  };

  /**
   * THE NAMES, which is what `relayError` now carries instead of the prose.
   * The reader's `RefusalReason` union and gate.ts's `REFUSALS` keys have to be
   * the same five words, or the day refusal.ts starts reading `reason` it will
   * read one it does not know and hand a child the generic frame again.
   */
  it('agrees with gate.ts about the five NAMES, not only the five sentences', async () => {
    const { readRefusal } = await import('../src/lib/refusal');
    const block = refusalsBlock();
    const names = [...block.matchAll(/^ {2}([a-z]+): \{$/gm)].map((m) => m[1]);
    expect([...names].sort()).toEqual(['budget', 'capped', 'halted', 'rate', 'unavailable']);
    const sentences = [...block.matchAll(/message:\s*'([^']*)'/g)].map((m) => m[1]);
    // Same order in the same block: each sentence's reason is the key above it.
    names.forEach((name, i) => {
      expect(readRefusal(new Error(sentences[i]))?.reason, name).toBe(name);
    });
  });
});

/**
 * ==========================================================================
 * THE SPEND KNOWS WHICH PREPARATION IT PAID FOR.
 * ==========================================================================
 *
 * `usage_event.prep_id` exists (poured by 0018, written from 0019's
 * `record_usage`) and the relay validates-or-drops an
 * `x-prep-id` header (handler.ts:373). The pre-warm CLI sends it. The browser
 * stamped it only on /api/prep/lock, /renew and /release — which are metered at
 * ZERO units. The rupees are on /api/llm, and that path sent nothing, so a
 * student's own preparation spend was unattributed.
 *
 * THE RELAY DROPS A MALFORMED ID RATHER THAN FAILING THE CALL, so a bug here is
 * silent: asserting that a header was SENT would pass for an id the cost books
 * then throw away. The test below therefore takes the headers the browser
 * actually produced and feeds them to the real `handleRelay`, and asserts on
 * what lands in the usage row.
 */
describe('a preparation attributing its own spend', () => {
  const PREP = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  /** Every fetch the app made, headers and all. */
  const sent: { url: string; init: RequestInit }[] = [];

  const llmBody = JSON.stringify({ choices: [{ message: { content: '{}' } }] });

  beforeEach(() => {
    sent.length = 0;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => JSON.parse(llmBody) } as unknown as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The real adapter, not this file's counting stub. */
  const realLlm = async () =>
    (await vi.importActual<typeof import('../src/lib/browserLlm')>('../src/lib/browserLlm'))
      .createBrowserLlm;

  const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

  it('sends nothing at all when no preparation is running', async () => {
    const createBrowserLlm = await realLlm();
    await createBrowserLlm('m', { json: true }).complete('s', 'u');
    expect(headerOf(sent[0].init, 'x-prep-id')).toBeNull();
  });

  it('stamps the LLM call — where the rupees are — while a preparation runs', async () => {
    const relay = await import('../src/lib/relay');
    const createBrowserLlm = await realLlm();
    await relay.duringPreparation(PREP, async () => {
      await createBrowserLlm('m', { json: true }).complete('s', 'u');
    });
    expect(headerOf(sent[0].init, 'x-prep-id')).toBe(PREP);
  });

  it('stops stamping the moment the preparation is over, so playback is not billed to it', async () => {
    const relay = await import('../src/lib/relay');
    const createBrowserLlm = await realLlm();
    await relay.duringPreparation(PREP, async () => {});
    await createBrowserLlm('m', {}).complete('s', 'u');
    expect(headerOf(sent[0].init, 'x-prep-id')).toBeNull();
  });

  /**
   * A STUDENT WHO LEAVES TAKES THEIR PREPARATION WITH THEM.
   *
   * `forgetTicket` runs on sign-out and clears the scope — on a shared phone
   * the next student is a different person on the same tab. A scope still
   * unwinding would then RESTORE what it saved, and if that was an outer
   * preparation the departed student was inside, every call the next student
   * makes carries their prep id. The relay drops only a MALFORMED id and this
   * one is well-formed and wrong, so the cost books would be quietly wrong
   * about the one number they exist to measure.
   */
  it('does not hand a departed student preparation to whoever is next', async () => {
    const relay = await import('../src/lib/relay');
    const createBrowserLlm = await realLlm();
    const inner = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

    await relay.duringPreparation(PREP, async () => {
      await relay.duringPreparation(inner, async () => {
        // Sign-out, mid-preparation. Everything of theirs goes.
        relay.forgetTicket();
      });
      // The inner scope has just unwound and must NOT have put the outer
      // preparation back, because the student it belonged to has gone.
      expect(relay.currentPrepId()).toBeNull();
      await createBrowserLlm('m', {}).complete('s', 'u');
    });

    expect(headerOf(sent[0].init, 'x-prep-id')).toBeNull();
  });

  it('lets a caller name the preparation on one adapter, which wins', async () => {
    const other = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const relay = await import('../src/lib/relay');
    const createBrowserLlm = await realLlm();
    await relay.duringPreparation(PREP, async () => {
      await createBrowserLlm('m', { prepId: other }).complete('s', 'u');
    });
    expect(headerOf(sent[0].init, 'x-prep-id')).toBe(other);
  });

  /**
   * IT ARRIVES. Not "a header was set" — the real relay handler, with the real
   * uuid validation in front of it, writing the real usage row.
   */
  it('ARRIVES in the usage row, through the relay own validation', async () => {
    const { handleRelay } = await import('../../../packages/relay/src/handler');
    const { createMemoryUsage } = await import('../../../packages/relay/src/usage');
    const relay = await import('../src/lib/relay');
    const createBrowserLlm = await realLlm();

    await relay.duringPreparation(PREP, async () => {
      await createBrowserLlm('m', { json: true }).complete('s', 'u');
    });

    const headers: Record<string, string> = {};
    new Headers(sent[0].init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    // The bearer is supplied here because this test has no Supabase project to
    // mint one from; everything else is the browser's own. The prep id is not.
    headers.authorization = 'Bearer good-token';

    const usage = createMemoryUsage();
    await handleRelay(
      { method: 'POST', url: '/api/llm', headers, body: new TextEncoder().encode('{"model":"m"}') },
      {
        key: 'sk-test',
        gate: {
          verify: async () => ({ ok: true, user: { userId: '11111111-2222-3333-4444-555555555555' } }),
          ledger: { async claim() { return { allowed: true }; } },
        },
        usage,
        transcribe: async () => {
          throw new Error('not this test');
        },
      },
    );

    expect(usage.events).toHaveLength(1);
    expect(usage.events[0].prepId).toBe(PREP);
  });

  /**
   * WHY THE TEST ABOVE HAD TO GO ALL THE WAY THROUGH. A malformed id is dropped
   * by the relay and the call succeeds, so the failure mode is a usage row with
   * no attribution and nothing anywhere saying so.
   */
  it('shows what a malformed id costs: nothing loud, and the attribution', async () => {
    const { handleRelay } = await import('../../../packages/relay/src/handler');
    const { createMemoryUsage } = await import('../../../packages/relay/src/usage');
    const usage = createMemoryUsage();
    await handleRelay(
      {
        method: 'POST',
        url: '/api/llm',
        headers: { authorization: 'Bearer good-token', 'x-prep-id': 'prep-7' },
        body: new TextEncoder().encode('{"model":"m"}'),
      },
      {
        key: 'sk-test',
        gate: {
          verify: async () => ({ ok: true, user: { userId: '11111111-2222-3333-4444-555555555555' } }),
          ledger: { async claim() { return { allowed: true }; } },
        },
        usage,
        transcribe: async () => {
          throw new Error('not this test');
        },
      },
    );
    expect(usage.events[0].prepId).toBeNull();
  });
});
