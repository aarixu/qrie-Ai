import type { Chapter, SubjectSyllabus, Topic } from '../../../packages/syllabus/src/syllabus.ts';
import { loadSyllabus } from '../../../packages/syllabus/src/syllabus.ts';
import type { NcertBook } from './parse.ts';
import { slugify } from './parse.ts';
import type { LlmAdapter } from './llm.ts';
import { buildChapterPrompt, type ChapterPromptOptions } from './prompt.ts';

/**
 * The factory loop: prompt → LLM → validate → one repair retry → chapters.
 *
 * The validator's real job is guarding the ONE fact we actually know. NCERT's
 * catalogue gives an authoritative chapter count and nothing else; if the reply
 * does not match that count then the model has invented, merged or dropped a
 * chapter, and every lesson generated from the file afterwards would be teaching
 * a book that does not exist. So the count is checked first and the errors are
 * fed straight back as repair fuel.
 */

export type Outcome<T> = { ok: true; value: T } | { ok: false; errors: string[]; raw: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/**
 * A chapter with one topic was not decomposed — the model returned the chapter
 * title again wearing a topic costume, which yields a single unteachably large
 * lesson.
 */
const MIN_TOPICS_PER_CHAPTER = 2;

/**
 * "Student can understand photosynthesis" is the failure this catches: it reads
 * like an outcome but names nothing anyone could watch a student do. The
 * optional "Student can" prefix has to be stripped first, because that prefix is
 * exactly what the prompt asks for — the banned verb is never the first word.
 */
const VAGUE_OBJECTIVE =
  /^(?:the\s+)?(?:students?\s+(?:can|will|should|must|is\s+able\s+to)\s+)?(understands?|knows?|learns?|be\s+aware|appreciates?|masters?)\b/i;

function checkTopic(raw: unknown, at: string, errors: string[]): Topic | null {
  if (!isObj(raw)) {
    errors.push(`${at}: must be an object`);
    return null;
  }
  if (!isStr(raw.id)) {
    errors.push(`${at}: needs a non-empty id`);
    return null;
  }
  const where = `${at} ("${raw.id}")`;
  let sound = true;

  if (!isStr(raw.title)) {
    errors.push(`${where}: needs a non-empty title`);
    sound = false;
  }
  if (!Array.isArray(raw.objectives) || raw.objectives.length === 0 || !isStrArray(raw.objectives)) {
    errors.push(`${where}: needs a non-empty objectives array of non-empty strings`);
    sound = false;
  } else {
    for (const objective of raw.objectives) {
      const vague = VAGUE_OBJECTIVE.exec(objective);
      if (vague) {
        errors.push(
          `${where}: objective "${objective}" is not observable — "${vague[1]}" cannot be tested. Rewrite it starting with a verb you could watch a student do (state, identify, calculate, trace, explain...)`,
        );
        sound = false;
      }
    }
  }
  if (raw.visualIdeas !== undefined && !isStrArray(raw.visualIdeas)) {
    errors.push(`${where}: visualIdeas must be an array of non-empty strings when present`);
    sound = false;
  }
  if (
    raw.estMinutes !== undefined &&
    (typeof raw.estMinutes !== 'number' || !Number.isFinite(raw.estMinutes) || raw.estMinutes <= 0)
  ) {
    errors.push(`${where}: estMinutes must be a positive number when present`);
    sound = false;
  }

  return sound ? (raw as unknown as Topic) : null;
}

function checkChapter(raw: unknown, at: string, errors: string[]): Chapter | null {
  if (!isObj(raw)) {
    errors.push(`${at}: must be an object`);
    return null;
  }
  if (!isStr(raw.id)) {
    errors.push(`${at}: needs a non-empty id`);
    return null;
  }
  const where = `${at} ("${raw.id}")`;
  let sound = isStr(raw.title);
  if (!sound) errors.push(`${where}: needs a non-empty title`);

  if (!Array.isArray(raw.topics)) {
    errors.push(`${where}: needs a topics array`);
    return null;
  }
  if (raw.topics.length < MIN_TOPICS_PER_CHAPTER) {
    errors.push(
      `${where}: has ${raw.topics.length} topic(s). Every chapter needs at least ${MIN_TOPICS_PER_CHAPTER} — list each numbered section and sub-section the chapter prints`,
    );
    sound = false;
  }

  const seen = new Set<string>();
  raw.topics.forEach((topic, i) => {
    const topicAt = `${where}.topics[${i}]`;
    const checked = checkTopic(topic, topicAt, errors);
    if (!checked) {
      sound = false;
      return;
    }
    // A duplicate id makes two topics share one syllabus path, so getTopic could
    // only ever reach the first and the second becomes unteachable.
    if (seen.has(checked.id)) {
      errors.push(`${topicAt}: duplicate topic id "${checked.id}" within this chapter`);
      sound = false;
    }
    seen.add(checked.id);
  });

  return sound ? (raw as unknown as Chapter) : null;
}

function validateChapters(raw: unknown, book: NcertBook): { value: Chapter[] | null; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw) || !Array.isArray(raw.chapters)) {
    return { value: null, errors: ['reply must be an object with a "chapters" array'] };
  }

  // First and loudest: NCERT's count is the only fact we can actually check.
  if (raw.chapters.length !== book.chapters) {
    errors.push(
      `"${book.title}" has ${book.chapters} chapters in NCERT's catalogue but the reply has ${raw.chapters.length}. Return exactly ${book.chapters} chapters — do not merge, split, invent or drop any`,
    );
  }

  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  raw.chapters.forEach((chapter, i) => {
    const at = `chapters[${i}]`;
    const checked = checkChapter(chapter, at, errors);
    if (!checked) return;
    if (seen.has(checked.id)) {
      errors.push(`${at}: duplicate chapter id "${checked.id}"`);
      return;
    }
    seen.add(checked.id);
    chapters.push(checked);
  });

  return errors.length > 0 ? { value: null, errors } : { value: chapters, errors: [] };
}

