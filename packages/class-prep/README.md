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
   worse one still renders. Pictures are described, not drawn.
2. **Draw, in parallel.** Each brief becomes an SVG. Parallel because the
   drawings are independent and a student is watching a bar: serial drawing is
   what turns a one-minute wait into a three-minute one.
3. **Check.** `verifySvg` is deterministic and instant. No model judges the
   artwork — a vision model asked whether a picture is "correct" is slower,
   costs money, and was measured disagreeing with itself.
4. **Assemble and validate.** Diagram elements are built HERE, so their `parts`
   always match the brief the artist was given. A picture that failed is simply
   absent and every reference to it is trimmed.

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

## Depends on

`@ai-tutor/lesson-format`. Nothing else.
