# tools/measure/f-bench — measuring `f`

`f` is the share of spoken **class** answers `resolveSpokenAnswer` settles with
no model. It is the number the Rs 5 ceiling rests on, and until this bench it
had never been measured on class asks.

| f | judge line | rollup | clears Rs 5? |
|---|---:|---:|---|
| 1.0 | Rs 0.00 | Rs 3.49 | yes |
| 0.70 | Rs 5.61 | Rs 9.08 | no |
| 0 | Rs 18.70 | Rs 21+ | no |

The ~70% that gets quoted is **not f**. It came from the placement and quiz
bank, where the options are on screen; `packages/tutor-judge/src/match.ts`'s own
header says so.

## Running it

```bash
# once, paid (~50 relay calls): writes answers.json
node tools/measure/f-bench/generate.mjs --relay <url> --token <supabase access token>

# free, repeatable, ~3 seconds: writes result.json
npx vitest run --config tools/measure/f-bench/vitest.config.ts
```

Generation and measurement are split so the measurement can be re-run after any
change to `match.ts` or the `sawAList` guard without paying again.

## The result, 2026-09-21

24 asks from the six pre-warmed Class 10 science classes — every ask that
carries a whyProbe. 240 answers.

**f = 23.2%** unweighted across seven answer shapes. Per shape, which is the
number to actually read:

| shape | local |
|---|---:|
| dont-know | 70.8% |
| right-plain | 41.7% |
| right-hinglish | 16.7% |
| right-terse | 12.5% |
| right-hedged | 4.2% |
| off-target | 4.2% |

At f = 0.23 the judge line is `0.77 x 18.70 = Rs 14.40` and the rollup is about
**Rs 17.9 per student-hour** — 3.6x the ceiling. **whyProbe playback alone does
not reach Rs 5.**

**0 of 96 right answers were settled locally as WRONG.** That is the safety
property, it is worth more than f, and it held perfectly. The guards work.

## Why f is low, and the lever that follows

The words reading scores `hit / own.length` — *what fraction of MY words did the
student say?* — so a long authored option is hard to match **by construction**.
Students answer in three words; the planner writes full sentences.

Measured across all 24 asks:

| mean option length | right answers local |
|---|---:|
| 1-4 words | **66.7%** |
| 5-8 | 15.6% |
| 9-12 | 10.4% |
| 13+ | 0% |

21 of the 24 asks have options averaging 5 words or more.

One ask, four ways of saying the right thing:

```
options as authored: "A frog eats the grasshopper, and a snake eats the frog."
  0.833  local      "A frog eats the grasshopper, and then a snake eats the frog."
  0.500  ESCALATES  "Frog, then snake."
  0.500  ESCALATES  "Grasshopper ko frog khayega, aur frog ko snake."
  0.500  ESCALATES  "frog and snake"

options shortened:   "frog then snake"
  1.000  local      all four
```

**Lowering `MATCH_FLOOR` would buy nothing.** Every one of those 0.500 scores
carries `index: null` — the matcher did not pick an option, so there is nothing
for a lower floor to let through. The failure is that the option was not found,
not that a threshold was too strict.

**Two cheap changes follow, neither touching the matcher's scoring:**

1. **Ask the planner for the distinctive core, not a sentence.** An option's
   `text` is never spoken and — outside the confusable-pairs exception — never
   shown. It exists only to be matched against. This is a prompt change in
   `packages/class-prep/src/prompts.ts` and it is where most of f is.
2. **Digit separators.** `"1,000 Joules"` scores **0.000** against a student who
   says `"1000 Joules"`. `"one thousand joules"` misses both ways.

## What this cannot tell you

- **Nobody has used this product.** Every answer is a model's idea of a
  student's, so the per-shape rates are worth more than the headline, and the
  headline is an unweighted mean over shapes rather than a classroom's mix. A
  real mix is unknown, and inventing weights would hide that.
- The generator is shown the question, the `expect` and the hint — **never the
  probe's option text**. Show it the options and it paraphrases them, the
  matcher scores its own source material, and f comes back flattering and
  meaningless.
- `right-plain` is flattered anyway: the planner writes `expect` and the correct
  option, so they read alike and a textbook-perfect answer lands on both. The
  honest signal is in `right-terse` and `right-hinglish`.
- 24 asks, one syllabus, chemistry and ecology.
