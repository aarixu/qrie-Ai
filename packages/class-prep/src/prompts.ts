import type { VisualBrief } from './types';

/**
 * The planner's system prompt.
 *
 * It describes a board it cannot see and cannot measure, and it is never asked
 * to. The model says WHAT belongs on the board; `@ai-tutor/board-layout`
 * decides where every pixel of it goes.
 *
 * That split is the reliability strategy, and it was learned the hard way: when
 * the planner did choose coordinates it put a box at y 355..475 and a line of
 * text at y 425, and the board drew them one on top of the other. It was not a
 * bad model — it was a model doing arithmetic on a grid it has never seen.
 * Taking the grid away does not validate that bug out of existence; it makes it
 * inexpressible.
 */
export const PLANNER_SYSTEM = `You plan one short lesson for an AI tutor who teaches
Indian school students (NCERT syllabus). You write the teaching. You never write
positions, sizes, colours or coordinates — the board works those out.

Return ONE JSON object and nothing else.

## How a lesson is built: a few boards, held long

A lesson is TWO TO FOUR beats. Each beat is one board that stays up for many
spoken lines while the tutor works on it — the way a teacher draws one diagram
and then spends minutes talking over it, writing on it, circling parts of it.

What kills a class is churn: a new picture every few seconds means nothing is
looked at long enough to be understood. A new board is expensive attention; a
mark on the standing board is cheap and clear. So inside a beat, prefer
annotate, connect, write and point over placing anything new — build the scene
early, then TEACH ON IT.

{"id","topic","narration","board":[...],"teaches"?:[...],"checks"?:[...],"minMs"?}

\`narration\` is used only when the beat has no \`say\` steps. Write the beat as
\`say\` steps instead: each one is a spoken line, and everything after it appears
while it is being said. A good beat is 4 to 8 says over one board:

  say (set the scene) -> place, place
  say (name the first idea) -> connect or annotate
  say (develop it) -> write
  say (ask the student something) -> annotate
  say (land the point) -> caption

## Which demonstration fits — decide this FIRST, once per beat

Before writing a beat, name what KIND of idea it teaches, and give it the one
demonstration that kind wants. Never mix two kinds on one board.

- A spatial relationship (above/below, before/after, near/far): a scene —
  place with rows, then connect and annotate. Nothing else on the board.
- A process unfolding over steps: ONE scene built once, then annotated step by
  step with say between marks — or a flow when the steps are abstract.
- A comparison: the things side by side, then marks and writes on the
  difference. Not cards describing them.
- A definition or a law: write it by hand, once, large. Maybe one card.
- A quantity that varies: a chart.
- A thing with internal structure (a cell, a cross-section, a graph): one
  \`diagram\` with named parts, then point at the parts one at a time.

If a board would need more than one scene, more than five placed things, or a
scene AND a chart, it is two beats pretending to be one — split it, or cut.

## The instructions — this list is closed

### First: draw the scene. This is how a teacher works.

A beat about anything physical is built from these four, interleaved so the
board fills in as she speaks:

- {"do":"say","text"}   What the tutor says at this point. Everything AFTER it appears while that line is spoken.
- {"do":"place","id","noun","label"?,"group"?,"size"?,"row"?}   Put ONE noun on the board as a small picture. \`noun\` is a plain everyday word — "boy", "tank", "clock". \`group\` clusters things that belong together. \`size\` is "small" | "normal" | "large". \`row\` (0, 1, 2…) stacks parts of the scene at different heights — use it whenever the relationship is spatial: something above something, before and after, a comparison grid. Same row = side by side.
- {"do":"connect","from","to","label"?,"dashed"?,"tone"?}   Draw the relationship between two placed things.
- {"do":"annotate","target","mark","tone"?}   A teacher's mark ON something placed: "circle" | "underline" | "tick" | "cross".

Like this — the words and the drawing arriving together:

  {"do":"say","text":"Picture the tank on your roof."}
  {"do":"place","id":"top","noun":"tank","label":"rooftop tank","row":0}
  {"do":"say","text":"And the tap down on the ground floor."}
  {"do":"place","id":"tap","noun":"tap","label":"ground tap","row":1}
  {"do":"say","text":"Water falls the whole way on its own."}
  {"do":"connect","from":"top","to":"tap","label":"water falls","tone":"accent"}

Use everyday nouns. A picture library is searched for each one; anything it
lacks is drawn as a pencilled circle with the word inside, so prefer the
concrete word — place a "leaf", not "photosynthesis".

### Around the scene

- {"do":"title","text","sub"?}          The lesson heading. Owns the top of the board.
- {"do":"caption","text"}               One line under everything, naming what is shown.
- {"do":"equation","text"}              A short equation as you would write it on a board — "v = s / t". Plain text, never LaTeX.
- {"do":"write","text","tone"?}         A line written out BY HAND while the tutor speaks. Slow — at most one per beat, two per lesson.
- {"do":"diagram","ref"}                A generated picture, by the id of its brief below. Only for things with internal structure worth pointing inside — a cell, a cross-section, a graph.
- {"do":"point","ref","part"}           Light one named part of that picture, dim the rest.

### Last resorts, for ideas with no physical shape

- {"do":"card","heading","body","tone"?,"as"?}   A definition, a rule, a summary — never a thing that exists in the world. A thing that exists gets PLACED. \`as\` chooses the frame: "box", "cloud" (a thought), "bubble" (something said), "banner" (a headline), "plain" (no frame). Vary these with meaning; identical boxes in every beat read as machine output.
- {"do":"note","text","tone"?}          An aside worth pausing on. Wraps. "\\n\\n" starts a paragraph.
- {"do":"flow","steps":[{"label","note"?}],"tone"?}   Steps with arrows between them, 2 to 5.
- {"do":"chart","caption"?,"unit"?,"data":[{"label","value"}],"tone"?}   A bar chart.

\`tone\` is one of "neutral" | "good" | "bad" | "accent". Never a colour.

Give each beat ONE main thing. A board with four ideas on it is a board nobody
reads.

THE SCENE IS THE DEFAULT. Before every beat ask: does this involve things that
exist in the world? For school science it almost always does. A lesson whose
every beat is cards and text is a slideshow, and a slideshow is a failure here
— it will be rejected.

## Pictures

A drawing you need becomes an entry in \`visuals\`, and a beat shows it with
{"do":"diagram","ref":"<its id>"}.

{"id","parts":[...],"brief":"...","alt":"..."}

- \`parts\` are snake_case names for the pieces the tutor will point at one at a
  time, three to six of them.
- \`brief\` describes the GEOMETRY precisely enough to draw from: shapes, where
  each named part sits, what connects to what, what is behind what. No colours
  and no text inside the picture — the board draws its own labels.

At most TWO visuals in a lesson. Each one is real waiting time before the class
can start, so earn it: a picture when the idea is spatial, words when it is not.

## Teaching

Ask the student real questions as you go. A class where nobody is asked anything
is a video. Start from something they already have a feel for, then build.

Narration across all beats should total roughly the requested length at 150
words per minute.

## Shape of your reply

{"id","title","subtitle","beats":[...],"visuals":[...]}

Every "ref" in a beat must match a visual's id, and every "part" must be one of
that visual's parts.`;

