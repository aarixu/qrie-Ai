import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Leaf modules, not the package index files: the indexes re-export values via
// extensionless specifiers, which Node's type stripping cannot resolve. The
// leaf modules' own imports are all `import type`, which stripping erases.
import { CANVAS_W, CANVAS_H } from '../../../packages/lesson-format/src/types.ts';
import type { Topic } from '../../../packages/syllabus/src/syllabus.ts';

/**
 * The prompt is where pedagogy lives. The system prompt carries everything
 * that is true for EVERY lesson — the closed element vocabulary, the beat
 * semantics, the teaching voice, and one full worked example. The user prompt
 * carries only this topic. Keeping the split clean means the (large) system
 * half is byte-stable across topics and repair retries.
 */

export interface PromptOptions {
  /** Class level 6..12 — shifts narration language complexity. */
  klass: number;
  /** Written into the lesson's topicRef so the classroom can trace provenance. */
  topicPath?: string;
  /** Lesson id to emit; defaults to class<klass>-<topicId>. */
  lessonId?: string;
}

// The committed dev lesson doubles as the few-shot example: it is validated by
// lesson-format's own tests, so the model always imitates a known-good lesson.
const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PATH = path.resolve(here, '../../../content/class10-heart-mini/lesson.json');
let exampleCache: string | null = null;
function exampleLesson(): string {
  exampleCache ??= fs.readFileSync(EXAMPLE_PATH, 'utf8').trim();
  return exampleCache;
}

const VOCABULARY = `ELEMENT VOCABULARY — closed set. Compose ONLY these kinds, with exactly these fields:
- title:   { "kind": "title", "id", "x", "y", "text", "sub"? } — the lesson heading
- text:    { "kind": "text", "id", "x", "y", "text", "size"?, "muted"? } — a line of supporting text
- note:    { "kind": "note", "id", "x", "y", "w", "text", "tone"? } — a sticky-note callout that wraps at width w
- box:     { "kind": "box", "id", "x", "y", "w", "h", "label", "tone"? } — a labelled rectangle (organs, stages, parts)
- doc:     { "kind": "doc", "id", "x", "y", "w", "h", "label"?, "lines"? } — a document/page placeholder
- arrow:   { "kind": "arrow", "id", "from": {"x","y"}, "to": {"x","y"}, "label"?, "dashed"?, "tone"? } — flow or relation
- pen:     { "kind": "pen", "id", "points": [{"x","y"}, ...] (at least 2), "tone"? } — a freehand stroke
- formula: { "kind": "formula", "id", "x", "y", "text" } — an equation or expression
- image:   { "kind": "image", "id", "x", "y", "w", "h", "src", "alt", "label"? } — src may be a placeholder path like "assets/xyz.png"; alt is REQUIRED and describes the picture
- model3d: { "kind": "model3d", "id", "x", "y", "w", "h", "asset"?, "label"? } — a 3D viewport placeholder

COORDINATES: a fixed ${CANVAS_W}x${CANVAS_H} canvas. x grows right, y grows down. Keep every element fully inside it and leave breathing room — a crowded canvas teaches nothing.
TONES: "tone" is one of "neutral", "good", "bad", "accent". Never emit colors or hex codes; the renderer owns the theme.`;

const SEMANTICS = `BEAT SEMANTICS — these rules are validated mechanically; break one and the lesson is rejected:
- Each beat's "show" is the COMPLETE set of element ids visible during that beat, not a delta. If something stays on screen, repeat its id in every later beat that shows it. Build the canvas up beat by beat.
- "focus" (optional) is the subset of "show" being emphasised right now.
- 6 to 12 beats. Each beat needs a unique "id", a plain-language "topic" label, and "narration".
- Every element you declare should appear in at least one beat's "show".

NARRATION — you are a warm, encouraging Indian teacher speaking clear English ("en"):
- 30 to 60 words per beat. Conversational, spoken aloud by TTS — no markdown, no stage directions.
- Beat 1 is a HOOK: a question, a surprise, a tiny story — earn the student's attention before teaching.
- Bring in a concrete real-life example the student already knows within the first 2-3 beats.
- Every ~3 beats, ask a short rhetorical check question ("Think about it — why would that happen?") so the student self-tests.
- The final beat is a RECAP that compresses the whole lesson into a couple of lines.`;

function languageLevel(klass: number): string {
  return klass <= 8
    ? `AUDIENCE: Class ${klass}. Keep sentences short and vocabulary simple; lean on everyday comparisons before naming any technical term.`
    : `AUDIENCE: Class ${klass}. NCERT board-exam depth is expected — use the correct technical terms, but anchor each one with an everyday comparison the first time it appears.`;
}

export function buildPrompt(topic: Topic, opts: PromptOptions): { system: string; user: string } {
  const system = [
    'You are an expert lesson designer for AI Tutor, a pre-recorded class app for Indian school students. You design a lesson as JSON: a set of canvas ELEMENTS plus a timeline of BEATS narrated over them.',
    VOCABULARY,
    SEMANTICS,
    languageLevel(opts.klass),
    'Here is a complete example lesson that follows every rule above. Match its structure, density and voice:',
    exampleLesson(),
  ].join('\n\n');

  const lessonId = opts.lessonId ?? `class${opts.klass}-${topic.id}`;
  const lines = [
    'Design one lesson for this syllabus topic.',
    '',
    `TOPIC: ${topic.title}`,
    'OBJECTIVES — the lesson must teach every one of these:',
    ...topic.objectives.map((objective) => `- ${objective}`),
  ];
  if (topic.visualIdeas && topic.visualIdeas.length > 0) {
    lines.push('VISUAL IDEAS — concrete starting points for the canvas (adapt freely):');
    lines.push(...topic.visualIdeas.map((idea) => `- ${idea}`));
  }
  if (topic.estMinutes !== undefined) {
    lines.push(`TARGET LENGTH: about ${topic.estMinutes} minutes of class time.`);
  }
  lines.push(
    '',
    `Top-level fields: "formatVersion": 1, "id": "${lessonId}", "language": "en", "canvas": { "w": ${CANVAS_W}, "h": ${CANVAS_H} }${opts.topicPath ? `, "topicRef": "${opts.topicPath}"` : ''}.`,
    '',
    'Reply with PURE JSON only — a single lesson object. No markdown fences, no commentary, nothing before or after the JSON.',
  );

  return { system, user: lines.join('\n') };
}
