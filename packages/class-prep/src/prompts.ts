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

## A beat

The lesson is a list of beats. A beat is one moment of teaching: what the tutor
says, and what is on the board while she says it.

{"id","topic","narration","board":[...],"teaches"?:[...],"checks"?:[...],"minMs"?}

\`narration\` is the lesson. Write it as SPEECH, not prose: short sentences,
second person, contractions, the way a good teacher actually talks.

\`board\` is an ordered list of instructions. They stack down the board in the
order you write them, so write them the way you would fill a board: heading
first, then the thing you are teaching, then the caption.

## The instructions — this list is closed

- {"do":"title","text","sub"?}          The lesson heading. Owns the top of the board.
- {"do":"caption","text"}               One line under everything, naming what is shown.
- {"do":"diagram","ref"}                A generated picture, by the id of its brief below.
- {"do":"point","ref","part"}           Light one named part of that picture, dim the rest.
- {"do":"equation","text"}              A short equation as you would write it on a board — "v = s / t", "F = ma". Plain text; there is no maths typesetter, so a backslash macro would appear exactly as written.
- {"do":"write","text","tone"?}         A line written out BY HAND while the tutor speaks. Slow and deliberate — at most one per beat and two per lesson, for the line worth waiting for.
- {"do":"card","heading","body","tone"?} A heading with one line under it. Write two or three in a row and they lay out side by side automatically.
- {"do":"note","text","tone"?}          An aside worth pausing on. Wraps. "\\n\\n" starts a new paragraph.
- {"do":"flow","steps":[{"label","note"?}],"tone"?}  Steps with arrows between them. 2 to 5 steps.
- {"do":"chart","caption"?,"unit"?,"data":[{"label","value"}],"tone"?}  A bar chart.

### Drawing a scene, which is what a teacher does most

- {"do":"say","text"}                   What the tutor says at this point. Everything you write AFTER it appears while that line is being spoken.
- {"do":"place","id","noun","label"?,"group"?,"size"?}  Put ONE noun on the board as a small picture. \`noun\` is a plain everyday word — "boy", "school", "clock", "car". \`group\` clusters things that belong together. \`size\` is "small" | "normal" | "large".
- {"do":"connect","from","to","label"?,"dashed"?,"tone"?}  Draw the relationship between two placed things.
- {"do":"annotate","target","mark","tone"?}  A teacher's mark ON something already placed: "circle" | "underline" | "tick" | "cross".

This is the most important thing you can do. Build the picture up WITH the
words, the way a teacher draws while she talks:

  {"do":"say","text":"Imagine you and your friend leaving home together."}
  {"do":"place","id":"you","noun":"boy","label":"you","group":"pair"}
  {"do":"place","id":"friend","noun":"boy","label":"your friend","group":"pair"}
  {"do":"say","text":"You are both walking to school."}
  {"do":"place","id":"school","noun":"school","label":"school"}
  {"do":"say","text":"And the school is two kilometres away."}
  {"do":"connect","from":"you","to":"school","label":"2 km","tone":"accent"}

Use everyday nouns. A picture library is searched for each one, and anything it
does not have is drawn as a pencilled circle with the word inside — so "boy" and
"school" and "clock" come out as real pictures, while "photosynthesis" comes out
as a label. Prefer the concrete word: place a "leaf", not "photosynthesis".

\`tone\` is one of "neutral" | "good" | "bad" | "accent". Never a colour.

Give each beat ONE main thing — a scene, or a picture, or a chart, or a row of
cards, or a note. A board with four ideas on it is a board nobody reads.

Reach for a SCENE first. A class is mostly a teacher drawing small things and
joining them up, not a slideshow of finished diagrams. Use \`diagram\` only when
the thing itself has internal structure worth pointing inside — a cell, a
cross-section, a graph.

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
