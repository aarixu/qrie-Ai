import type { KnowledgeGraph, LearningNode, Probe, ProbeBank } from '@ai-tutor/knowledge-graph';
// Same reason as lib/diagnosticData.ts: Vite serves `content/` as publicDir, so
// `packages/` is never reachable over HTTP. The map and the probe bank have to
// be bundled, and a quiz has to be in hand the instant the lesson ends.
import class10ScienceGraph from '../../../../packages/knowledge-graph/data/class10-science.json';
import class10ScienceProbes from '../../../../packages/knowledge-graph/data/class10-science.probes.json';

/**
 * The practice quiz: pure logic, no React, no clock, no randomness.
 *
 * Questions are NOT new content. They are the diagnostic's own probes, filtered
 * to the nodes a given lesson teaches — so a quiz can only ask about what the
 * student was actually taught, and every question already carries a reviewed
 * correct answer and, per wrong option, a NAMED MISCONCEPTION. That name is the
 * point of the whole screen: "you got 6 of 8" is a score, "you mixed up atria
 * and ventricles" is a next step.
 */

/** One quiz question — a probe joined to the node it tests. */
export interface QuizQuestion {
  /** The probe id; stable across builds, so an attempt can be traced back. */
  id: string;
  nodeId: string;
  /** The node's title, e.g. "Atria receive, ventricles pump" — names the skill. */
  title: string;
  question: string;
  options: string[];
  correctIndex: number;
  /** Aligned to `options`; the correct index holds ''. */
  misconceptions: string[];
  lessonRef: string;
}

/** What the student did on one question. Aligned to the questions by position. */
export interface QuizAnswer {
  /** Index into `options`, or null if the question was left unanswered. */
  chosenIndex: number | null;
  /** Time on this question. The screen holds the clock; this file stays pure. */
  ms: number;
}

/** One graded question, in the order it was asked. */
export interface QuizResultRow {
  questionId: string;
  nodeId: string;
  title: string;
  question: string;
  chosenIndex: number | null;
  correctIndex: number;
  correct: boolean;
  /**
   * The named misconception behind THIS wrong answer, or null when the answer
   * was right, was skipped, or the bank does not name one for that option.
   */
  misconception: string | null;
}

export interface QuizOutcome {
  lessonRef: string;
  score: number;
  total: number;
  rows: QuizResultRow[];
  elapsedMs: number;
  /** Longest unbroken run of correct answers — what the result screen celebrates. */
  bestStreak: number;
}

export interface QuizOptions {
  /** Most questions to ask. A quiz longer than this stops being practice. */
  limit?: number;
  /** Below this many available questions there is no quiz at all. */
  minimum?: number;
}

/**
 * Three is the floor because a two-question quiz reports 0%, 50% or 100% —
 * noise, not a signal — and padding it with probes from other lessons would
 * mark a student wrong on something this lesson never taught.
 */
export const MIN_QUESTIONS = 3;

/** Eight matches the Stitch design's "QUESTION 3 OF 8" and one sitting's attention. */
export const DEFAULT_LENGTH = 8;

/**
 * Every map the app ships. One entry per class; adding a class is one line.
 * The `as` casts are the usual JSON-module widening — a literal `1` version
 * becomes `number` — and the shapes themselves are checked by the
 * knowledge-graph package's own tests against these very files.
 */
const SOURCES: { graph: KnowledgeGraph; bank: ProbeBank }[] = [
  {
    graph: class10ScienceGraph as unknown as KnowledgeGraph,
    bank: class10ScienceProbes as ProbeBank,
  },
];

interface Catalogue {
  node(id: string): LearningNode | undefined;
  probes: Probe[];
}

// Built once: the join is over every probe in every map, and buildQuiz runs on
// every lesson-complete.
let catalogue: Catalogue | null = null;

function load(): Catalogue {
  if (catalogue) return catalogue;
  const nodes = new Map<string, LearningNode>();
  const probes: Probe[] = [];
  for (const source of SOURCES) {
    for (const node of source.graph.nodes) nodes.set(node.id, node);
    probes.push(...source.bank.probes);
  }
  catalogue = { node: (id) => nodes.get(id), probes };
  return catalogue;
}

/**
 * The questions for one lesson, or null when there aren't enough to be worth
 * asking — the caller then skips practice rather than showing a thin quiz.
 *
 * Deterministic by construction: easiest node first, ties broken by probe id.
 * A quiz that reshuffles on every render cannot be debugged, and a student
 * retrying after a bad score deserves the same test back, not a different one.
 * There is no Math.random in this file, deliberately.
 */
export function buildQuiz(lessonRef: string, options: QuizOptions = {}): QuizQuestion[] | null {
  const { limit = DEFAULT_LENGTH, minimum = MIN_QUESTIONS } = options;
  const { node, probes } = load();

  const available: QuizQuestion[] = [];
  for (const probe of probes) {
    const learningNode = node(probe.nodeId);
    // A probe whose node this lesson does not teach is a question about
    // something the student was never shown.
    if (!learningNode || learningNode.lessonRef !== lessonRef) continue;
    available.push({
      id: probe.id,
      nodeId: probe.nodeId,
      title: learningNode.title,
      question: probe.question,
      options: probe.options,
      correctIndex: probe.correctIndex,
      // Absent misconceptions are normal in a hand-authored bank; the grader
      // reports "no named misconception" rather than crashing on an index.
      misconceptions: probe.misconceptions ?? [],
      lessonRef,
    });
  }

  if (available.length < minimum) return null;

  available.sort(
    (a, b) =>
      (node(a.nodeId)?.difficulty ?? 0) - (node(b.nodeId)?.difficulty ?? 0) ||
      a.id.localeCompare(b.id),
  );
  return available.slice(0, limit);
}

/**
 * Grades an attempt. `answers` is positional: answers[i] belongs to
 * questions[i]. A short array is a quiz left unfinished, and the missing
 * questions count as unanswered rather than as wrong-by-omission being hidden.
 */
export function gradeQuiz(questions: QuizQuestion[], answers: QuizAnswer[]): QuizOutcome {
  let score = 0;
  let elapsedMs = 0;
  let run = 0;
  let bestStreak = 0;

  const rows = questions.map((question, i) => {
    const answer = answers[i] ?? { chosenIndex: null, ms: 0 };
    const correct = answer.chosenIndex === question.correctIndex;

    if (correct) {
      score += 1;
      run += 1;
      // Tracked as the run grows, so a run that ends at the last question is
      // still counted — a final check after the loop would be easy to lose.
      bestStreak = Math.max(bestStreak, run);
    } else {
      run = 0;
    }
    elapsedMs += answer.ms;

    const named =
      !correct && answer.chosenIndex !== null
        ? (question.misconceptions[answer.chosenIndex] ?? '')
        : '';

    return {
      questionId: question.id,
      nodeId: question.nodeId,
      title: question.title,
      question: question.question,
      chosenIndex: answer.chosenIndex,
      correctIndex: question.correctIndex,
      correct,
      misconception: named === '' ? null : named,
    };
  });

  return {
    lessonRef: questions[0]?.lessonRef ?? '',
    score,
    total: questions.length,
    rows,
    elapsedMs,
    bestStreak,
  };
}

/**
 * "4m 20s" / "45s". Seconds are dropped above an hour: a practice quiz that ran
 * that long was a student who walked away, and the exact seconds are noise.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
