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

/**
 * STUB — replaced by the syllabus builder. Validates shape; throws with a
 * specific message on malformed input.
 */
export function loadSyllabus(_json: unknown): SubjectSyllabus {
  throw new Error('@ai-tutor/syllabus loadSyllabus: not implemented yet');
}

/** path = "<syllabusId>/<chapterId>/<topicId>" */
export function getTopic(_s: SubjectSyllabus, _path: string): Topic | null {
  throw new Error('@ai-tutor/syllabus getTopic: not implemented yet');
}

export function listTopics(_s: SubjectSyllabus): { path: string; topic: Topic }[] {
  throw new Error('@ai-tutor/syllabus listTopics: not implemented yet');
}
