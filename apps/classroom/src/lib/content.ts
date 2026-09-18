import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { loadSyllabus, getTopic, type SubjectSyllabus, type Topic } from '@ai-tutor/syllabus';
import { supabase } from './supabase';
import { profileStore } from '../stores/profile';

/** Where a public bucket's files are served from, for the project we are on. */
const supabaseStorageBase = (): string =>
  `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/storage/v1/object/public`;

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

/**
 * EVERY CLASS THAT EXISTS — the authored ones and the ones the tutor made.
 *
 * Two sources, because they arrive two ways. The authored lessons are files in
 * content/, shipped with the app and available offline. A class prepared live
 * is written to Storage and its catalogue row to Postgres, so that a topic one
 * student paid to prepare is free for everyone after — which is the whole
 * point of the second query, because that sharing is what divides a
 * preparation's cost by the number of students who arrive at the topic.
 *
 * This sentence carried "fifty seconds and ₹2.25" until now. That is an
 * OpenRouter-era price for a class with NO pictures, and the billing path
 * moved underneath it: Vertex charges a generated picture as output tokens,
 * and the same text-only class measured ₹9.08 on 2026-09-13
 * (docs/architecture/README.md:183). With the three or four pictures a real
 * class carries at about ₹5.75 each, every document here plans on ₹30 a topic
 * (docs/prd/6-cost-monetisation-ops.md:573, band ₹26-40). Quote that, not a
 * number this file used to keep.
 *
 * The kept ones are a BONUS, not a requirement: if that query fails — offline,
 * signed out, the project unreachable — the app carries on with the lessons it
 * shipped with, and a topic that was already prepared simply looks cold and is
 * prepared again. A worse day, not a broken app. So this never throws for the
 * second half.
 */
/**
 * Long enough for a slow phone, short enough not to be a hang.
 *
 * A REJECTED request already degrades gracefully; a STALLED one does not, and
 * this sits in front of the home screen and in front of LiveClass's decision
 * about whether a topic is warm. Waiting forever there is a student looking at
 * a spinner because a socket never closed.
 */
const KEPT_TIMEOUT_MS = 4000;

/**
 * How far back the catalogue reaches.
 *
 * The placement test looks two classes behind the student's own, so a Class 9
 * student can be sent to a Class 7 lesson. Anything outside that window is
 * rows nobody on this device will open — and the whole table on every
 * catalogue read is a query that grows with the curriculum forever.
 */
const LOOK_BACK_CLASSES = 2;

async function fetchKeptClasses(): Promise<CatalogEntry[]> {
  const db = supabase();
  if (!db) return [];

  const mine = profileStore.get().klass;
  let query = db.from('prepared_class').select('id, topic_ref, title, subtitle, klass, subject');
  if (mine !== null) query = query.lte('klass', mine).gte('klass', mine - LOOK_BACK_CLASSES);

  const answered = await Promise.race([
    query,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), KEPT_TIMEOUT_MS)),
  ]);
  if (!answered) return [];
  const { data, error } = answered;
  if (error || !data) return [];

  return (data as {
    id: string;
    topic_ref: string;
    title: string;
    subtitle: string | null;
    klass: number;
    subject: string;
  }[]).map((row) => ({
    id: row.id,
    title: row.title,
    ...(row.subtitle ? { subtitle: row.subtitle } : {}),
    class: row.klass,
    subject: row.subject,
    // An ABSOLUTE url, unlike an authored lesson's repo-relative path. fetchLesson
    // below tells them apart, so nothing else has to know where a class came from.
    path: `${supabaseStorageBase()}/classes/${row.id}/lesson.json`,
    topicRef: row.topic_ref,
  }));
}

export async function fetchCatalog(): Promise<CatalogEntry[]> {
  if (catalogCache) return catalogCache;
  const doc = (await (await fetch('/index.json')).json()) as { lessons: CatalogEntry[] };

  const kept = await fetchKeptClasses();
  // Authored first, and an authored lesson wins a clash: a hand-written class
  // is somebody's deliberate work and a prepared one is a cache of the first
  // time nobody had written it.
  const seen = new Set(doc.lessons.map((l) => l.id));
  catalogCache = [...doc.lessons, ...kept.filter((k) => !seen.has(k.id))];
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
  `${isAbsolute(entry.path) ? '' : '/'}${entry.path.replace(/\/[^/]+$/, '')}/audio`;

/**
 * A class kept in Storage carries a whole URL; an authored one carries a path
 * relative to the static root. One character of difference, in one place.
 */
const isAbsolute = (path: string): boolean => /^https?:\/\//.test(path);

export const lessonUrl = (entry: CatalogEntry): string =>
  isAbsolute(entry.path) ? entry.path : `/${entry.path}`;

/**
 * THE PICTURES INSIDE A CLASS THAT LIVES SOMEWHERE ELSE.
 *
 * saveable() writes each generated picture's src as "/<id>/generated/<el>.png"
 * — absolute from the static root, which is right for a class in content/ and
 * wrong for one served out of Storage. The lesson, the audio and the inlined
 * markup all learned to handle a whole URL; the lesson's own `src` values did
 * not, so on a cloud-served class every picture asked this origin for a file
 * it does not have and got the SPA fallback's index.html back.
 *
 * Rewritten on the way in rather than at each of the places that draw one:
 * Scene takes an element and has no idea where its lesson came from, and it
 * should not have to.
 */
function pointAtItsOwnFolder(lesson: Lesson, entry: CatalogEntry): Lesson {
  if (!isAbsolute(entry.path)) return lesson;
  const folder = entry.path.replace(/\/[^/]+$/, '');

  return {
    ...lesson,
    elements: lesson.elements.map((el) => {
      if (!('src' in el) || typeof el.src !== 'string' || !el.src.startsWith('/')) return el;
      // "/<id>/generated/x.png" -> "<storage folder>/generated/x.png". The id
      // segment is dropped because the folder already ends with it.
      const withoutId = el.src.replace(/^\/[^/]+\//, '');
      return { ...el, src: `${folder}/${withoutId}` };
    }),
  };
}

export async function fetchLesson(entry: CatalogEntry): Promise<Lesson> {
  const raw = await (await fetch(lessonUrl(entry))).json();
  const result = validateLesson(raw);
  if (!result.ok) {
    // Specific errors go to the console for the author; the caller shows a
    // friendly message. Broken content must never take the classroom down.
    console.error(`[content] "${entry.id}" failed validation:`, result.errors);
    throw new Error(`Lesson "${entry.title}" is not available right now.`);
  }
  return pointAtItsOwnFolder(result.lesson, entry);
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
