import type { Answer, Gap, Mastery } from './types';
import { GAP_THRESHOLD, PRIOR } from './types';
import type { GraphIndex } from './graph';

/**
 * Belief propagation over the Learning Outcome Map — the machinery that turns
 * twenty answers into a picture of thousands of outcomes.
 *
 * The idea comes from knowledge space theory: because the map is a prerequisite
 * DAG, most combinations of "knows / doesn't know" are impossible. Answering one
 * question therefore says something about a whole region of the map:
 *
 *   correct   -> you almost certainly hold what this rests on   (raise ANCESTORS)
 *   incorrect -> what rests on this is now in doubt             (lower DESCENDANTS)
 *
 * We track one belief per node rather than a distribution over whole knowledge
 * states. Enumerating states is exact but exponential; per-node marginals cost
 * nothing and, on a DAG this shape, land in the same place.
 */

/** Beliefs never reach 0 or 1 — a student can always surprise you. */
const FLOOR = 0.02;
const CEILING = 0.98;

/** Pull toward 1 (or 0) for the node actually answered. */
const DIRECT_STRENGTH = 0.85;
/**
 * Pull applied one edge away, decaying with each further edge.
 *
 * Tuned so that ONE hop crosses the settled threshold (0.5 -> 0.8) while two
 * hops do not (-> ~0.67). That asymmetry is deliberate: getting a question
 * right is strong evidence about what it directly rests on, and progressively
 * weaker evidence the further back you go. Weaker values leave inference unable
 * to settle anything on its own, which throws away the whole reason for having
 * a prerequisite map.
 */
const PROPAGATION_STRENGTH = 0.6;
const DECAY = 0.55;

/**
 * Past this, a correct answer is treated as laboured rather than fluent, and
 * counts for less. Roughly the point where a student is reconstructing rather
 * than recalling.
 */
const SLOW_ANSWER_MS = 25_000;
const SLOW_ANSWER_FACTOR = 0.6;

/** A skip is weak evidence against — it is not neutral. */
const SKIP_STRENGTH = 0.3;

const clamp = (v: number): number => Math.min(CEILING, Math.max(FLOOR, v));

/** Move `belief` a fraction of the way toward `target`. */
const pull = (belief: number, target: number, strength: number): number =>
  clamp(belief + (target - belief) * strength);

export interface InitialMasteryOptions {
  /**
   * Nudge easy nodes up and hard ones down before any evidence. This is a prior,
   * not a claim, so the effect is deliberately small.
   */
  biasByDifficulty?: boolean;
}

export function initialMastery(index: GraphIndex, opts: InitialMasteryOptions = {}): Mastery {
  const mastery: Mastery = {};
  for (const id of index.ids()) {
    if (!opts.biasByDifficulty) {
      mastery[id] = PRIOR;
      continue;
    }
    const difficulty = index.node(id)?.difficulty ?? 3;
    mastery[id] = clamp(PRIOR + (3 - difficulty) * 0.04);
  }
  return mastery;
}

export interface ApplyEvidenceOptions {
  /**
   * Nodes with direct evidence already recorded. Propagation never overwrites
   * these: what a student actually answered outranks anything inferred about
   * them. The caller owns this set across a session.
   */
  probed?: ReadonlySet<string>;
}

/**
 * Fold one answer into the beliefs. Pure: returns a new map.
 */
