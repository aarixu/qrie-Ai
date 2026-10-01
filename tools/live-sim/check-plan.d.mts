/**
 * THE CONTRACT `check-plan.mjs` HAS, for its TypeScript test. The same
 * pattern as tools/prewarm/lib/*.d.mts: the script is plain JS so `node` runs
 * it with no build, and this file is what `tsc` checks its callers against.
 */

export declare const DEFAULT_PLAN: string;

export declare const RULES: {
  ideas: [number, number];
  points: [number, number];
  check: [number, number];
  misconceptions: [number, number];
  alternates: [number, number];
  recapPrompts: [number, number];
  facts: [number, number];
  workedSteps: [number, number];
  pointSaySentences: [number, number];
  questionSentences: { opener: number; predict: number; check: number; teachBack: number };
  maxSentenceWords: number;
  keyTermsMax: number;
};

export interface GraphNode {
  id: string;
  topicRef?: string;
  title?: string;
  [key: string]: unknown;
}

export interface PlanContext {
  /** The board lesson, or null when content/<boardLessonId>/lesson.json does not exist. */
  lesson: unknown;
  graph: Map<string, GraphNode>;
}

export interface PlanCheck {
  errors: string[];
  warnings: string[];
  /** Overlaps that are not errors, for a human to read. */
  notes: string[];
  counts: { ideas: number; questions: number; facts: number };
}

export declare function sentences(text: string): string[];

export declare function fold(token: string): string;

export declare function keyTerms(q: { question: string; expect: string; answer: string }): string[];

export declare function sameMove(
  opener: unknown,
  ideas: unknown[],
  guard: (line: unknown, q: unknown, where: string) => void,
): void;

export declare function loadGraphNodes(): Map<string, GraphNode>;

export declare function loadPlanContext(planPath?: string): {
  file: string;
  plan: unknown;
  context: PlanContext;
};

export declare function checkPlan(plan: unknown, context: PlanContext): PlanCheck;
