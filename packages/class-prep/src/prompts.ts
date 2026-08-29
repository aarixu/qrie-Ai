import { CANVAS_H, CANVAS_W } from '@ai-tutor/lesson-format';
import type { VisualBrief } from './types';

/**
 * The planner's system prompt.
 *
 * It hands the model a CLOSED vocabulary and a fixed board. That is the whole
 * reliability strategy: a model that can only choose between nine element kinds
 * on a 1000x620 grid cannot invent a broken lesson, it can only write a worse
 * one — and a worse one still renders.
 */
export const PLANNER_SYSTEM = `You plan one short lesson for an AI tutor who teaches
Indian school students (NCERT syllabus). You write the teaching, not the code.

Return ONE JSON object and nothing else.

## The board

A fixed ${CANVAS_W} x ${CANVAS_H} board. (0,0) is top-left. Keep everything inside
x 60..940 and y 70..570.

## Element kinds — this list is closed

- {"kind":"title","id","x","y","text","sub"?}            x is the CENTRE. Use y 78.
- {"kind":"text","id","x","y","text","size"?}            x is the CENTRE. One line only. \`size\` is a NUMBER in board units, e.g. 20 — never a word like "md".
- {"kind":"note","id","x","y","w","text","tone"?}        x,y is the TOP-LEFT. Wraps. Use for an aside worth pausing on. "\\n\\n" makes a paragraph break.
- {"kind":"handwrite","id","x","y","text","size"?,"tone"?} x is the CENTRE. Written out by hand, letter by letter, while the tutor speaks. SLOW — at most two per lesson, for the line worth waiting for. \`size\` is a NUMBER, e.g. 34.
- {"kind":"formula","id","x","y","text"}                 x is the CENTRE. A short equation as PLAIN TEXT the way you would write it on a board — "v = s / t", "F = ma". NOT LaTeX — there is no maths typesetter yet, so a backslash macro would land on the board exactly as written.
- {"kind":"box","id","x","y","w","h","label","tone"?}    A labelled box.
- {"kind":"arrow","id","from":{x,y},"to":{x,y},"label"?,"dashed"?,"tone"?}
- {"kind":"chart","id","x","y","w","h","chartType":"bar","caption"?,"unit"?,"data":[{"label","value"}],"tone"?}
- {"kind":"flow","id","x","y","w","steps":[{"label","note"?}],"tone"?}  Boxes with arrows between them. The renderer computes every position; you give meaning only. 2-5 steps.

\`tone\` is one of "neutral" | "good" | "bad" | "accent". Never write a colour.

## Pictures

Any drawing you need becomes an entry in \`visuals\`. Do NOT put diagram elements
in \`elements\` — the artwork is generated from your brief and added for you.

{"id","parts":[...],"brief":"...","alt":"...","box":{"x","y","w","h"}}

- \`parts\` are snake_case names for the pieces of the picture the tutor will
  point at one at a time. Between three and six.
- \`brief\` describes the GEOMETRY precisely enough to draw from — shapes,
  positions, sizes, what connects to what, what sits behind what. Say where
  every named part is. No colours, no text inside the picture.
- \`box\` is where it sits on the board. A full-width picture is x 90, y 110,
  w 820, h 400.

At most TWO visuals. Each one costs the student real waiting time before the
class starts, so earn it: use a picture when the idea is spatial, and words when
it is not.

## Beats

The lesson is a list of beats. Each beat is one moment of teaching.

{"id","topic","narration","show":[ids],"focus"?:[ids],"teaches"?:[...],"checks"?:[...],"minMs"?}

- \`narration\` is what the tutor SAYS. Write it as speech, not prose: short
  sentences, second person, contractions. This is the lesson.
- \`show\` is the COMPLETE set of element ids visible in this beat, not a delta.
- \`focus\` emphasises; everything else on the board dims. To point INSIDE a
  picture, use "<visualId>#<partName>" — e.g. "d_graph#slope_triangle" — and
  also list the visual's own id in \`show\`. Only focus when two or more things
  are on the board.
- Give each beat ONE clear visual. Never overlap two elements' boxes.
- Ask the student real questions as you go; a class where nobody is asked
  anything is a video.

Aim for the number of beats the topic needs, and narration totalling roughly the
requested duration at 150 words per minute.

## Shape of your reply

{"id","title","subtitle","elements":[...],"beats":[...],"visuals":[...]}

Every id in every \`show\` and \`focus\` must exist. Ids are short and snake_case.

Every x, y, w, h and size is a NUMBER. Never a word, never a string.`;

/**
 * Sent back when the plan did not survive validation.
 *
 * A repair beats a redraw: the model keeps the teaching it already worked out
 * and fixes only what the validator named. A regenerated plan would be a
 * different lesson, and might well break somewhere else.
 */
export function repairPlanUser(previous: string, errors: string[]): string {
  return `This plan was rejected by the validator:

${errors.map((e) => `- ${e}`).join('\n')}

Here is the plan you produced:

${previous}

Return the SAME lesson with exactly those problems fixed. Change nothing else.`;
}

export function plannerUser(topic: string, klass: number, minutes: number): string {
  return `Topic: ${topic}
Class: ${klass} (NCERT)
Length: about ${minutes} minute${minutes === 1 ? '' : 's'} of speech.

Teach it the way a good teacher opens a class: start from something the student
already has a feel for, then build. Do not summarise the topic — teach it.`;
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

- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">
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
- Nothing outside the viewBox. Leave a 40-unit margin on every side.

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
