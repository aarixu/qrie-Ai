import type { GraphIndex, Mastery } from '@ai-tutor/knowledge-graph';
import { applyDoubt } from '@ai-tutor/knowledge-graph';
import type { DoubtEntry } from '../stores/doubtLog';
import type { CatalogEntry } from './content';

/**
 * RAISED HANDS, TURNED INTO BELIEF.
 *
 * This is the signal no question can give us, and no competitor has: when a
 * student stops the class, we know the exact moment they got lost. A placement
 * test manufactures twenty of these in a sitting; a term of classes produces
 * them continuously, for free, from students who are not being tested at all.
 *
 * The join is deliberately coarse. A lesson names the topic it teaches
 * (`topicRef` = syllabus/chapter/topic) and a node names its chapter, so a
 * doubt lands on the chapter's nodes rather than on the one outcome the beat
 * was mid-sentence about. Beats do not carry node ids today; when they do,
 * this function narrows and nothing above it changes.
 *
 * Coarse still beats nothing: it says WHERE in the map to look, which is the
 * whole job. And `applyDoubt` is a nudge rather than a verdict precisely
 * because of this looseness — a student who asks a lot must never be modelled
 * as a student who knows nothing.
 */

/** The chapter a lesson teaches, from its topicRef: syllabusId/chapterId/topicId. */
export const chapterOfLesson = (entry: CatalogEntry): string | null =>
  entry.topicRef?.split('/')[1] ?? null;

export interface DoubtEvidenceOptions {
  /**
   * Only count doubts raised since this time. Callers pass the last training
   * run so the same hand is never folded in twice — repeated application would
   * turn one honest signal into certainty that the student knows nothing.
   */
  since?: string;
}

/**
 * Fold every unseen doubt into the beliefs, and report the cut-off so the
 * caller can record it. Pure: nothing here reads the clock or the stores.
 */
export function applyDoubtLog(
  mastery: Mastery,
  index: GraphIndex,
  log: readonly DoubtEntry[],
  catalog: readonly CatalogEntry[],
  opts: DoubtEvidenceOptions = {},
): { mastery: Mastery; latest: string | null } {
  const fresh = opts.since ? log.filter((d) => d.at > opts.since!) : log;
  if (fresh.length === 0) return { mastery, latest: opts.since ?? null };

  const chapterByLesson = new Map<string, string>();
  for (const entry of catalog) {
    const chapter = chapterOfLesson(entry);
    if (chapter) chapterByLesson.set(entry.id, chapter);
  }

  // Nodes are grouped by chapter once; a term's worth of doubts should not
  // walk the whole map per entry.
  const nodesByChapter = new Map<string, string[]>();
  for (const id of index.ids()) {
    const chapter = index.node(id)?.chapter;
    if (!chapter) continue;
    const list = nodesByChapter.get(chapter);
    if (list) list.push(id);
    else nodesByChapter.set(chapter, [id]);
  }

  let next = mastery;
  for (const doubt of fresh) {
    const chapter = chapterByLesson.get(doubt.lessonId);
    if (!chapter) continue;
    next = applyDoubt(next, nodesByChapter.get(chapter) ?? []);
  }

  const latest = fresh.reduce((max, d) => (d.at > max ? d.at : max), opts.since ?? '');
  return { mastery: next, latest: latest || null };
}
