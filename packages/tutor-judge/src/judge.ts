import { CLOSE_SYSTEM, JUDGE_SYSTEM, describeAsk } from './prompts.ts';
import type {
  CrossQuestionClose,
  JudgeDeps,
  JudgeOptions,
  SpokenAsk,
  SpokenVerdict,
} from './types.ts';

/**
 * The model's reply, held to shape.
 *
 * A verdict with nothing to say is a failure, not a silent pass: the class is
 * holding on this question and something has to be spoken before it moves.
 */
export function parseVerdict(raw: string): SpokenVerdict {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The judge replied without a verdict.');
  const data = JSON.parse(match[0]) as { verdict?: unknown; say?: unknown; gave?: unknown };
  const verdict =
    data.verdict === 'right' || data.verdict === 'wrong' || data.verdict === 'unclear'
      ? data.verdict
      : 'unclear';
  const say = typeof data.say === 'string' ? data.say.trim() : '';
  if (!say) throw new Error('The judge has a verdict but nothing to say.');
  if (verdict !== 'wrong') return { verdict, say };
  // A wrong answer is ALWAYS answered with one or the other, so a model that
  // forgot the field still gave help and the class must still record it. The
  // default is the lower rung: it is the move the prompt lists first, and
  // either way the point is that this answer was not unassisted.
  return { verdict, say, gave: data.gave === 'hint' ? 'hint' : 'question' };
}

export function parseFollowUp(raw: string): CrossQuestionClose {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The close came back without words.');
  const data = JSON.parse(match[0]) as { say?: unknown; held?: unknown };
  const say = typeof data.say === 'string' ? data.say.trim() : '';
  if (!say) throw new Error('The close came back without words.');
  // Unlike `gave`, a missing `held` gets NO default. There is no move she
  // always makes here that would let one be inferred — the close is spoken
  // either way — so guessing would file "we never asked" as a judgement about
  // the student. Absent stays absent, and replay moves no belief on it.
  return typeof data.held === 'boolean' ? { say, held: data.held } : { say };
}

/**
 * WHAT THE STUDENT SAID, AS EVIDENCE RATHER THAN AS INSTRUCTION.
 *
 * Their words go into the prompt inside quotes. Unescaped, a quote mark ends
 * the block and everything after it reads as a new turn — so an answer box was
 * a second system prompt, and a transcriber that ran away with background noise
 * was a thousand words of one. `deps.screen` screens, cleans, caps and quotes
 * in a single pass, and it is the same call every path uses.
 *
 * When it hands back words to SAY instead of words to send, the model is not
 * asked at all: the student has said something that needs a person, and the
 * verdict carries `halt` so the class stops rather than asking again.
 *
 * `opts.language` is the child's tutor language, and it decides the one
 * register line in `JUDGE_SYSTEM` — what she speaks, never how she reads.
 */
export async function judgeSpokenAnswer(
  ask: SpokenAsk,
  heard: string,
  deps: JudgeDeps,
  opts: JudgeOptions = {},
): Promise<SpokenVerdict> {
  const screened = deps.screen(heard);
  if (screened.text === null) {
    // 'unclear' on purpose: this is not evidence that the student got the
    // question wrong, and the outcome map must not record it as if it were.
    return { verdict: 'unclear', say: screened.say ?? '', halt: true };
  }
  const reply = await deps.complete(
    JUDGE_SYSTEM(opts.language),
    `${describeAsk(ask)}\n\nThe student said: "${screened.text}"`,
  );
  // The SCREENED words travel onward, never `heard`. This is the only copy a
  // caller gets, so the ledger cannot store the raw transcript by reaching for
  // the wrong variable.
  return { ...parseVerdict(reply), heard: screened.text };
}

/**
 * THE CROSS-QUESTION, CLOSED.
 *
 * A right answer is not the exit: she asks one why/how/when about it, the
 * student reasons out loud, and THIS call closes the loop — their reasoning
 * affirmed or gently corrected, then the full why. It always closes: the
 * cross-question deepens a right answer, it never blocks the class.
 *
 * `opts.language` does here what it does for the judge: the close is spoken in
 * the language the child chose, whichever language they reasoned in.
 */
export async function resolveCrossQuestion(
  ask: SpokenAsk,
  answered: string,
  probe: string,
  reasoning: string,
  deps: JudgeDeps,
  opts: JudgeOptions = {},
): Promise<CrossQuestionClose> {
  const screened = deps.screen(reasoning);
  // Same rule as the judge: their reasoning is never an instruction, and if it
  // turns out to be a disclosure the close is her response to that instead —
  // and the class stops there rather than resolving the question over them.
  if (screened.text === null) return { say: screened.say ?? '', halt: true };

  /**
   * Their FIRST answer, screened too.
   *
   * It used to go through `quoteForPrompt` alone, which strips quotes and
   * newlines so a child's words cannot become a second system prompt — a real
   * defence, and not this one. It does not look at what the words ARE. So an
   * answer the screen had cleaned on the way to the judge was sent to the
   * model in full on the way to the close, one turn later, because this is a
   * different call site and the rule was being enforced at each of them
   * separately. If the first answer is what needs a person, the close says so
   * and stops rather than resolving the question over them.
   */
  const before = deps.screen(answered);
  if (before.text === null) return { say: before.say ?? '', halt: true };

  const user = `${describeAsk(ask)}

They answered: "${before.text}"
You then asked: "${probe}"
They reasoned: "${screened.text}"`;

  // The SCREENED reasoning travels onward, never `reasoning` — the same rule
  // and the same reason as the judge one turn earlier. This is the only copy a
  // caller gets, so the ledger cannot store the raw transcript by reaching for
  // the wrong variable.
  return {
    ...parseFollowUp(await deps.complete(CLOSE_SYSTEM(opts.language), user)),
    heard: screened.text,
  };
}
