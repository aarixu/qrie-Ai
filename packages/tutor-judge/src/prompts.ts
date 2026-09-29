import { TUTOR, isTutorLanguage, registerLine, type TutorLanguage } from '@ai-tutor/persona';
import type { AuthoredProbe, SpokenAsk } from './types.ts';

/**
 * THE PEDAGOGY, AS TEXT.
 *
 * Every rule here is a teaching decision rather than a formatting one, which is
 * why they are worth testing rather than merely reading:
 *
 *   - NEVER "correct", never congratulation. Praise ends the thinking.
 *   - A RIGHT answer is not the exit. She asks one why/how/when about their own
 *     answer and STOPS — the reason is earned by thinking one step further,
 *     not handed over for being right.
 *   - A WRONG answer never gets the answer. One leading question, or the
 *     planner's own hint.
 *   - "I don't know" is WRONG, not unclear. Unclear is reserved for words that
 *     do not address the question at all, because unclear records no evidence
 *     and a student who does not know has told us something real.
 *
 * AND SHE SOUNDS LIKE A PERSON, NOT A MODEL (Aarav, 2026-09-29: a warm,
 * proactive human tutor for a Class 6-10 child). Three rules carry that:
 *
 *   - ONE OR TWO SHORT SENTENCES, on the judge and the close alike. The close
 *     allowed three, and three is where a reply turns into a paragraph.
 *   - ASK BEFORE YOU TELL, and hand their own words back when you do. It is
 *     the same move the verdict rules below already make on every branch —
 *     a cross-question on a right answer, a question or the hint on a wrong
 *     one, "say it again" on an unclear one — said once as the default so a
 *     reply that falls between the rules still falls on the asking side.
 *   - NO STOCK PRAISE, by name. "Never congratulate" was already the rule, and
 *     "Great job!" is the congratulation a model reaches for without noticing
 *     it is one.
 *
 * THE LANGUAGE SHE SPEAKS IS THE CHILD'S CHOICE, never the language they
 * happened to answer in. Both prompts take the student's `TutorLanguage` and
 * render persona's one register line for it (packages/persona/src/language.ts),
 * the same line the live doubt tutor carries, so the class and the replies
 * around it are one voice. The close used to say "meet them in kind", which
 * moved an English child who reasoned in Hindi into Hindi and a Hinglish child
 * who reasoned in English into English — overriding, one answer at a time, a
 * choice they made once at onboarding. How she READS is unchanged: the idea is
 * judged, not the wording and not the language.
 *
 * A language that is absent, or not one of the two the app stores, renders no
 * line: unknown says nothing, persona's rule for every signal. The one caller
 * in the app always has one (apps/classroom/src/lib/judge.ts passes the
 * workspace's `tutorLanguage()`); the measurement tools in tools/measure call
 * these with none and get the prompt without a register line.
 *
 * WHAT IT COSTS. MEASURED on 2026-09-29 by rendering the committed prompts and
 * these side by side: the register line is 175 characters for 'en' and 173 for
 * 'hi-en'. JUDGE_SYSTEM went from 1,235 characters to 1,688 with the English
 * line (1,510 with none), and CLOSE_SYSTEM from 831 to 1,147 (969 with none).
 * DERIVED at four characters to the token, gemini-3.7-flash's $0.75/1M prompt
 * price and Rs 95.6 to the dollar: about Rs 0.008 more on every judge call and
 * Rs 0.006 on every close. Both ceilings are asserted in tests/judge.test.ts,
 * so growing either prompt is a decision somebody makes on purpose.
 *
 * WHETHER THE MODEL OBEYS THE LINE IS UNVERIFIED. The plan's bar (a 30-item
 * labelled set: ≥ 90% Hinglish replies to Hinglish students, ≥ 95% English
 * replies to English students) has not been run.
 */

/**
 * The register line as a prompt bullet, or nothing.
 *
 * Checked at runtime as well as by type, because the value arrives from a
 * profile row that round-trips through the cloud: a language the app does not
 * speak must not become an instruction to speak it.
 */
const speaks = (language: TutorLanguage | undefined): string[] =>
  isTutorLanguage(language) ? [`- ${registerLine(language)}`] : [];

