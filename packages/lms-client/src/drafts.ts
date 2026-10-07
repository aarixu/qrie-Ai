/**
 * AI-DRAFTED QUESTIONS FOR A TEACHER.
 *
 * What the model is asked, and what is kept of its answer. The answer only
 * ever becomes a DRAFT (lms.item_draft, migration 0043): the teacher reads,
 * edits and adds each one before any child can be set it. Nothing about a
 * child goes into the request — only the class, subject, chapter, topic and
 * the teacher's own note.
 */

import type { Backend } from './backend.ts';

/** The model the drafts are asked of: one the relay serves (packages/relay ALLOWED_MODELS). */
export const DRAFT_MODEL = 'google/gemini-3.7-flash';

/** At most this many drafts are asked for, and kept, at a time. */
export const MAX_DRAFTS = 10;

const MAX_NOTE = 300;
const MAX_STEM = 600;
const MAX_OPTION = 200;
const MAX_LABEL = 120;

export interface DraftAsk {
  grade: number;
  subject: string;
  chapter: string;
  /** The topic within the chapter, when the teacher chose one. */
  topic?: string | null;
  count: number;
  /** The teacher's own words to the model, e.g. "word problems". */
  note?: string | null;
}

/** One multiple-choice question as lms.item holds it. */
export interface QuestionDraft {
  stem: string;
  options: string[];
  correctIndex: number;
  /** For each option, the mistake a child who picks it shows; '' for the right one and for none. */
  misconceptions: string[];
}

/** An OpenAI-shaped chat request, as the relay's /llm route takes it. */
export interface DraftChat {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  response_format: { type: 'json_object' };
  temperature: number;
  max_tokens: number;
}

const howMany = (count: number) => Math.min(MAX_DRAFTS, Math.max(1, Math.floor(Number(count) || 1)));

export function draftChat(ask: DraftAsk): DraftChat {
  const n = howMany(ask.count);
  const note = (ask.note ?? '').trim().slice(0, MAX_NOTE).trim();
  const system = [
    'You write multiple-choice questions for Indian school students following the CBSE syllabus and the NCERT textbooks.',
    'Every question has exactly 4 options and exactly one correct option.',
    'Each wrong option must be an answer a student who has a particular common misunderstanding would choose.',
    'For every wrong option, name that misunderstanding in a short phrase of under 12 words, starting with a verb such as "Thinks" or "Confuses".',
    'Write in English, in plain text. Write maths with ordinary characters, like 3/4, x^2 and 2 x 5.',
    'Do not use "all of the above", "none of the above", pictures, or diagrams.',
    'Answer with JSON only, in this shape:',
    '{"questions":[{"stem":"...","options":["...","...","...","..."],"correctIndex":0,"misconceptions":["","...","...","..."]}]}',
    'In "misconceptions", put each misunderstanding at the same position as its option, and an empty string at the correct option.',
  ].join('\n');
  const user = [
    `Class ${ask.grade}, ${ask.subject}.`,
    `Chapter: ${ask.chapter}.`,
    ...(ask.topic ? [`Topic: ${ask.topic}.`] : []),
    `Write ${n} ${n === 1 ? 'question' : 'questions'}, each testing understanding rather than memory of wording.`,
    ...(note ? [`The teacher adds: ${note}`] : []),
  ].join('\n');
  return {
    model: DRAFT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4,
    max_tokens: 6000,
  };
}

const UNREADABLE = "The AI's answer could not be read. Try again.";

const text = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : null);

/** One answer from the model as a usable question, or null. */
function questionOf(raw: unknown): QuestionDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const stem = text(q.stem);
  if (!stem || stem.length > MAX_STEM) return null;
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return null;
  const options = q.options.map(text);
  if (options.some((o) => !o || o.length > MAX_OPTION)) return null;
  const seen = new Set(options.map((o) => o!.toLowerCase()));
  if (seen.size !== options.length) return null;
  const correct = q.correctIndex;
  if (typeof correct !== 'number' || !Number.isInteger(correct) || correct < 0 || correct >= options.length) return null;
  const labels = Array.isArray(q.misconceptions) && q.misconceptions.length === options.length ? q.misconceptions : null;
  const misconceptions = options.map((_, i) => {
    const label = labels ? text(labels[i]) : null;
    return i === correct || !label || label.length > MAX_LABEL ? '' : label;
  });
  return { stem, options: options as string[], correctIndex: correct, misconceptions };
}

/**
 * The usable questions in the model's answer, at most as many as were asked
 * for, and how many it gave that were not usable (or repeated a wording).
 * Throws, in words a teacher can act on, when the answer is not JSON at all.
 */
export function readDrafts(reply: string, ask: DraftAsk): { drafts: QuestionDraft[]; rejected: number } {
  const body = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(UNREADABLE);
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) throw new Error(UNREADABLE);

  const drafts: QuestionDraft[] = [];
  const stems = new Set<string>();
  let rejected = 0;
  for (const raw of list) {
    const q = questionOf(raw);
    const key = q?.stem.toLowerCase().replace(/\s+/g, ' ');
    if (!q || stems.has(key!)) {
      rejected += 1;
      continue;
    }
    stems.add(key!);
    if (drafts.length < howMany(ask.count)) drafts.push(q);
  }
  return { drafts, rejected };
}

/**
 * Asks the AI for questions and keeps the usable ones as drafts in the
 * caller's own queue (lms.save_item_drafts): how many were kept, and how
 * many the AI gave that were not usable. Keeps nothing, and says so, when
 * none is usable.
 */
export async function draftQuestions(
  backend: Pick<Backend, 'askAi' | 'api'>,
  ask: DraftAsk & { outcomeId?: string | null },
): Promise<{ kept: number; rejected: number }> {
  const chat = draftChat(ask);
  const { drafts, rejected } = readDrafts(await backend.askAi(chat), ask);
  if (!drafts.length) throw new Error('The AI gave no usable questions this time. Try again, or try another topic.');
  const kept = await backend.api.saveItemDrafts({
    grade: ask.grade,
    subject: ask.subject,
    outcomeId: ask.outcomeId ?? null,
    model: chat.model,
    drafts,
  });
  return { kept, rejected };
}
