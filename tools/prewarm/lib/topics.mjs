/**
 * WHICH TOPICS THE RUNNER MAY SPEND ON, read from the repo's own data.
 *
 * Two sources, deliberately the same two the app uses:
 *   - packages/syllabus/data/<id>.json, validated by @ai-tutor/syllabus's own
 *     loadSyllabus, so a malformed file fails here exactly as it would in the
 *     app rather than producing a topic list with holes;
 *   - packages/knowledge-graph/data/<id>.json for what each topicRef is FOR —
 *     the outcome ids the planner may claim. Mirrors outcomesForTopic in
 *     apps/classroom/src/lib/topicOutcomes.ts (same join on topicRef, same
 *     easiest-first sort, same cap of twelve), because a runner that handed
 *     the planner a different outcome list would warm a different class than
 *     the one the app would have made.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTopics, loadSyllabus } from '@ai-tutor/syllabus';

// path.resolve from this file, NOT `new URL(template, import.meta.url)`:
// vite (which runs these lines under vitest) rewrites that URL pattern as an
// asset reference and a dynamic template comes back as literal "undefined".
const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoPath = (rel) => path.resolve(HERE, '../../..', rel);

/** The catalogue the launch plan warms first: 9-10 science, nothing else. */
export const ALL_CLASS_9_10_SCIENCE = ['class9-science', 'class10-science'];

export function loadSyllabusById(id) {
  const file = repoPath(`packages/syllabus/data/${id}.json`);
  if (!fs.existsSync(file)) {
    const dir = repoPath('packages/syllabus/data');
    const known = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
    throw new Error(`no syllabus "${id}" — known: ${known.join(', ')}`);
  }
  return loadSyllabus(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/**
 * Every topic the filters allow, flat, with the syllabus header alongside —
 * SaveMeta needs klass and subject for the catalogue row.
 *
 * An unknown chapter or topic id THROWS rather than matching nothing: the
 * silent version of that mistake is a run that reports "0 topics, done" and
 * looks like success.
 */
export function topicsFor(syllabusId, filter = {}) {
  const s = loadSyllabusById(syllabusId);
  let chapters = s.chapters;
  if (filter.chapter) {
    chapters = chapters.filter((c) => c.id === filter.chapter);
    if (chapters.length === 0) {
      throw new Error(
        `no chapter "${filter.chapter}" in ${syllabusId} — chapters: ${s.chapters.map((c) => c.id).join(', ')}`,
      );
    }
  }
  const rows = chapters.flatMap((chapter) =>
    chapter.topics
      .filter((t) => !filter.topic || t.id === filter.topic)
      .map((topic) => ({
        path: `${s.id}/${chapter.id}/${topic.id}`,
        topic,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        syllabusId: s.id,
        klass: s.klass,
        subject: s.subject,
      })),
  );
  if (filter.topic && rows.length === 0) {
    throw new Error(`no topic "${filter.topic}" under ${syllabusId}${filter.chapter ? `/${filter.chapter}` : ''}`);
  }
  // listTopics is the app's own enumeration; asserting against it keeps this
  // file honest the day the syllabus shape grows.
  if (!filter.chapter && !filter.topic) {
    const canonical = listTopics(s).map((r) => r.path);
    if (rows.length !== canonical.length) {
      throw new Error(`topicsFor(${syllabusId}) disagrees with listTopics — this file has a bug`);
    }
  }
  return rows;
}

/** Past this the list stops being a scope — same cap as topicOutcomes.ts. */
export const MAX_OUTCOMES = 12;

const graphCache = new Map();

function graphNodes(syllabusId) {
  if (graphCache.has(syllabusId)) return graphCache.get(syllabusId);
  const file = repoPath(`packages/knowledge-graph/data/${syllabusId}.json`);
  // No map is an ordinary state, not a failure: the class is still taught,
  // it just cannot be measured — the same posture as the app.
  const nodes = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, 'utf8')).nodes ?? [])
    : [];
  graphCache.set(syllabusId, nodes);
  return nodes;
}

export function outcomesFor(topicRef) {
  if (!topicRef) return [];
  const syllabusId = topicRef.split('/')[0];
  return graphNodes(syllabusId)
    .filter((node) => node.topicRef === topicRef)
    .sort((a, b) => a.difficulty - b.difficulty)
    .slice(0, MAX_OUTCOMES)
    .map((node) => ({ id: node.id, statement: node.outcome }));
}
