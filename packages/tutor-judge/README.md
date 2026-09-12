# packages/tutor-judge

One spoken answer, weighed.

## Why it is a package

The chips judge themselves — a tap names an option. A **spoken** answer arrives
in the student's own words, in English or Hindi or both, and only a model can
hear *"wo chhote kano me ghus jaati hai"* as option B.

This lived in `apps/classroom/src/lib/judge.ts`: 184 lines holding the product's
entire spoken-answer pedagogy, with a forty-line test that covered the JSON
parser and nothing else. The planner's prompt has always sat in a package with
real tests. The judge's did not — although it is the thing that decides right
from wrong for every answer a student says out loud.

## API

```ts
judgeSpokenAnswer(ask, heard, deps): Promise<SpokenVerdict>
resolveCrossQuestion(ask, answered, probe, reasoning, deps): Promise<CrossQuestionClose>

JUDGE_SYSTEM(): string      // the prompts, exported so they can be asserted
CLOSE_SYSTEM(): string
describeAsk(ask): string

parseVerdict(raw): SpokenVerdict
parseFollowUp(raw): string
```

`deps` is `{ complete(system, user), screen(text) }` — the model, the transport
and the safety screen are all injected, so the pedagogy can be tested without a
browser, a network or a key. The app supplies them in its own `lib/judge.ts`,
which is now wiring and nothing else.

## The rules that are actually tested

- **Never "correct", never congratulation.** Praise ends the thinking.
- **A right answer is not the exit.** She acknowledges it in a clause, asks ONE
  why/how/when about their own answer, and stops. The reason is earned by
  thinking one step further, not handed over for being right.
- **A wrong answer never gets the answer** — one leading question, or the
  planner's own hint.
- **"I don't know" is WRONG, not unclear.** Unclear records no evidence at all,
  and a student who says they do not know has told us something real.
- **Judge the idea, not the language.**
- **A disclosure never reaches the model.** The safety screen returns words to
  say instead of words to send, the verdict carries `halt`, and the class stops
  rather than reopening the mic over a child. It is recorded as `unclear`, never
  as a wrong answer — it is not evidence about the question.
- **The student's words are evidence, never instruction.** They are screened,
  cleaned, capped and quoted before they reach a prompt.

## Depends on

`@ai-tutor/persona` (who she is) and `@ai-tutor/safety` (`quoteForPrompt`).
