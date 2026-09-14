import type { Answer, Gap, Mastery } from './types';
import { GAP_THRESHOLD, PRIOR } from './types';
import type { GraphIndex } from './graph';
import { edgeSupport, emptyParams, itemParams, posterior, type ModelParams } from './params';

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

/**
 * The same bounds, for anything outside this file that composes a belief.
 *
 * Exported rather than copied: 0.02 and 0.98 written down twice is the drift
 * defect this repo keeps finding, and a second clamp that let a belief reach 0
 * or 1 would make it unmovable by any later evidence — certainty is the one
 * state no amount of being wrong can escape.
 */
export const clampMastery = clamp;

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
  /**
   * What the model has learned about this item and these edges. Omitted, every
   * item gets the default slip/guess and every edge is trusted completely —
   * which is exactly the state a brand new install is in.
   */
  params?: ModelParams;
}

/**
 * How far belief travels along an edge nobody has verified.
 *
 * Support multiplies the propagation strength, so a claim students keep
 * contradicting stops carrying inference long before anyone deletes it. This
 * is the difference between a map that degrades where it is wrong and one that
 * confidently spreads a bad edge across a whole subject.
 */
function edgeTrust(params: ModelParams | undefined, from: string, to: string, correct: boolean): number {
  if (!params) return 1;
  // Upward (correct) the pair is (node, ancestor); downward it is reversed.
  return correct ? edgeSupport(params, from, to) : edgeSupport(params, to, from);
}

/**
 * Every node one answer speaks about — the one asked, plus what it implies.
 *
 * Shared by `applyEvidence`, which moves belief across this region, and by
 * `gapsFrom`, which refuses to call anything outside it a gap. They must agree:
 * a node the model was never entitled to an opinion about must not be able to
 * become a weakness by arithmetic alone.
 */
export function evidenceRegion(index: GraphIndex, answer: Answer): string[] {
  // A skip is evidence about the node asked and nothing else. Silence says
  // nothing about the rest of the map.
  if (answer.chosenIndex === null) return [answer.nodeId];
  const inferred = answer.correct
    ? index.ancestorsOf(answer.nodeId)
    : index.descendantsOf(answer.nodeId);
  return [answer.nodeId, ...inferred];
}

/** Every node a whole answer list speaks about. */
export function evidenceFrom(index: GraphIndex, answers: readonly Answer[]): Set<string> {
  const seen = new Set<string>();
  for (const answer of answers) {
    for (const id of evidenceRegion(index, answer)) seen.add(id);
  }
  return seen;
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
  const prior = next[answer.nodeId] ?? PRIOR;

  // The probed node gets the Bayesian answer, which accounts for the chance
  // this was luck or a slip. Everything downstream is still a heuristic pull:
  // a marginal per node, not a joint posterior, because enumerating knowledge
  // states is exponential and lands in the same place on a DAG this shape.
  const item = itemParams(opts.params ?? emptyParams(), answer.probeId);
  const bayes = posterior(prior, answer.correct, item);
  // A laboured correct answer is reconstruction, not recall, so it is allowed
  // to move belief only part of the way to where certainty would put it.
  next[answer.nodeId] = clamp(laboured ? prior + (bayes - prior) * SLOW_ANSWER_FACTOR : bayes);

  // Correct answers speak upward about foundations; wrong answers speak
  // downward about everything built on the gap.
  for (const id of evidenceRegion(index, answer)) {
    // The answered node already has its Bayesian posterior above; a heuristic
    // pull here would talk over it.
    if (id === answer.nodeId) continue;
    if (probed.has(id)) continue; // direct evidence wins
    const hops = answer.correct
      ? index.distanceToAncestor(answer.nodeId, id)
      : index.distanceToAncestor(id, answer.nodeId);
    const distance = hops > 0 ? hops : 1;
    const trust = edgeTrust(opts.params, answer.nodeId, id, answer.correct);
    const strength =
      PROPAGATION_STRENGTH *
      Math.pow(DECAY, distance - 1) *
      (laboured ? SLOW_ANSWER_FACTOR : 1) *
      trust;
    next[id] = pull(next[id] ?? PRIOR, target, strength);
  }

  return next;
}

/**
 * FORGETTING.
 *
 * Belief measured on Tuesday is not belief on the following month's Tuesday,
 * and a map that never forgets will keep insisting a student holds something
 * they last touched in April. Ebbinghaus's curve is an exponential decay, so
 * that is what this is: each node relaxes back toward the prior with a
 * half-life, and a plan built afterwards naturally schedules review.
 *
 * It decays ONLY toward the prior, never past it. Time erodes what you knew;
 * it does not manufacture evidence that you never knew it — a belief already
 * below the prior stays exactly where the evidence put it.
 */
const DEFAULT_HALF_LIFE_DAYS = 30;