export function applyEvidence(
  mastery: Mastery,
  index: GraphIndex,
  answer: Answer,
  opts: ApplyEvidenceOptions = {},
): Mastery {
  const next: Mastery = { ...mastery };
  const probed = opts.probed ?? new Set<string>();
  const target = answer.correct ? 1 : 0;

  // A skip is a soft "probably not", and it does not propagate: silence is not
  // evidence about the rest of the map.
  if (answer.chosenIndex === null) {
    next[answer.nodeId] = pull(next[answer.nodeId] ?? PRIOR, 0, SKIP_STRENGTH);
    return next;
  }

  const laboured = answer.correct && (answer.ms ?? 0) > SLOW_ANSWER_MS;
  const directStrength = DIRECT_STRENGTH * (laboured ? SLOW_ANSWER_FACTOR : 1);
  next[answer.nodeId] = pull(next[answer.nodeId] ?? PRIOR, target, directStrength);

  // Correct answers speak upward about foundations; wrong answers speak
  // downward about everything built on the gap.
  const region = answer.correct
    ? index.ancestorsOf(answer.nodeId)
    : index.descendantsOf(answer.nodeId);

  for (const id of region) {
    if (probed.has(id)) continue; // direct evidence wins
    const hops = answer.correct
      ? index.distanceToAncestor(answer.nodeId, id)
      : index.distanceToAncestor(id, answer.nodeId);
    const distance = hops > 0 ? hops : 1;
    const strength =
      PROPAGATION_STRENGTH * Math.pow(DECAY, distance - 1) * (laboured ? SLOW_ANSWER_FACTOR : 1);
    next[id] = pull(next[id] ?? PRIOR, target, strength);
  }

  return next;
}

export interface GapOptions {
  /** Only consider these subjects, when the student picked some. */
  subjects?: readonly string[];
  klass?: number;
  /** Below this belief a node counts as a gap. */
  threshold?: number;
}

/**
 * The nodes worth fixing, worst-and-most-blocking first.
 *
 * Ordering by belief alone would surface a hundred equally-shaky leaves; the
 * log of the block count promotes the few nodes that are actually holding the
 * student back without letting one enormous hub dominate entirely.
 */
export function gapsFrom(mastery: Mastery, index: GraphIndex, opts: GapOptions = {}): Gap[] {
  const threshold = opts.threshold ?? GAP_THRESHOLD;
  const subjects = opts.subjects && opts.subjects.length > 0 ? new Set(opts.subjects) : null;

  const gaps: Gap[] = [];
  for (const id of index.ids()) {
    const belief = mastery[id] ?? PRIOR;
    if (belief >= threshold) continue;

    const node = index.node(id);
    if (!node) continue;
    if (subjects && !subjects.has(node.subject)) continue;
    if (opts.klass !== undefined && node.klass !== opts.klass) continue;

    gaps.push({ nodeId: id, confidence: 1 - belief, blocks: index.blockCount(id) });
  }

  return gaps.sort((a, b) => {
    const score = (g: Gap) => g.confidence * Math.log1p(g.blocks);
    const diff = score(b) - score(a);
    // Stable ordering keeps the diagnostic reproducible for a given session.
    return diff !== 0 ? diff : a.nodeId.localeCompare(b.nodeId);
  });
}

/**
 * How much answering this node would tell us about the map.
 *
 * Two factors, both from knowledge space theory. A belief near 0.5 is where an
 * answer carries the most information (either outcome is a surprise), and a node
 * connected to many others propagates that information furthest. Their product
 * is what the diagnostic maximises — the practical form of ALEKS's "pick the
 * item that halves the space".
 */
export function informationValue(mastery: Mastery, index: GraphIndex, nodeId: string): number {
  const belief = mastery[nodeId] ?? PRIOR;
  const uncertainty = 1 - Math.abs(belief - 0.5) * 2; // 1 at 0.5, 0 at either end
  const reach = index.ancestorsOf(nodeId).size + index.descendantsOf(nodeId).size;
  return uncertainty * Math.log1p(reach);
}

/** Share of nodes whose belief has settled — the diagnostic's stopping signal. */
export function confidenceCoverage(
  mastery: Mastery,
  index: GraphIndex,
  opts: GapOptions = {},
): number {
  const subjects = opts.subjects && opts.subjects.length > 0 ? new Set(opts.subjects) : null;
  let total = 0;
  let settled = 0;

  for (const id of index.ids()) {
    const node = index.node(id);
    if (!node) continue;
    if (subjects && !subjects.has(node.subject)) continue;
    if (opts.klass !== undefined && node.klass !== opts.klass) continue;

    total += 1;
    const belief = mastery[id] ?? PRIOR;
    if (belief > 0.75 || belief < 0.25) settled += 1;
  }

  return total === 0 ? 1 : settled / total;
}
