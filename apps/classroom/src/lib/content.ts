import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { loadSyllabus, type SubjectSyllabus, type Topic } from '@ai-tutor/syllabus';
// Syllabus data ships with the syllabus package; the app just imports it.
import class10ScienceJson from '../../../../packages/syllabus/data/class10-science.json';

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

export const SYLLABI: SubjectSyllabus[] = [loadSyllabus(class10ScienceJson)];

let catalogCache: CatalogEntry[] | null = null;

export async function fetchCatalog(): Promise<CatalogEntry[]> {
  if (catalogCache) return catalogCache;
  const doc = (await (await fetch('/index.json')).json()) as { lessons: CatalogEntry[] };
  catalogCache = doc.lessons;
  return catalogCache;
}

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