export const JUDGE_SYSTEM = (language?: TutorLanguage): string =>
  [
    `You are ${TUTOR.name}, an Indian tutor teaching a live class. The class is holding on one question and the student just answered OUT LOUD. Judge their spoken words.`,
    `Reply with ONE JSON object, nothing else: {"verdict":"right"|"wrong"|"unclear","say":"...","gave":"question"|"hint"}`,
    `- Students answer in English, Hindi or a mix, in their own words or by letter ("B", "option B"). Judge the IDEA, not the wording or the language.`,
    `- "say" is SPOKEN aloud to them next: 1-2 short, warm, natural sentences, the way a real tutor talks to one child across a desk. Plain text, no markdown.`,
    ...speaks(language),
    `- Ask before you tell: hand their own words back to them and let a question do the teaching.`,
    `- NEVER say "correct" or congratulate, and never "Great job!", "Well done!" or any other stock praise - warmth is in how closely you listened, not in a compliment.`,
    `- right: acknowledge their words in one short clause, then ask ONE cross-question about their own answer - a why, a how, or a when - and STOP THERE. Do not give the reason yet; they earn it by thinking one step further.`,
    `- wrong: never reveal the answer. Ask ONE why/how/when question, or give the hint, that makes them think again. "I don't know" is wrong, not unclear.`,
    `- "gave" says which of those two you just did: "question" for a leading question, "hint" for the hint itself. It is recorded, never spoken. Omit it unless the verdict is wrong.`,
    `- unclear: the words do not answer the question at all (noise, off-topic, cut off). Ask them to say it once more in their own words.`,
  ].join('\n');

export const CLOSE_SYSTEM = (language?: TutorLanguage): string =>
  [
    `You are ${TUTOR.name}, an Indian tutor teaching a live class. The student answered a question RIGHT, you asked one cross-question about their answer, and they have just reasoned out loud. Close the loop.`,
    `Reply with ONE JSON object, nothing else: {"say":"...","held":true|false}`,
    `- "say" is SPOKEN aloud: 1-2 short, warm, natural sentences, the way a real tutor talks to one child across a desk. Plain text. They may reason in English, Hindi or a mix - weigh the idea, not the language.`,
    ...speaks(language),
    `- If their reasoning holds, name what it proves in your own words, then give the full why in one line.`,
    `- If it wobbles, or they said nothing, give the why yourself, warmly - no scolding, never the word "wrong".`,
    `- "held" says which of those two you just did: true if their reasoning stood up, false if it wobbled or they said nothing. It is recorded, never spoken.`,
    `- NEVER say "correct" or congratulate, and never "Great job!", "Well done!" or any other stock praise. The reason is the lesson.`,
  ].join('\n');

/**
 * THE AUTHORED JUDGEMENT, WRITTEN FOR EARS RATHER THAN AS A MENU.
 *
 * A whyProbe holds the right answer, the named misconceptions as a student who
 * holds one would SAY it, and the reply she gives for each. It is the most
 * useful thing anybody knows about this ask, and the escalated model call - the
 * only call in the loop that costs money - was the one thing that had not been
 * told about it.
 *
 * THREE DECISIONS IN HOW IT IS RENDERED, and none is cosmetic.
 *
 * 1. NOT AS A LIST, AND NOT LETTERED. The pedagogy is explicit that a student
 *    picking from a list is recognising rather than thinking (lesson-format
 *    types.ts:41), and on an open ask the student was shown none of this. A
 *    lettered A/B/C block in the prompt reads exactly like `ask.options` above,
 *    which IS a list on screen - so it would sit one paraphrase away from being
 *    read out to a child who was asked an open question. They are framed as
 *    what a right answer should contain and what the known wrong turns are, and
 *    the prompt says in so many words that they are the judge's ears.
 * 2. THE AUTHORED WORDS ARE HERS AND ALREADY WRITTEN. The local path speaks
 *    `why` verbatim (apps/classroom/src/lib/judge.ts), so a model that treated
 *    it as a hint to paraphrase would answer one misconception two different
 *    ways depending on which path resolved the answer - a difference invisible
 *    to everybody except the child who hears both.
 * 3. IT SAYS HOW TO READ AS WELL AS HOW TO SPEAK. `JUDGE_SYSTEM` tells the
 *    model students may answer "in their own words or by letter", which is true
 *    of a chip list on screen and a lie on an open ask. That clause was
 *    harmless here while the user message carried no list for a letter to index
 *    - and this block IS a list, ordered, with the correct option first.
 *    apps/classroom refuses a letter or a position locally on an open ask and
 *    ESCALATES it (its `sawAList` guard), so the child who says "B" arrives at
 *    exactly this prompt. Everything in point 1 constrains what she SAYS; the
 *    reading rule in the header is the one sentence that constrains how she
 *    READS, and without it Wave 3's refusal was handed straight back on the
 *    paid path.
 *
 * AND EVERY AUTHORED LINE IS BOUND TO A TURN, NOT TO A VERDICT.
 * `JUDGE_SYSTEM` says acknowledge, ask ONE cross-question, stop, "Do not give
 * the reason yet" - and the correct option's `why` IS that reason. Handing it
 * over unlabelled would let the probe quietly repeal the rule the whole
 * cross-question exists to enforce. But this same description also feeds
 * `resolveCrossQuestion`, whose whole job is "the full why in one line" - so a
 * flat "do not give it on a right answer" would be an instruction the close has
 * to be rescued from. Naming the TURN says both things at once and contradicts
 * neither prompt.
 *
 * The same rule decides the wrong turns: `hint ?? why` is one move, it is the
 * move the tap path makes, and it is what `JUDGE_SYSTEM` allows a wrong answer.
 */
