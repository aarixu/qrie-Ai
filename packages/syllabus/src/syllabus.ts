export interface Topic {
  id: string;
  title: string;
  /** "Student can explain why..." — these drive the LLM lesson designer. */
  objectives: string[];
  /** Topic paths this one builds on. */
  prerequisites?: string[];
  /** Hints for the designer's canvas plan. */
  visualIdeas?: string[];
  estMinutes?: number;
}

export interface Chapter {
  id: string;
  title: string;
  topics: Topic[];
}

export interface SubjectSyllabus {
  /** e.g. "class10-science" */
  id: string;
  /** 6..12 ("class" is a reserved word, hence klass). */
  klass: number;
  subject: string;
  chapters: Chapter[];
}

/*
 * Validation is fail-fast (throw on the FIRST problem) rather than
 * error-collecting like lesson-format's validateLesson: a syllabus file is
 * hand-authored data committed to the repo, so one precise message pointing
 * at the offending path is what a human fixing the file needs.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function fail(path: string, msg: string): never {
  throw new Error(`syllabus ${path}: ${msg}`);
}

function checkTopic(topic: unknown, path: string): void {
  if (!isObj(topic)) fail(path, 'must be an object');
  if (!isStr(topic.id)) fail(path, 'topic needs a non-empty id');
  if (!isStr(topic.title)) fail(`${path} ("${topic.id}")`, 'topic needs a non-empty title');
  if (!Array.isArray(topic.objectives) || topic.objectives.length === 0 || !isStrArray(topic.objectives)) {
    fail(`${path} ("${topic.id}")`, 'objectives must be a non-empty array of non-empty strings');
  }
  if (topic.prerequisites !== undefined && !isStrArray(topic.prerequisites)) {
    fail(`${path} ("${topic.id}")`, 'prerequisites must be an array of non-empty topic paths when present');
  }
  if (topic.visualIdeas !== undefined && !isStrArray(topic.visualIdeas)) {
    fail(`${path} ("${topic.id}")`, 'visualIdeas must be an array of non-empty strings when present');
  }
  if (topic.estMinutes !== undefined && (typeof topic.estMinutes !== 'number' || !Number.isFinite(topic.estMinutes) || topic.estMinutes <= 0)) {
    fail(`${path} ("${topic.id}")`, 'estMinutes must be a positive number when present');
  }
}

function checkChapter(chapter: unknown, path: string): void {
  if (!isObj(chapter)) fail(path, 'must be an object');
  if (!isStr(chapter.id)) fail(path, 'chapter needs a non-empty id');
  if (!isStr(chapter.title)) fail(`${path} ("${chapter.id}")`, 'chapter needs a non-empty title');
  if (!Array.isArray(chapter.topics) || chapter.topics.length === 0) {
    fail(`${path} ("${chapter.id}")`, 'chapter needs a non-empty topics array');
  }
  // Duplicate ids would make two topics share one path — getTopic could only
  // ever reach the first, so the second would be silently unteachable.
  const seen = new Set<string>();
  chapter.topics.forEach((topic, i) => {
    const topicPath = `${path}.topics[${i}]`;
    checkTopic(topic, topicPath);
    const id = (topic as Topic).id;
    if (seen.has(id)) fail(topicPath, `duplicate topic id "${id}"`);
    seen.add(id);
  });
}

/** Validates shape; throws with a specific message on the first problem found. */
export function loadSyllabus(json: unknown): SubjectSyllabus {
  if (!isObj(json)) throw new Error('syllabus must be a JSON object');
  if (!isStr(json.id)) throw new Error('syllabus needs a non-empty id');
  if (typeof json.klass !== 'number' || !Number.isInteger(json.klass) || json.klass < 6 || json.klass > 12) {
    fail(`"${json.id}"`, 'klass must be an integer from 6 to 12');
  }
  if (!isStr(json.subject)) fail(`"${json.id}"`, 'needs a non-empty subject');
  if (!Array.isArray(json.chapters) || json.chapters.length === 0) {
    fail(`"${json.id}"`, 'needs a non-empty chapters array');
  }
  const seen = new Set<string>();
  json.chapters.forEach((chapter, i) => {
    const chapterPath = `chapters[${i}]`;
    checkChapter(chapter, chapterPath);
    const id = (chapter as Chapter).id;
    if (seen.has(id)) fail(chapterPath, `duplicate chapter id "${id}"`);
    seen.add(id);
  });
  return json as unknown as SubjectSyllabus;
}

/** path = "<syllabusId>/<chapterId>/<topicId>" — null when any segment misses. */
export function getTopic(s: SubjectSyllabus, path: string): Topic | null {
  const parts = path.split('/');
  if (parts.length !== 3) return null;
  const [syllabusId, chapterId, topicId] = parts;
  if (syllabusId !== s.id) return null;
  const chapter = s.chapters.find((c) => c.id === chapterId);
  if (!chapter) return null;
  return chapter.topics.find((t) => t.id === topicId) ?? null;
}

/** Every topic with its full path, in declaration order. */
export function listTopics(s: SubjectSyllabus): { path: string; topic: Topic }[] {
  return s.chapters.flatMap((chapter) =>
    chapter.topics.map((topic) => ({ path: `${s.id}/${chapter.id}/${topic.id}`, topic })),
  );
}