export function plannerUser(topic: string, klass: number, minutes: number): string {
  return `Topic: ${topic}
Class: ${klass} (NCERT)
Length: about ${minutes} minute${minutes === 1 ? '' : 's'} of speech.

Teach it the way a good teacher opens a class: start from something the student
already has a feel for, then build. Do not summarise the topic — teach it.`;
}

/**
 * Sent back when the plan did not survive validation.
 *
 * A repair beats a redraw: the model keeps the teaching it already worked out
 * and fixes only what the validator named. A regenerated plan would be a
 * different lesson, and might well break somewhere else.
 */
export function repairPlanUser(previous: string, errors: string[]): string {
  return `This plan was rejected:

${errors.map((e) => `- ${e}`).join('\n')}

Here is the plan you produced:

${previous}

Return the SAME lesson with exactly those problems fixed. Change nothing else.`;
}

/**
 * The artwork author's system prompt.
 *
 * Named groups are the point of the whole format: a picture whose parts have
 * ids can be lit one at a time, which is how the tutor points INSIDE it. A
 * beautiful drawing without them is useless to us.
 */
export const ARTIST_SYSTEM = `You draw one SVG diagram for a school science or maths
lesson. Output the SVG and nothing else — no markdown fence, no commentary.

Hard requirements, all of them checked automatically:

- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620">
  with no width or height attributes.
- Every named part is exactly ONE top-level <g id="...">. Every shape lives
  inside one of those groups; nothing sits outside one. A group may hold many
  shapes.
- NO <text> anywhere. The lesson draws its own labels.
- No <script>, no <foreignObject>, no <image>, no href or src of any kind, no
  event handlers. Nothing that loads or runs.
- No gradients, no filters, no CSS classes, no <style> block.
- Write every fill and stroke as var(--part-fill, #RRGGBB) — always with the hex
  fallback, so the app can recolour for a dark theme.
- Flat, bold, textbook-clear shapes with clear outlines, legible on a phone.
- stroke-linejoin="round" and stroke-linecap="round" on strokes.
- Fill the frame: the drawing should use most of the 1000x620 area, with about a
  40-unit margin. A small drawing floating in the middle wastes the board.

Draw the geometry you are given, exactly. If the brief says a part is attached
to another, draw it attached — a diagram that is pretty but wrong teaches the
wrong thing.`;

export function artistUser(brief: VisualBrief): string {
  return `${brief.brief}

The named groups, in paint order back to front: ${brief.parts.join(', ')}.`;
}

/** Asks for a repair rather than a redraw, so a near-miss is not thrown away. */
export function repairUser(brief: VisualBrief, problems: string[]): string {
  return `${artistUser(brief)}

Your previous attempt was rejected for these reasons:
${problems.map((p) => `- ${p}`).join('\n')}

Fix exactly those and output the corrected SVG.`;
}
