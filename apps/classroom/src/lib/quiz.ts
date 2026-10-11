import { primaryFirst, type KnowledgeGraph, type LearningNode, type Probe, type ProbeBank } from '@ai-tutor/knowledge-graph';
// Same reason as lib/diagnosticData.ts: Vite serves `content/` as publicDir, so
// `packages/` is never reachable over HTTP. The map and the probe bank have to
// be bundled, and a quiz has to be in hand the instant the lesson ends.
import class10ScienceGraph from '../../../../packages/knowledge-graph/data/class10-science.json';
import class10ScienceProbes from '../../../../packages/knowledge-graph/data/class10-science.probes.json';
import class9ScienceGraph from '../../../../packages/knowledge-graph/data/class9-science.json';
import class9ScienceProbes from '../../../../packages/knowledge-graph/data/class9-science.probes.json';
import class9MathsGraph from '../../../../packages/knowledge-graph/data/class9-mathematics.json';
import class9MathsProbes from '../../../../packages/knowledge-graph/data/class9-mathematics.probes.json';

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
   * How long this one answer took.
   *
   * Carried because the outcome map discounts a laboured correct answer — a
   * student who spent ninety seconds reconstructing something has not shown
   * the same thing as one who answered in four. The quiz screen has always
   * measured it and the row dropped it, so every piece of quiz evidence
   * reached applyEvidence with `ms` undefined and SLOW_ANSWER_FACTOR never
   * applied to any of it.
   */
  ms: number;
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
  /**
   * The syllabus topic this lesson teaches, from the catalogue entry.
   *
   * Without it a lesson can only be quizzed on nodes the map names it in, and
   * the map names a lesson for barely a third of its nodes — so a class
   * prepared live, which the map has never heard of, would end with no practice
   * at all. With it, the topic supplies the questions.
   */
  topicRef?: string;
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
/**
 * EVERY MAP THERE IS, NOT JUST THE FIRST ONE WRITTEN.
 *
 * This held class10-science alone, which was invisible for as long as a quiz
 * ended in a number. The moment the quiz started feeding the outcome map it
 * became a silent no-op for most of the product: a Class 9 student's index
 * covers classes 7 to 9, every probe here carried a class10 node id, every
 * answer was dropped as "a node the map no longer has", and adaptToQuiz
 * returned no change. Nothing threw and nothing was logged.
 *
 * Grows with the data directory. A map that exists and is not listed here is a
 * class whose students get a score and no adaptation.
 */
const SOURCES: { graph: KnowledgeGraph; bank: ProbeBank }[] = [
  {
    graph: class10ScienceGraph as unknown as KnowledgeGraph,
    bank: class10ScienceProbes as ProbeBank,
  },
  {
    graph: class9ScienceGraph as unknown as KnowledgeGraph,
    bank: class9ScienceProbes as ProbeBank,
  },
  {
    graph: class9MathsGraph as unknown as KnowledgeGraph,
    bank: class9MathsProbes as ProbeBank,
  },
];

/** The maps' nodes and every question about them; `buildQuiz` reads the shipped ones. */
export interface Catalogue {
  node(id: string): LearningNode | undefined;
  probes: readonly Probe[];
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
export function buildQuiz(
  lessonRef: string,
  options: QuizOptions = {},
  from: Catalogue = load(),
): QuizQuestion[] | null {
  const { limit = DEFAULT_LENGTH, minimum = MIN_QUESTIONS, topicRef } = options;
  const { node, probes } = from;

  /**
   * Does this lesson teach that node?
   *
   * Two ways, and the precise one wins. The map may name THIS lesson on a
   * node — that is the only way two lessons under one topic stay apart, and
   * NCERT's "Transportation in Human Beings" really is taught here as the
   * heart and the blood separately. Failing that, the node belongs to this
   * lesson's topic AND no other lesson has claimed it: a sibling's questions
   * are questions about a class this student has not had.
   */
  const teaches = (learningNode: LearningNode): boolean => {
    if (learningNode.lessonRef === lessonRef) return true;
    if (learningNode.lessonRef !== undefined) return false;
    return topicRef !== undefined && learningNode.topicRef === topicRef;
  };

  const available: QuizQuestion[] = [];
  // One question per node, its first (Task 16): a node may also hold a retest
  // or a review question, which are for later, and two questions on one
  // outcome would weigh it twice in the score.
  const asked = new Set<string>();
  for (const probe of [...probes].sort(primaryFirst)) {
    if (asked.has(probe.nodeId)) continue;
    const learningNode = node(probe.nodeId);
    // A probe whose node this lesson does not teach is a question about
    // something the student was never shown.
    if (!learningNode || !teaches(learningNode)) continue;
    asked.add(probe.nodeId);
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
      ms: answer.ms,
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