function describeProbe(probe: AuthoredProbe | undefined): string | null {
  const options = probe?.options ?? [];
  if (options.length === 0) return null;

  const right = options.find((o) => o.correct === true);
  const wrong = options.filter((o) => o !== right);

  /**
   * THE SCAFFOLDING IS SAID ONCE, because it is billed on every escalated call.
   *
   * WHAT IT COSTS, IN THREE TERMS - two of ours and the planner's. MEASURED by
   * rendering probes whose options are one character long, so what is left is
   * only what this function added:
   *
   *   688  the header plus the right answer's own turn
   *   165  the wrong-turns section header and the first wrong turn
   *    91  every wrong turn after that
   *
   * So a four-option probe - one right, three wrong, which is the largest shape
   * class-prep asks for - is 688 + 165 + 91x2 = 1,035 characters of framing,
   * and that figure reproduces exactly. On top of it sits the planner's own
   * text, which is as long as the planner made it. All three are asserted in
   * tests/judge.test.ts.
   *
   * AN EARLIER VERSION SAID 533 PLUS 91, AND 533 WAS A REAL MEASUREMENT OF AN
   * UNREAL PROBE. It came from a single option carrying `text` and nothing
   * else, and packages/class-prep REQUIRES every probe option to carry a `why`
   * - the `Her reason:` turn instruction that adds is 155 characters on its
   * own. 533 + 91n underbilled every actual probe by between 138 and 229
   * characters, and it was the ceiling somebody would have budgeted against.
   *
   * SO THE REAL BILL IS A RANGE, and the fixture is the bottom of it. The
   * three-option probe in the tests adds 1,151 characters (263 of them the
   * planner's) - ~288 prompt tokens, Rs 0.0206 a call at gemini-3.7-flash's
   * $0.75/1M and Rs 95.6 to the dollar. A FOUR-option probe written to the
   * length class-prep asks for (packages/class-prep/src/prompts.ts) adds 1,654
   * - ~414 tokens, Rs 0.0296 a call, and Rs 0.237 across the eight judge-side
   * calls the measured class makes, against that class's measured judge bill of
   * Rs 1.13. Quote the four-option figure: 2-4 options is what the planner is
   * asked for, so the larger shape is ordinary rather than exceptional.
   *
   * WHAT WAS SPENT BACK. The first draft said "already written, in her words"
   * on every quoted line and repeated the whole instruction underneath the
   * list: 239 characters more, to say the same two things three times. Stated
   * once at the top it binds every quoted line below it just as well.
   *
   * WHAT WAS SPENT SINCE, ON PURPOSE: the reading rule in the header, and the
   * turn the right answer's reason belongs to. An earlier version of this line
   * billed them at "100 characters" and "19" — figures nobody can check,
   * because they are deltas against a draft that was never committed and no
   * stash holds. A number that cannot be re-measured is not a measurement, so
   * the standing cost is quoted above instead, where a test pins it.
   */
  const lines = [
    'WHAT THE TUTOR ALREADY WORKED OUT ABOUT THIS ANSWER - your ears, not their choices. The student was shown none of it: no letters and no order, nothing on screen, so a bare letter or "the second one" names nothing here - judge only the idea in their own words. Never read these out, never offer them as a list, and never ask them to pick one. Every quoted line below is already written, in her words: speak it as it stands, do not paraphrase it and do not write one of your own.',
  ];
  if (right) {
    lines.push(`A right answer amounts to this, however they word it: ${right.text}`);
    if (right.why) {
      lines.push(
        `  Her reason: "${right.why}" Not on the turn you judge their answer - she asks her one cross-question first; this is the line she closes with once they have reasoned.`,
      );
    }
  }
  if (wrong.length > 0) {
    lines.push('The wrong turns she expects, each as a student who holds it would say it:');
    for (const o of wrong) {
      const said = [`  ${o.text}`];
      // ONE MOVE PER TURN, AND THE SAME ONE THE TAP PATH MAKES: `hint ?? why`.
      // `readLocally` speaks exactly one of these on a match
      // (apps/classroom/src/lib/judge.ts), so the wording here follows it
      // rather than inventing a second order. With a hint authored, the hint IS
      // this turn and the `why` is the correction that comes after another try
      // - "her nudge first, then her reply" read as two halves of ONE turn, and
      // a wrong answer handed the nudge and the answer together is the rule
      // `JUDGE_SYSTEM` spends a line on. With no hint authored, the `why` is
      // the only thing she has and the tap path speaks it immediately, so
      // telling the model to hold it back would answer one misconception two
      // different ways depending on which path resolved it.
      if (o.hint) {
        said.push(`    Her nudge for this turn: "${o.hint}"`);
        if (o.why) said.push(`    Her reply for later, once they have tried again: "${o.why}"`);
      } else if (o.why) {
        said.push(`    Her reply for this turn: "${o.why}"`);
      }
      lines.push(said.join('\n'));
    }
  }
  return lines.join('\n');
}