export async function generateChapters(
  book: NcertBook,
  adapter: LlmAdapter,
  opts: ChapterPromptOptions,
): Promise<Outcome<Chapter[]>> {
  const { system, user } = buildChapterPrompt(book, opts);

  const first = await adapter.complete(system, user);
  const attempt = parse(first, (json) => validateChapters(json, book));
  if (attempt.ok) return attempt;

  // ONE repair retry. The model sees its own reply and the validator's exact
  // complaints — far more useful than asking it to "try again".
  const repair = [
    user,
    '',
    'Your previous reply was:',
    first,
    '',
    'It failed validation with these errors. Fix every one and reply with the corrected JSON only:',
    attempt.errors.map((e) => `- ${e}`).join('\n'),
  ].join('\n');

  const second = await adapter.complete(system, repair);
  return parse(second, (json) => validateChapters(json, book));
}

/** The file id a class+subject is written under, e.g. "class10-science". */
export function syllabusIdFor(book: NcertBook): string {
  return `class${book.klass}-${slugify(book.subject)}`;
}

/**
 * Merge a freshly generated book into whatever is already on disk.
 *
 * Chapters are keyed by id: a regenerated chapter replaces its old self, and
 * every chapter that came from another book of the same subject or an earlier
 * run is left untouched. That is what makes a re-run fill gaps — pulling Class
 * 12 Mathematics Part-II must not wipe out Part-I.
 *
 * The merged result goes back through loadSyllabus rather than being trusted,
 * for the same reason the graph factory re-validates after a merge: the pieces
 * were each valid, the union still has to be.
 */
export function mergeIntoSyllabus(
  existing: SubjectSyllabus | null,
  book: NcertBook,
  incoming: Chapter[],
): Outcome<SubjectSyllabus> {
  const byId = new Map<string, Chapter>();
  for (const chapter of existing?.chapters ?? []) byId.set(chapter.id, chapter);
  for (const chapter of incoming) byId.set(chapter.id, chapter);

  /*
   * Ordering. Three cases, and NCERT's own chapter count tells them apart.
   *
   * A FULL book (incoming covers every chapter NCERT lists) is an authoritative
   * statement of the order, and that order is pedagogically load-bearing: later
   * chapters rest on earlier ones and the Learning Outcome Map draws its
   * prerequisite edges along that grain. So incoming order wins, and anything
   * already on disk that this book does not mention — an earlier Part-I, or
   * hand-authored work — keeps its relative order in front.
   *
   * A PARTIAL batch is a regeneration of some chapters, not a re-statement of
   * the book, so it must not shuffle the file: existing chapters hold their
   * positions and are replaced in place, and genuinely new ones append.
   *
   * Plain insertion order satisfies neither: it pinned a hand-authored Life
   * Processes to the front, ahead of the four NCERT chapters that precede it.
   */
  const incomingIds = new Set(incoming.map((c) => c.id));
  const isFullBook = incoming.length === book.chapters;

  const order = isFullBook
    ? [
        ...(existing?.chapters ?? []).map((c) => c.id).filter((id) => !incomingIds.has(id)),
        ...incoming.map((c) => c.id),
      ]
    : [
        ...(existing?.chapters ?? []).map((c) => c.id),
        ...incoming.map((c) => c.id).filter((id) => !(existing?.chapters ?? []).some((c) => c.id === id)),
      ];

  const merged = {
    id: syllabusIdFor(book),
    klass: book.klass,
    subject: book.subject,
    chapters: order.map((id) => byId.get(id)!),
  };

  try {
    return { ok: true, value: loadSyllabus(merged) };
  } catch (e) {
    return {
      ok: false,
      errors: [`merged syllabus is invalid: ${e instanceof Error ? e.message : String(e)}`],
      raw: '',
    };
  }
}

/**
 * Parse the reply, then hand it to a validator. A parse failure is reported the
 * same way a validation failure is, so both take the same repair path.
 */
function parse<T>(
  raw: string,
  validate: (json: unknown) => { value: T | null; errors: string[] },
): Outcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`reply is not valid JSON: ${(e as Error).message}`], raw };
  }
  const { value, errors } = validate(json);
  return value ? { ok: true, value } : { ok: false, errors, raw };
}
