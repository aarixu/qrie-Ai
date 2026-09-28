# @ai-tutor/maths-check

**Does the maths on the board hold?** A deterministic checker for the equation lines a
Class 6-10 maths lesson writes. Exact rational arithmetic (bigint over bigint, never a
float), 0 model calls, no runtime dependencies (`@ai-tutor/lesson-format` is imported
for its types only).

T1.4 of the tutor build plan (`docs/handoff/2026-09-26-state-of-play.md`). The plan runs
it at prep, where a failure feeds the repair loop and fails closed. That wiring is a separate
T1 item, not part of this package: class-prep's keep gate (`packages/class-prep/src/gate.ts`,
rule `maths`) calls `checkLesson`, and counts a check that throws as a failure.

## What it does

- `parseLine(text)` reads one board line into statements (chains of `=`), after
  stripping labels such as `... (Equation 1)`, `From (2):` and `Solution:`. It reads
  implicit multiplication (`2y`, `7(3 - 2y)`), unary minus, brackets, powers and
  fractions, and **refuses** anything it could read two ways (`1/2x`, `2^3x`, `2 1/2`, a
  recurring decimal such as `0.333...`, prose around an equation), and any line labelled
  as a wrong step (`Common mistake:`) — see the header of `src/parse.ts`.
- `evaluate(expr, values?)` gives the exact value of one expression, or null.
- `checkLines(lines)` finds the answers the board claims (`y = 19 / 29`,
  `Solution: x = 49/29, y = 19/29`) and holds every other line to them. A line it cannot
  read, or whose variables have no answer, is **skipped, never failed**. A quadratic's two
  roots are a root set, reported in `roots`, not two rival answers; a practice question
  (`Try:`) is held to no worked example's answer. The full rules, the one shape it
  excuses (an unsolved opening puzzle on its own page) and its known blind spot are in
  the header of `src/check.ts`.
- `checkLesson(lesson)` does the same over a lesson's `formula`, `handwrite`, `text` and
  `note` elements that carry an `=`, in the order the class sees them, with element ids.

## Usage

```ts
import { checkLesson, formatRational } from '@ai-tutor/maths-check';

const res = checkLesson(lesson);
if (!res.ok) {
  for (const f of res.failures) console.log(f.id, f.reason);
  // b3_7 `2 - 21` is -19, not -17
}
formatRational(res.solutions.x); // "49/29"
```

## Measured on

The cold Class 10 substitution lesson of 2026-09-28 (`tests/fixtures`): its 10 worked
lines pass (11 equations — the Solution line holds two), the opening puzzle is skipped
as a separate problem, and each of the two T1.4 mutations fails naming its element. That
is one lesson; how it does across other lessons is UNVERIFIED.
