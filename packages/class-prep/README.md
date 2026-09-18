# @ai-tutor/class-prep

A cold topic, prepared: plan the class, draw its pictures, check them, and hand
back something the board can play.

**Pure-ish.** No React, no DOM. The only outside world it touches is an
`LlmAdapter` you pass in — so the whole pipeline tests with fakes, and swapping
provider is a caller's decision.

## Usage

```ts
const { lesson, assets, report } = await prepareClass({
  topic: 'Speed: distance divided by time',
  klass: 9,
  minutes: 2,
  planner: someAdapter,
  artist: someAdapter,
  onProgress: (p) => show(p.message, p.done),
});

<Scene lesson={lesson} visible={…} focus={…} assets={assets} />;
```

## The pipeline

1. **Plan.** One call. The planner gets a CLOSED element vocabulary and a fixed
   1000x620 board, so it cannot invent a broken lesson — only a worse one, and a
   worse one still renders. Pictures are described, not drawn. Every ask is
   asked for with a `whyProbe` — the pre-authored judgement layer (right answer
   plus named-misconception distractors, each with a spoken `why`) that lets
   playback judge a spoken reply without a model call. It is never a visible
   option list; the on-screen no-options pedagogy rule stands.
2. **Assemble and validate.** Diagram elements are built HERE, so their `parts`
   always match the brief the artist was given. A picture that failed is simply
   absent and every reference to it is trimmed. Invented outcome ids are
   dropped and `checks` on an ask beat is capped at two, both deterministically.
3. **Screen.** `screenSpine` runs the shared child-safety screen
   (`packages/safety`) over every spoken and written string **in the spine** —
   title, subtitle, beat narration, every ask string, every option and
   `whyProbe`, the fill, and every board element — each as its stringified
   whole *and* as its individual string leaves, with the limit set to each
   string's own length. It REFUSES on a distress verdict, naming the beat and
   never quoting the line back (the refusal message reaches the student's
   screen). This is the same screen the keep gate runs server-side — run here
   too because the first student on a cold topic hears narration ~80 seconds
   before keep ever sees it. **What it does not reach:** the text inside the
   generated ARTWORK. An SVG's labels live in `assets`, not in
   `lesson.elements`, and the drawing happens after this screen — that ink is
   screened only by the server keep gate, so the first-student gap stays open
   for drawn labels.
4. **Review** (when a `reviewer` adapter is passed). One further LLM call
   checks the teaching is TRUE against the topic, class and outcome statements
   already in the planner's inputs, and returns a typed verdict — a verdict
   that names a wrong claim is a FLAG whatever its `ok` field says. A flagged
   lesson gets one repair round fuelled by the named problems, then prep
   REFUSES rather than teaches it. Runs before `onDraft`, so a student is
   never taught an unreviewed class; the cost of that ordering is measured in
   `report.review.ms`. The review judges the plan's words, never the drawn
   artwork (see step 3). Keep-side: `SaveMeta.requireReviewed` refuses to keep
   a class `report.review` does not vouch for, because the first class kept on
   a topic is the one every later student is served.
   A lesson whose `whyProbe` the planner mis-shaped loses the probe, not the
   class (`dropBadProbes`, same posture as the id and checks trims).
5. **Draw, in parallel.** Each brief becomes an SVG. Parallel because the
   drawings are independent and a student is watching a bar: serial drawing is
   what turns a one-minute wait into a three-minute one.
6. **Check.** `verifySvg` is deterministic and instant. No model judges the
   artwork's aesthetics — the reviewer above judges claims, not drawings.

## What it refuses to keep quiet about

**A false claim** (with a `reviewer`): flagged, named, repaired once, and then
refused — never taught wrong and never silently rewritten. `reviewLesson` is
exported on its own for the keep-side / pre-warm wiring, which lives elsewhere.

**A distress line in the spine**: always refused, reviewer or not. The screen
is `packages/safety`'s, imported by relative path so prep and the server keep
gate cannot drift apart — and it deliberately passes the syllabus's own hard
biology (kidney failure, heart attacks, cells dying, in English and Hinglish),
because a gate that refuses Class 10 Life Processes is an outage, not safety.

## What it refuses to do

**Fail the class for one bad picture.** A class with one drawing instead of two
is still a class; a class that failed to start is not. A rejected picture is
redrawn once, then dropped, and the beats that needed it are trimmed away.

**Trust the plan.** A live planner emitted `"size": "md"` — a string where a
number belonged — which reached the renderer as a `NaN` mask and made an element
vanish with only a console warning. The validator now catches that class of
mistake, and a failed plan gets one repair round naming exactly what was wrong.

**Put anything executable on the board.** The artwork is inlined into the page
so its groups can be lit one at a time, which means a `<script>` would run in
our origin. `verifySvg` rejects scripts, foreignObject, embedding tags, inline
event handlers, `javascript:` URLs and every external reference — rejects, not
sanitises. A picture we do not fully understand is one we should not show.

## Measured

Planning a two-minute lesson and drawing one diagram, on OpenRouter:

| Model | Plan | Draw |
| --- | --- | --- |
| `google/gemini-3.7-flash` | 13.7s, Rs 0.74 | 25.9s, Rs 1.51 |
| `google/gemini-3.5-flash` | 19.7s, Rs 3.25 | 28.8s, Rs 4.96 |
| `google/gemini-3.1-pro-preview` | 55.7s, Rs 8.36 | 56.8s, Rs 9.25 |

The flash model was not a compromise: its drawing was the best of the three.
End to end in the browser, a cold class lands in about **50 seconds for roughly
Rs 2.25**.

Those figures are **plan and draw only**: they predate steps 3 and 4 above. A
reviewed prep adds one planner-grade call before the room opens — three on a
flagged lesson (review, repair, re-review) — and the reviewer reads more than
the planner writes. No Rs or seconds figure for the review has been measured
yet; NOT VERIFIED until `report.review.ms` has run against a real reviewer.

## Depends on

`@ai-tutor/lesson-format`, `@ai-tutor/board-layout` and `@ai-tutor/persona`
as packages (see package.json), plus two
relative-path imports that exist so a gate has exactly one implementation:
`packages/relay/src/markup.ts` (the markup gate) and
`packages/safety/src/screen.ts` (the child-safety screen).
