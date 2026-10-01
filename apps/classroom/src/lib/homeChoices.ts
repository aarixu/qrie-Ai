/**
 * WHAT HOME OFFERS A STUDENT, SCOPED TO THEIR CLASS AND THEIR SUBJECTS.
 *
 * The Respiration bug (Aarav, 2026-09-30): he chose Class 8 Science, pressed
 * "Start Learning" and got Respiration, a Class 10 lesson. The button opened
 * the FIRST catalogue entry whatever the student's class, and the subject
 * tiles listed every subject of every class and opened chapter one of the
 * lowest class that had it. Every choice below starts from the student's
 * class and the subjects they picked at onboarding, and never reaches into
 * another class: when their class has nothing ready, the answer is a class
 * prepared for their own topic, or the syllabus page — not someone else's
 * lesson.
 *
 * Pure, over the shapes Home already holds, so the rules are tested without
 * rendering Home.
 */

export interface SyllabusLike {
  id: string;
  klass: number;
  subject: string;
  chapters: readonly { id: string; topics: readonly { id: string }[] }[];
}

export interface CatalogEntryLike {
  id: string;
  class: number;
  subject: string;
  topicRef?: string;
}

/** Their class's syllabi, in the student's subject order when they chose subjects. */
function mine<S extends SyllabusLike>(syllabi: readonly S[], klass: number | null, subjects: readonly string[]): S[] {
  const ofClass = syllabi.filter((s) => klass === null || s.klass === klass);
  if (subjects.length === 0) return ofClass;
  return subjects.flatMap((subject) => ofClass.filter((s) => s.subject === subject));
}

/**
 * The lesson "Start Learning" opens when nothing is in progress: the first
 * catalogue entry of their class in a subject they chose (any subject of
 * their class when they chose none). Null when their class has none — the
 * caller then prepares their own first topic rather than open another class.
 */
export function firstLessonFor<E extends CatalogEntryLike>(
  catalog: readonly E[] | null,
  klass: number | null,
  subjects: readonly string[],
): E | null {
  if (!catalog || klass === null) return null;
  const ofClass = catalog.filter((e) => e.class === klass);
  if (subjects.length === 0) return ofClass[0] ?? null;
  for (const subject of subjects) {
    const found = ofClass.find((e) => e.subject === subject);
    if (found) return found;
  }
  return null;
}

/** The first topic of their class and first chosen subject, as a class route; the syllabus page when none. */
export function firstTopicFor(syllabi: readonly SyllabusLike[], klass: number | null, subjects: readonly string[]): string {
  for (const syllabus of mine(syllabi, klass, subjects)) {
    for (const chapter of syllabus.chapters) {
      const topic = chapter.topics[0];
      if (topic) return `/class/${syllabus.id}/${chapter.id}/${topic.id}`;
    }
  }
  return '/syllabus';
}

/**
 * The subject tiles: the subjects they chose that their class has, in their
 * order; every subject of their class when they chose none; and every subject
 * there is only when no class is on file (an old profile), as before.
 */
export function subjectsFor(syllabi: readonly SyllabusLike[], klass: number | null, subjects: readonly string[]): string[] {
  const offered = Array.from(new Set(syllabi.filter((s) => klass === null || s.klass === klass).map((s) => s.subject)));
  if (klass === null || subjects.length === 0) return offered;
  const chosen = subjects.filter((s) => offered.includes(s));
  return chosen.length > 0 ? chosen : offered;
}

const syllabusOf = (syllabi: readonly SyllabusLike[], klass: number | null, subject: string): SyllabusLike[] =>
  syllabi.filter((s) => s.subject === subject && (klass === null || s.klass === klass));

/** Chapter one of their class's syllabus for this subject, or null. */
export function chapterPathFor(syllabi: readonly SyllabusLike[], klass: number | null, subject: string): string | null {
  const syllabus = syllabusOf(syllabi, klass, subject)[0];
  const chapter = syllabus?.chapters[0];
  return syllabus && chapter ? `/chapter/${syllabus.id}/${chapter.id}` : null;
}

/** How many chapters this subject has in their class. */
export function chapterCountFor(syllabi: readonly SyllabusLike[], klass: number | null, subject: string): number {
  return syllabusOf(syllabi, klass, subject).reduce((n, s) => n + s.chapters.length, 0);
}

/**
 * With the prototype gate on: the first chapter of THEIR class's syllabus for
 * this subject that holds a class somebody can open, or null.
 */
export function readyChapterFor(
  syllabi: readonly SyllabusLike[],
  warmRefs: ReadonlySet<string | undefined>,
  klass: number | null,
  subject: string,
): string | null {
  for (const s of syllabusOf(syllabi, klass, subject)) {
    for (const c of s.chapters) {
      if (c.topics.some((t) => warmRefs.has(`${s.id}/${c.id}/${t.id}`))) return `/chapter/${s.id}/${c.id}`;
    }
  }
  return null;
}