export interface DecayOptions {
  /** Days after which an unreviewed belief has moved half way back to the prior. */
  halfLifeDays?: number;
  /**
   * Nodes exempt from decay this pass — everything the student has just
   * practised. Reviewing one node must not quietly age the rest.
   */
  refreshed?: ReadonlySet<string>;
}

export function decayMastery(mastery: Mastery, elapsedDays: number, opts: DecayOptions = {}): Mastery {
  if (!(elapsedDays > 0)) return mastery;
  const halfLife = opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const retained = Math.pow(0.5, elapsedDays / halfLife);
  const refreshed = opts.refreshed;

  const next: Mastery = {};
  for (const [id, belief] of Object.entries(mastery)) {
    if (belief <= PRIOR || refreshed?.has(id)) {
      next[id] = belief;
      continue;
    }
    next[id] = clamp(PRIOR + (belief - PRIOR) * retained);
  }
  return next;
}

/**
 * A RAISED HAND IS EVIDENCE.
 *
 * This is the signal no question can give us. When a student stops the class at
 * a known beat, we know the exact outcomes being taught at the moment they got
 * lost — a confusion marker located precisely in the map, arriving without
 * anyone being tested. A placement test gets twenty of these an hour; a class
 * generates them for free, all term.
 *
 * Weak on purpose, and it does not propagate. Curiosity and confusion look the
 * same from here, so a hand is a nudge rather than a verdict, and a student who
 * asks a lot must never be modelled as a student who knows nothing.
 */
const DOUBT_STRENGTH = 0.22;

export function applyDoubt(mastery: Mastery, nodeIds: readonly string[]): Mastery {
  if (nodeIds.length === 0) return mastery;
  const next: Mastery = { ...mastery };
  for (const id of nodeIds) {
    next[id] = pull(next[id] ?? PRIOR, 0, DOUBT_STRENGTH);
  }
  return next;
}

/**
 * ATTENDANCE, WEIGHED HONESTLY.
 *
 * Sitting through the beat that teaches an outcome is evidence. It is the
 * weakest evidence in this file, and it has to stay that way: a student who
 * watches ten lessons has not passed ten questions, and a map that treated
 * them as equal would stop asking about anything they had merely seen.
 *
 * So it nudges belief up, and it saturates — the second and third viewing of
 * the same beat move it far less than the first, because rewatching is what a
 * student does when they did NOT get it.
 */
const TAUGHT_STRENGTH = 0.18;

export function applyTaught(mastery: Mastery, nodeIds: readonly string[], times = 1): Mastery {
  if (nodeIds.length === 0 || times < 1) return mastery;
  // Diminishing: 1 -> 0.18, 2 -> 0.23, 3 -> 0.26 of the way toward "holds it".
  const strength = TAUGHT_STRENGTH * (1 + Math.log(times));
  const next: Mastery = { ...mastery };
  for (const id of nodeIds) {
    next[id] = pull(next[id] ?? PRIOR, 1, Math.min(strength, 0.35));
  }
  return next;
}

export interface GapOptions {
  /** Only consider these subjects, when the student picked some. */
  subjects?: readonly string[];
  /** The student's class — the top of the range considered. */
  klass?: number;
  /**
   * Bottom of the class range, for a placement that looks back at earlier
   * levels. Omitted, the range is just `klass` — the old behaviour.
   */
  minKlass?: number;
  /** Below this belief a node counts as a gap. */
  threshold?: number;
  /**
   * Nodes an answer has actually spoken about, from `evidenceFrom`.
   *
   * Without this, a node nobody examined is judged purely on the belief it was
   * SEEDED with — and `initialMastery({ biasByDifficulty: true })` seeds a
   * difficulty-4 node at 0.46, below the threshold. Fifteen such nodes turned a
   * flawless placement test into a twelve-step remedial plan. A prior is not a
   * measurement; see the same principle stated in `decayMastery`.
   *
   * Omitted, every node is considered — the old behaviour, and what a
   * hand-written fixture wants.
   */
  evidence?: ReadonlySet<string>;
}

/** The class-range test shared by every consumer of GapOptions. */
const inKlassRange = (nodeKlass: number, opts: GapOptions): boolean => {
  if (opts.klass === undefined) return true;
  return nodeKlass <= opts.klass && nodeKlass >= (opts.minKlass ?? opts.klass);
};

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
    if (opts.evidence && !opts.evidence.has(id)) continue;
    const belief = mastery[id] ?? PRIOR;
    if (belief >= threshold) continue;

    const node = index.node(id);
    if (!node) continue;
    if (subjects && !subjects.has(node.subject)) continue;
    if (!inKlassRange(node.klass, opts)) continue;

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
    if (!inKlassRange(node.klass, opts)) continue;

    total += 1;
    const belief = mastery[id] ?? PRIOR;
    if (belief > 0.75 || belief < 0.25) settled += 1;
  }

  return total === 0 ? 1 : settled / total;
}
