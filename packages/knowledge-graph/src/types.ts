/**
 * The Learning Outcome Map — the product's model of what a student can do.
 *
 * A NODE is one atomic outcome ("can balance a chemical equation"), not a
 * chapter and not a lesson. Nodes are joined by PREREQUISITE edges, so the map
 * is a DAG: to reach a node you must first hold everything it depends on.
 *
 * The map is designed to reach 10,000+ nodes across classes 6-12. Nothing here
 * assumes it is small: the diagnostic never walks the whole graph, it probes a
 * few dozen nodes and INFERS the rest through the edges. That inference is the
 * whole point — it is what turns 20 questions into a picture of thousands of
 * outcomes.
 */

export interface LearningNode {
  /** Stable id, e.g. "c10-sci-life-processes-photosynthesis-equation". */
  id: string;
  klass: number;
  /** e.g. "Science", "Mathematics". */
  subject: string;
  /** Chapter id within the subject syllabus. */
  chapter: string;
  /** Short human label for the UI. */
  title: string;
  /** What the student can DO, phrased as an observable outcome. */
  outcome: string;
  /** Node ids that must be held before this one is reachable. */
  prerequisites: string[];
  /** 1 (foundational) .. 5 (advanced). Orders study plans and probe choice. */
  difficulty: number;
  /** The lesson that teaches this node, when one exists. */
  lessonRef?: string;
}

export interface KnowledgeGraph {
  version: 1;
  nodes: LearningNode[];
}

/** One diagnostic question. Probes exactly one node. */
export interface Probe {
  id: string;
  /** The node this question is evidence about. */
  nodeId: string;
  question: string;
  /** Exactly 4 options. */
  options: string[];
  /** Index into `options`. */
  correctIndex: number;
  /**
   * What each wrong option reveals, aligned to `options` by index (the correct
   * index holds ''). Named misconceptions are what let the study plan say WHY
   * a student is stuck, not just THAT they are.
   */
  misconceptions?: string[];
}

export interface ProbeBank {
  version: 1;
  probes: Probe[];
}

/**
 * One cross-class prerequisite: `nodeId` (in this map) genuinely cannot be
 * done without `prerequisiteId` (in the map one class below).
 *
 * Links live in a SIDECAR file (<id>.links.json) rather than on the node,
 * deliberately: each class's graph stays self-contained and valid on its own,
 * and a link is applied only when both of its ends are actually loaded — a
 * Class 10 window that stops at Class 8 must not carry edges dangling into
 * Class 7.
 */
export interface ClassLink {
  nodeId: string;
  prerequisiteId: string;
}

export interface ClassLinks {
  version: 1;
  links: ClassLink[];
  /**
   * Tool bookkeeping: chapters the link pass has finished, INCLUDING those
   * whose honest answer was zero links — without this, an unlinked chapter is
   * indistinguishable from an unvisited one and gets re-asked every run.
   * Consumers of the links ignore it.
   */
  chaptersDone?: string[];
}

/** Belief that the student holds each node: 0 (certainly not) .. 1 (certainly). */
export type Mastery = Record<string, number>;

/** One answered probe. */
export interface Answer {
  probeId: string;
  nodeId: string;
  /** Index chosen, or null if skipped. */
  chosenIndex: number | null;
  correct: boolean;
  /** Milliseconds taken — slow-but-correct is weaker evidence than fast-and-correct. */
  ms?: number;
}

export interface Gap {
  nodeId: string;
  /** Belief the student does NOT hold this node, 0..1. */
  confidence: number;
  /** How many other nodes this one blocks — the cost of leaving it broken. */
  blocks: number;
}

export interface PlanStep {
  nodeId: string;
  /** Plain-language reason shown to the student. */
  reason: string;
  lessonRef?: string;
}

export interface DiagnosticResult {
  mastery: Mastery;
  /** Weakest-and-most-blocking first. */
  gaps: Gap[];
  /** The personalised study plan, in the order it should be worked through. */
  plan: PlanStep[];
  /** Probes actually asked, for auditing and for resuming. */
  answers: Answer[];
}

/** Below this belief a node counts as a gap. */
export const GAP_THRESHOLD = 0.5;

/** Starting belief for an unprobed node, before any evidence. */
export const PRIOR = 0.5;