/**
 * The held question, as the model sees it.
 *
 * The planner's own `why` and `hint` per option are passed through, because the
 * judge's leading question should build on what the lesson already decided to
 * say rather than inventing a second pedagogy at runtime.
 *
 * THE PROBE IS DESCRIBED ONLY WHEN NOTHING IS ON SCREEN, which is the case it
 * was added for and the overwhelmingly common one ('open' is the rule, and
 * class-prep asks the planner for it on every normal ask). When `ask.options`
 * ARE shown they are lettered above with the same `why` and `hint` vocabulary,
 * and a second unlettered copy of the same material would cost tokens and
 * invite the model to believe there are more options than the child can see.
 * Said plainly, because it is a real limit: on a shown-options ask whose probe
 * does NOT mirror the shown list - one of the cases apps/classroom's `sawAList`
 * guard escalates - the probe's own wording is not sent, and the lettered list the
 * child actually saw is what the judge is given.
 */
export function describeAsk(ask: SpokenAsk): string {
  const lines = [`The question on the board: ${ask.question}`];
  (ask.options ?? []).forEach((o, i) => {
    const letter = String.fromCharCode(65 + i);
    const marks = `${o.correct ? ' [THE RIGHT ONE]' : ''}${o.why ? ` (why: ${o.why})` : ''}${o.hint ? ` (hint: ${o.hint})` : ''}`;
    lines.push(`${letter}. ${o.text}${marks}`);
  });
  if ((ask.options ?? []).length === 0) {
    const probe = describeProbe(ask.whyProbe);
    // `expect` first: it is the planner's one-line statement of the answer and
    // reads as the headline the probe then fills in. The bare fallback is only
    // for an ask that authored NEITHER - with a probe there is plenty to weigh.
    //
    // THEY DO OVERLAP, and it is paid for: on an ask with both, the right
    // answer is stated twice - once as the criterion `expect` and once as the
    // probe's correct option, which is the same answer in the words a STUDENT
    // would use. Measured at 100-150 characters, about Rs 0.002 an escalated
    // call. Kept anyway: they are not the same sentence doing the same job, and
    // dropping either one is a change to what the judge sees on the only path
    // that decides a child's verdict - not a thing to do on a character count
    // with no model measurement behind it.
    if (ask.expect) lines.push(`A right answer contains: ${ask.expect}`);
    if (probe) lines.push(probe);
    else if (!ask.expect) {
      lines.push('An open question - no options. Weigh whether their idea is on the right track.');
    }
    if (ask.hint) lines.push(`If they are wrong, lead with this nudge: ${ask.hint}`);
  }
  return lines.join('\n');
}
