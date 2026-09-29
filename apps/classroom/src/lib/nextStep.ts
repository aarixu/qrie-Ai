import { migrateModel, nextActivity } from '@ai-tutor/learner-model';
import type { GraphIndex } from '@ai-tutor/knowledge-graph';
import { learnerModelStore } from './learnerModel';
import { fetchCatalog, type CatalogEntry } from './content';
import { buildQuiz } from './quiz';

/**
 * WHAT THE STUDENT SHOULD DO BEFORE THE NEXT LESSON, IF ANYTHING (E6-E8/F5).
 *
 * `nextActivity` (packages/learner-model) decides from the learner model:
 * reviews that are due, then a shaky prerequisite of what comes next. This
 * turns its answer into somewhere to go — the practice for the lesson that
 * teaches it when there is one (a review is a retrieval, so it is answered,
 * not re-watched), else that lesson. Null means "on to the next lesson".
 *
 * `index` is injected (the caller loads the map, as lib/learnerModel.ts does)
 * so this file stays free of the syllabus maps' size.
 */
export interface BeforeNext {
  kind: 'review' | 'prerequisite';
  /** What it is, in the map's own titles. */
  titles: string[];
  route: string;
  because: string;
}

const nodesAt = (index: GraphIndex, topicRef: string | undefined): string[] =>
  topicRef ? index.ids().filter((id) => index.node(id)?.topicRef === topicRef) : [];

async function routeFor(outcomeId: string, index: GraphIndex): Promise<string | null> {
  const topicRef = index.node(outcomeId)?.topicRef;
  if (!topicRef) return null;
  const entry = (await fetchCatalog()).find((e: CatalogEntry) => e.topicRef === topicRef);
  if (!entry) return `/class/${topicRef}`;
  return buildQuiz(entry.id, { topicRef }) !== null ? `/quiz/${entry.id}` : `/lesson/${entry.id}`;
}

export async function beforeNext(input: {
  index: GraphIndex;
  /** The lesson just finished, and the one after it. */
  done: CatalogEntry | null;
  next: CatalogEntry | null;
  now?: Date;
}): Promise<BeforeNext | null> {
  const model = migrateModel(learnerModelStore.get());
  const decided = nextActivity({
    model,
    index: input.index,
    now: (input.now ?? new Date()).toISOString(),
    justDone: nodesAt(input.index, input.done?.topicRef),
    next: { outcomeIds: nodesAt(input.index, input.next?.topicRef) },
  });
  if (decided.kind === 'next') return null;
  const ids = decided.kind === 'review' ? decided.outcomeIds : [decided.outcomeId];
  const route = await routeFor(ids[0], input.index);
  if (!route) return null;
  return {
    kind: decided.kind,
    titles: ids.map((id) => input.index.node(id)?.title ?? id),
    route,
    because: decided.because,
  };
}
