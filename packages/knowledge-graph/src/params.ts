/**
 * THE PARTS OF THE MODEL THAT ARE MEASURED RATHER THAN WRITTEN.
 *
 * Everything else in this package is authored: a node is a sentence someone
 * wrote, an edge is a claim someone made. The numbers here are different —
 * they are only honest once real students have answered real questions, and
 * until then they are priors we are prepared to be wrong about.
 *
 * Three of them, each fixing a specific way the map lies to us:
 *
 *   GUESS   a student who does not hold a node still picks the right option one
 *           time in four. Without this, luck reads as knowledge.
 *   SLIP    a student who does hold it still misreads a question. Without this,
 *           one careless tap becomes a permanent "cannot do this", and the
 *           diagnostic then teaches them something they already knew.
 *   SUPPORT an edge says "you cannot do A without B". Nobody has checked. The
 *           edges came from a language model, and the whole inference stands on
 *           them, so each one carries how well real answers have borne it out.
 *
 * The first two are Bayesian Knowledge Tracing's (Corbett & Anderson, 1995).
 * The third is ours, and it exists because our edges are generated rather than
 * hand-authored by teachers — a difference we cannot pretend away.
 */

/** Four options, so blind guessing is right a quarter of the time. */
export const DEFAULT_GUESS = 0.25;

/**
 * A capable student's careless-error rate. 0.1 is the value BKT implementations
 * converge on across subjects; it is a starting point, not a finding.
 */
export const DEFAULT_SLIP = 0.1;

/**
 * Neither parameter may run away. A "question" with a guess rate of 0.9 is not
 * a question, and a slip rate near 0.5 makes an answer meaningless — in both
 * cases the honest response is to distrust the item, not the student.
 */
export const PARAM_FLOOR = 0.02;
export const GUESS_CEILING = 0.5;
export const SLIP_CEILING = 0.4;

export interface ItemParams {
  /** P(correct | does NOT hold the node). */
  guess: number;
  /** P(incorrect | DOES hold the node). */
  slip: number;
  /** How many answers these were estimated from. 0 means "still the prior". */
  attempts: number;
  /** How many of those were correct — the observed difficulty. */
  correct: number;
}

export interface EdgeParams {
  /**
   * How often the prerequisite claim survived contact with students, 0..1.
   *
   * A violation is a student who holds the dependent node while missing its
   * prerequisite. One is noise; a steady stream means the edge is fiction, and
   * every inference that travelled along it was fiction too.
   */
  support: number;
  violations: number;
  observations: number;
}

/**
 * Everything the model has learned so far. Serialisable on purpose: it lives in
 * the student's own storage today and in a table the day there is a server, and
 * neither should require a code change here.
 */
export interface ModelParams {
  version: 1;
  /** Keyed by probe id. */
  items: Record<string, ItemParams>;
  /** Keyed by `edgeKey(node, prerequisite)`. */
  edges: Record<string, EdgeParams>;
  /** ISO time of the last calibration, for "trained on N answers since X". */
  updatedAt: string | null;
  /** Total answers folded in, across every calibration run. */
  observations: number;
}

export const emptyParams = (): ModelParams => ({
  version: 1,
  items: {},
  edges: {},
  updatedAt: null,
  observations: 0,
});

export const edgeKey = (nodeId: string, prerequisiteId: string): string =>
  `${nodeId}<-${prerequisiteId}`;

/** An item's parameters, falling back to the priors for one never answered. */
export function itemParams(params: ModelParams, probeId: string): ItemParams {
  return (
    params.items[probeId] ?? { guess: DEFAULT_GUESS, slip: DEFAULT_SLIP, attempts: 0, correct: 0 }
  );
}

/**
 * An edge's support, defaulting to 1 for one never observed.
 *
 * Trusting an unmeasured edge fully is the right default and not a comfortable
 * one: it means a fresh map propagates at full strength along claims nobody has
 * tested. The alternative — distrusting everything until proven — would make
 * the diagnostic useless on day one, which is every student's day one.
 */
export function edgeSupport(params: ModelParams, nodeId: string, prerequisiteId: string): number {
  return params.edges[edgeKey(nodeId, prerequisiteId)]?.support ?? 1;
}

/**
 * BKT's posterior: what one answer says about holding the node.
 *
 * This is the whole reason slip and guess exist. The naive update moves belief
 * a fixed fraction toward 1 or 0; this one asks how surprising the answer
 * actually was. A correct answer on a question with a high guess rate barely
 * moves anything, and a wrong answer on a well-behaved item moves a lot.
 */
export function posterior(prior: number, correct: boolean, item: ItemParams): number {
  const holds = correct ? 1 - item.slip : item.slip;
  const doesNot = correct ? item.guess : 1 - item.guess;
  const evidence = prior * holds + (1 - prior) * doesNot;
  // Only reachable if slip and guess are both 0 and the answer contradicts a
  // certain belief; leaving the prior alone is the honest response.
  if (evidence <= 0) return prior;
  return (prior * holds) / evidence;
}
