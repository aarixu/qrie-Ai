import {
  GraphIndex,
  informationValue,
  PRIOR,
  primaryFirst,
  type Probe,
  type ProbeBank,
} from '@ai-tutor/knowledge-graph';
import type { DiagnosticSession } from './session';

/**
 * Choosing the next question — where a twenty-question diagnostic earns its keep.
 *
 * Knowledge space theory's rule is to ask the item that best halves the space of
 * possible knowledge states. In practice that is two things multiplied:
 *
 *   uncertainty  — a belief near 0.5 means either answer is a surprise
 *   reach        — how far through the map that surprise would propagate
 *
 * On top of that sit three practical corrections that pure information theory
 * does not give you: a diagnostic that never leaves one chapter tells you nothing
 * about the rest; asking the same node twice wastes a question; and a run of
 * questions that ignores the last answer feels broken to the student even when
 * the mathematics is fine.
 */

export interface SelectOptions {
  /** Penalty applied per question already spent in the same chapter. */
  spreadPenalty?: number;
  /** How strongly to follow the last answer up or down in difficulty. */
  difficultyPull?: number;
}

const DEFAULTS: Required<SelectOptions> = {
  spreadPenalty: 0.25,
  difficultyPull: 0.35,
};

/**
 * The next probe, or null when nothing useful is left to ask.
 *
 * Deterministic: same session, same graph, same bank -> same probe.
 */
export function selectNextProbe(
  session: DiagnosticSession,
  index: GraphIndex,
  bank: ProbeBank,
  opts: SelectOptions = {},
): Probe | null {
  const { spreadPenalty, difficultyPull } = { ...DEFAULTS, ...opts };
  const subjects = new Set(session.config.subjects);

  // Binary search behaviour: after a correct answer reach for something harder,
  // after a wrong one drop toward the prerequisites that might explain it.
  const last = session.answers[session.answers.length - 1];
  const lastNode = last ? index.node(last.nodeId) : null;
  const targetDifficulty = lastNode
    ? clampDifficulty(lastNode.difficulty + (last!.correct ? 1 : -1))
    : 3; // no history yet: start mid-range and let the answers steer

  // How many questions each chapter has already taken.
  const chapterSpend = new Map<string, number>();
  for (const answer of session.answers) {
    const node = index.node(answer.nodeId);
    if (!node) continue;
    chapterSpend.set(node.chapter, (chapterSpend.get(node.chapter) ?? 0) + 1);
  }

  let best: { probe: Probe; score: number } | null = null;

  for (const probe of bank.probes) {
    if (session.askedNodeIds.has(probe.nodeId)) continue;

    const node = index.node(probe.nodeId);
    if (!node) continue; // a probe whose node was removed from the map
    // In scope: the student's class and up to lookBack classes behind it —
    // placement looks backwards, because that is where the real gaps live.
    if (node.klass > session.config.klass) continue;
    if (node.klass < session.config.klass - (session.config.lookBack ?? 0)) continue;
    if (subjects.size > 0 && !subjects.has(node.subject)) continue;

    const information = informationValue(session.mastery, index, probe.nodeId);
    // Everything below is a multiplier on information, never a replacement for
    // it — the question still has to be worth asking.
    const spread = 1 / (1 + spreadPenalty * (chapterSpend.get(node.chapter) ?? 0));
    const difficultyFit = 1 - difficultyPull * (Math.abs(node.difficulty - targetDifficulty) / 4);

    const score = information * spread * difficultyFit;
    // A node may hold several questions (Task 16) and they score alike: its
    // first question is asked, the further ones are kept for later.
    if (!best || score > best.score || (score === best.score && primaryFirst(probe, best.probe) < 0)) {
      best = { probe, score };
    }
  }

  // A score of zero means every remaining node is already settled; asking would
  // only spend the student's patience.
  return best && best.score > 0 ? best.probe : null;
}

const clampDifficulty = (d: number): number => Math.min(5, Math.max(1, d));

/**
 * How many questions could still be asked: nodes in scope with a question,
 * not yet asked — one each, however many questions a node holds. Useful for
 * authoring checks — a subject with no probes cannot be diagnosed, and that
 * should fail a lint, not a student.
 */
export function availableProbeCount(
  session: DiagnosticSession,
  index: GraphIndex,
  bank: ProbeBank,
): number {
  const subjects = new Set(session.config.subjects);
  const askable = bank.probes.filter((probe) => {
    if (session.askedNodeIds.has(probe.nodeId)) return false;
    const node = index.node(probe.nodeId);
    if (!node) return false;
    if (node.klass > session.config.klass) return false;
    if (node.klass < session.config.klass - (session.config.lookBack ?? 0)) return false;
    return subjects.size === 0 || subjects.has(node.subject);
  });
  return new Set(askable.map((probe) => probe.nodeId)).size;
}

/** Beliefs default to PRIOR for nodes never mentioned — exported for tests. */
export const UNSEEN_BELIEF = PRIOR;
