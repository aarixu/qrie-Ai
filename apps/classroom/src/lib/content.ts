import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { loadSyllabus, getTopic, type SubjectSyllabus, type Topic } from '@ai-tutor/syllabus';

/**
 * The app's content access layer: joins the lesson catalog (content/index.json,
 * served statically) with the syllabus tree (packages/syllabus/data). The join
 * key is `topicRef` — a topic with no matching lesson is "coming soon", so
 * content grows with zero code changes.
 */

export interface CatalogEntry {
  id: string;
  title: string;
  subtitle?: string;
  class: number;
  subject: string;
  path: string;
  topicRef?: string;
  status?: string;
}

export interface TopicRow {
  path: string;
  topic: Topic;
  /**
   * Every lesson that teaches this topic, in catalogue order.
   *
   * Plural because NCERT's sections are coarser than our lessons: its single
   * "Transportation in Human Beings" covers both the heart and blood, which we
   * teach as two lessons. Collapsing that to one would orphan the other.
   */
  lessons: CatalogEntry[];
}

/**
 * Every authored syllabus, loaded eagerly at build time. The glob is the
 * point: adding a fourteenth class to packages/syllabus/data changes this
 * array without anyone remembering to edit an import list — the app once
 * imported exactly one file here, and a Class 7 student was quietly shown
 * Class 10 Science because of it.
 */
const syllabusModules = import.meta.glob('../../../../packages/syllabus/data/*.json', {
  eager: true,
}) as Record<string, { default: unknown }>;

export const SYLLABI: SubjectSyllabus[] = Object.values(syllabusModules)
  .map((m) => loadSyllabus(m.default))
  .sort((a, b) => a.klass - b.klass || a.subject.localeCompare(b.subject));

/** The subjects a class can actually study — the ones with an authored syllabus. */
export const subjectsAvailable = (klass: number): string[] =>
  Array.from(new Set(SYLLABI.filter((s) => s.klass === klass).map((s) => s.subject)));

let catalogCache: CatalogEntry[] | null = null;

export async function fetchCatalog(): Promise<CatalogEntry[]> {
  if (catalogCache) return catalogCache;
  const doc = (await (await fetch('/index.json')).json()) as { lessons: CatalogEntry[] };
  catalogCache = doc.lessons;
  return catalogCache;
}

/**
 * Where a lesson's recorded narration sits, next to its lesson.json.
 *
 * Derived from the entry's path rather than the lesson id, because the id is
 * ours and the path is the content author's — and it is the author who decides
 * what a lesson folder is called.
 */
export const lessonAudioUrl = (entry: CatalogEntry): string =>
  `/${entry.path.replace(/\/[^/]+$/, '')}/audio`;

export async function fetchLesson(entry: CatalogEntry): Promise<Lesson> {
  const raw = await (await fetch(`/${entry.path}`)).json();
  const result = validateLesson(raw);
  if (!result.ok) {
    // Specific errors go to the console for the author; the caller shows a
    // friendly message. Broken content must never take the classroom down.
    console.error(`[content] "${entry.id}" failed validation:`, result.errors);
    throw new Error(`Lesson "${entry.title}" is not available right now.`);
  }
  return result.lesson;
}

export async function findEntry(lessonId: string): Promise<CatalogEntry | null> {
  return (await fetchCatalog()).find((e) => e.id === lessonId) ?? null;
}

/** A chapter's topics joined with their lessons, in syllabus order. */
export async function topicsOf(syllabus: SubjectSyllabus, chapterId: string): Promise<TopicRow[]> {
  const catalog = await fetchCatalog();
  const chapter = syllabus.chapters.find((c) => c.id === chapterId);
  if (!chapter) return [];
  return chapter.topics.map((topic) => {
    const path = `${syllabus.id}/${chapterId}/${topic.id}`;
    return { path, topic, lessons: catalog.filter((e) => e.topicRef === path) };
  });
}

/** The next teachable topic after this lesson in the same chapter, for the Complete screen. */
export async function nextLessonAfter(lessonId: string): Promise<CatalogEntry | null> {
  const entry = await findEntry(lessonId);
  if (!entry?.topicRef) return null;
  const [syllabusId, chapterId] = entry.topicRef.split('/');
  const syllabus = SYLLABI.find((s) => s.id === syllabusId);
  if (!syllabus) return null;
  const rows = await topicsOf(syllabus, chapterId);
  const i = rows.findIndex((r) => r.path === entry.topicRef);
  // Later lessons under the SAME topic come first — finishing the heart lesson
  // should offer blood, not skip to the next section.
  const here = rows[i]?.lessons ?? [];
  const after = here.slice(here.findIndex((l) => l.id === lessonId) + 1);
  if (after.length > 0) return after[0];
  return rows.slice(i + 1).flatMap((r) => r.lessons)[0] ?? null;
}

/**
 * A topic, found by the same `topicRef` the catalogue joins on.
 *
 * The syllabus is the source of what may be taught; the catalogue is the
 * record of what HAS been taught and kept. A topic in the first and not the
 * second is a cold topic — nobody has had this class yet, so the first student
 * to ask for it has it prepared live.
 */
export function findTopic(
  topicRef: string,
): { topic: Topic; syllabus: SubjectSyllabus; chapterTitle: string } | null {
  const [syllabusId, chapterId] = topicRef.split('/');
  const syllabus = SYLLABI.find((s) => s.id === syllabusId);
  if (!syllabus) return null;
  const topic = getTopic(syllabus, topicRef);
  if (!topic) return null;
  const chapter = syllabus.chapters.find((c) => c.id === chapterId);
  return { topic, syllabus, chapterTitle: chapter?.title ?? '' };
}

/**
 * Drop the remembered catalogue.
 *
 * Called after a live class is saved: the copy in memory was read before that
 * class existed and still says its topic is cold, so the next visit would
 * prepare it a second time and be refused as a duplicate.
 */
export function forgetCatalog(): void {
  catalogCache = null;
}
