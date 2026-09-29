import { migrateModel, nextActivity, type LearnerModel } from '@ai-tutor/learner-model';
import type { GraphIndex, Probe } from '@ai-tutor/knowledge-graph';
import { learnerModelStore } from './learnerModel';

/**
 * THE CLASS OPENS WITH A WARM-UP WHEN A REVIEW IS DUE (E6-E8, 2026-09-29).
 *
 * The plan: "When a review is due, the class opens with a 1-2 item warm-up,
 * before any recap line." A review is a retrieval, so it is ASKED, never
 * re-told: one authored probe per due outcome, from the same bank the
 * placement test and the practice quiz ask from, so every question already
 * carries a reviewed answer and, per wrong option, a named misconception.
 *
 * `nextActivity` decides what is due (most overdue first); this keeps at most
 * two, never on what the class is about to teach, and skips an outcome the
 * bank has no question for. The probe turns with the outcome's retrieval
 * count, so the next review of the same outcome asks a different question
 * when the bank has one.
 */

export const WARM_UP_MAX = 2;

export interface WarmUpQuestion {
  /** The probe id. */
  id: string;
  nodeId: string;
  /** The outcome's title in the map. */
  title: string;
  /** The topic the outcome belongs to — the evidence is filed under it. */
  topicRef?: string;
  question: string;
  options: string[];
  correctIndex: number;
  /** Aligned to `options`; the correct index holds ''. */
  misconceptions: string[];
}

export function pickWarmUp(input: {
  model: LearnerModel;
  index: GraphIndex;
  probes: readonly Probe[];
  /** ISO time now — the caller's clock. */
  now: string;
  /** Outcomes this class teaches: never warmed up on. */
  justDone: readonly string[];
}): WarmUpQuestion[] {
  const decided = nextActivity({ model: input.model, index: input.index, now: input.now, justDone: input.justDone });
  if (decided.kind !== 'review') return [];
  const picked: WarmUpQuestion[] = [];
  for (const id of decided.outcomeIds) {
    if (picked.length >= WARM_UP_MAX) break;
    const node = input.index.node(id);
    const own = input.probes
      .filter((p) => p.nodeId === id && p.options.length > 1 && p.options[p.correctIndex] !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!node || own.length === 0) continue;
    const probe = own[(input.model.states[id]?.retrievalCount ?? 0) % own.length];
    picked.push({
      id: probe.id,
      nodeId: id,
      title: node.title,
      topicRef: node.topicRef,
      question: probe.question,
      options: probe.options,
      correctIndex: probe.correctIndex,
      misconceptions: probe.misconceptions ?? [],
    });
  }
  return picked;
}

/**
 * The warm-up for a class on `topicRef`, from this device's learner model.
 *
 * The map is imported lazily, and only when something is due, for the reason
 * `recordLocally` gives: it pulls every syllabus map, which does not belong in
 * the class screen's first load.
 * Empty — never an error — when the student's class has no map, or anything
 * on the way fails: a warm-up is a nicety, and the class starts regardless.
 */
export async function warmUpFor(topicRef: string | undefined, now: Date = new Date()): Promise<WarmUpQuestion[]> {
  try {
    const model = migrateModel(learnerModelStore.get());
    // Nothing due, and the map is never loaded: the ordinary class starts
    // without waiting on it.
    const due = Object.values(model.states).some(
      (s) => s.box !== null && s.nextReviewAt !== null && Date.parse(s.nextReviewAt) <= now.getTime(),
    );
    if (!due) return [];
    const { currentIndex, currentBank } = await import('./graphContext');
    const index = currentIndex();
    const bank = currentBank();
    if (!index || !bank) return [];
    const justDone = topicRef ? index.ids().filter((id) => index.node(id)?.topicRef === topicRef) : [];
    return pickWarmUp({
      model,
      index,
      probes: bank.probes,
      now: now.toISOString(),
      justDone,
    });
  } catch {
    return [];
  }
}
