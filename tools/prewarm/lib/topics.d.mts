/**
 * THE CONTRACT `topics.mjs` HAS, WRITTEN DOWN SO TYPESCRIPT CAN READ IT.
 *
 * The runner is plain .mjs on purpose — it is a Node CLI that drives the same
 * class-prep pipeline the browser does, and it has no business in the app's
 * build. But its tests are .ts and live under `tools/**\/*.ts`, which the
 * workspace tsconfig includes, so without this file every import from the lib
 * is an implicit `any` and `noImplicitAny` says so.
 *
 * Hand-written rather than generated, and that is the point: it is the only
 * place the lib's shape is stated, so it doubles as the lib's documentation
 * and it drifts loudly (a .ts test stops compiling) rather than quietly.
 */

/** The two syllabi MVP-1 warms, and nothing else. */
export declare const ALL_CLASS_9_10_SCIENCE: readonly string[];

/** Outcomes are capped per topic so one dense node cannot swamp a planner. */
export declare const MAX_OUTCOMES: number;

/** One outcome a topic maps to, as the planner wants it. */
export interface OutcomeRow {
  id: string;
  /** The node's `outcome` text — what the student should be able to do. */
  statement: string;
}

/** One preparable topic: the join key the whole product turns on. */
export interface TopicRow {
  /** `<syllabus>/<chapter>/<topic>` — a topicRef, never a derived class id. */
  path: string;
  /** The syllabus's own topic object, carried whole rather than flattened. */
  topic: { id: string; title: string; objectives: string[]; [key: string]: unknown };
  chapterId: string;
  chapterTitle: string;
  syllabusId: string;
  /** The syllabus header rides along, because SaveMeta needs both. */
  klass: number;
  subject: string;
}

/** Narrow a run to one chapter or one topic. Absent means the whole syllabus. */
export interface TopicFilter {
  chapter?: string;
  topic?: string;
}

/** Throws, naming the id, when the syllabus is not one this repo ships. */
export declare function loadSyllabusById(id: string): unknown;

/** Every topic in a syllabus, filtered. Throws naming a filter that matches nothing. */
export declare function topicsFor(syllabusId: string, filter?: TopicFilter): TopicRow[];

/**
 * The outcomes a topicRef maps to, easiest first, capped at MAX_OUTCOMES.
 * An unmapped ref — or no ref at all — is an empty list, never an error: the
 * catalogue is wider than the outcome map and a gap must not stop a warm run.
 */
export declare function outcomesFor(topicRef: string | undefined): OutcomeRow[];
