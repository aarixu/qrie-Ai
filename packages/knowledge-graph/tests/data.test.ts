import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GraphIndex, loadGraph } from '../src/graph';
import { loadSyllabus, getTopic, type SubjectSyllabus } from '../../syllabus/src/syllabus';

/**
 * The committed maps must load. This is the guard that a generated or
 * hand-edited graph cannot reach a student broken — a dangling prerequisite or
 * an accidental cycle fails here, in CI, not mid-diagnostic.
 *
 * It also guards the map's link to CONTENT, which is the harder half and the
 * half that was missing. The lessonRef check below used to name class10-science
 * explicitly, so the two Class 9 maps were never checked at all — and they had
 * 175 nodes pointing at lessons that had never existed, plus 46 pointing at the
 * empty string. Every check here is now `it.each(files)`: a map that is added
 * is a map that is checked.
 */

const DATA_DIR = path.resolve(process.cwd(), 'packages/knowledge-graph/data');
const SYLLABUS_DIR = path.resolve(process.cwd(), 'packages/syllabus/data');
// Probe banks live in the same folder and are linted separately, in probes.test.ts.
const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.probes.json') && !f.endsWith('.links.json'));

const graphOf = (file: string) =>
  loadGraph(JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')));

/** The syllabus a map is filed against: same basename, by construction. */
const syllabusOf = (file: string): SubjectSyllabus | null => {
  const full = path.join(SYLLABUS_DIR, file);
  if (!fs.existsSync(full)) return null;
  return loadSyllabus(JSON.parse(fs.readFileSync(full, 'utf8')));
};

const CATALOG = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'content/index.json'), 'utf8'),
) as { lessons: { id: string; topicRef?: string }[] };

describe('committed knowledge graphs', () => {
  it('there is at least one', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s loads and is acyclic', (file) => {
    expect(graphOf(file).nodes.length).toBeGreaterThan(0);
  });

  it.each(files)('%s is nanoscale — outcomes are observable, not vague', (file) => {
    // A node that merely says "understand X" is not testable, which defeats the
    // whole point of a fine-grained map.
    const vague = graphOf(file).nodes.filter((n) => /^(understand|know|learn|be aware)/i.test(n.outcome));
    expect(vague.map((n) => n.id)).toEqual([]);
  });

  it.each(files)('%s has real structure, not a flat list', (file) => {
    const index = new GraphIndex(graphOf(file));
    // A map with no edges cannot infer anything — it would just be a quiz bank.
    const withPrerequisites = index.ids().filter((id) => index.prerequisitesOf(id).length > 0);
    expect(withPrerequisites.length).toBeGreaterThan(index.size / 2);

    // And it should have hubs worth diagnosing early.
    const maxBlocks = Math.max(...index.ids().map((id) => index.blockCount(id)));
    expect(maxBlocks).toBeGreaterThan(5);
  });
});

/**
 * THE JOIN TO CONTENT.
 *
 * A study plan step with nowhere to go is the defect these three checks exist
 * to prevent. Each one failed silently for months.
 */
describe('every map leads somewhere', () => {
  it.each(files)('%s: every node sits in a chapter the syllabus has', (file) => {
    const syllabus = syllabusOf(file);
    expect(syllabus, `no syllabus at packages/syllabus/data/${file}`).not.toBeNull();
    const chapters = new Set(syllabus!.chapters.map((c) => c.id));

    const stray = [...new Set(graphOf(file).nodes.map((n) => n.chapter))].filter(
      (c) => !chapters.has(c),
    );
    expect(stray).toEqual([]);
  });

  it.each(files)('%s: every node is filed under a topic that exists', (file) => {
    const syllabus = syllabusOf(file)!;

    const broken = graphOf(file)
      .nodes.filter((n) => !n.topicRef || !getTopic(syllabus, n.topicRef))
      .map((n) => `${n.id} -> ${n.topicRef ?? '(none)'}`);
    // Repairable with: node tools/gen-graph/src/cli.ts --syllabus <id> --map-topics
    expect(broken).toEqual([]);
  });

  it.each(files)('%s: every lessonRef names a lesson that exists', (file) => {
    const known = new Set(CATALOG.lessons.map((l) => l.id));

    const dangling = graphOf(file)
      .nodes.filter((n) => n.lessonRef && !known.has(n.lessonRef))
      .map((n) => `${n.id} -> ${n.lessonRef}`);
    expect(dangling).toEqual([]);
  });

  it.each(files)('%s: a lessonRef agrees with the topic it is filed under', (file) => {
    // Naming one lesson among several under a topic is the only legitimate use
    // of lessonRef. Naming a lesson that teaches a DIFFERENT topic means one of
    // the two is wrong, and the student would be sent to the wrong class.
    const byId = new Map(CATALOG.lessons.map((l) => [l.id, l]));

    const disagreeing = graphOf(file)
      .nodes.filter((n) => {
        if (!n.lessonRef || !n.topicRef) return false;
        const lesson = byId.get(n.lessonRef);
        return Boolean(lesson?.topicRef) && lesson!.topicRef !== n.topicRef;
      })
      .map((n) => `${n.id}: filed under ${n.topicRef} but names ${n.lessonRef}`);
    expect(disagreeing).toEqual([]);
  });
});

describe('the lesson catalogue', () => {
  it('every lesson names a topic that exists in some syllabus', () => {
    const syllabi = fs
      .readdirSync(SYLLABUS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => loadSyllabus(JSON.parse(fs.readFileSync(path.join(SYLLABUS_DIR, f), 'utf8'))));

    const orphaned = CATALOG.lessons
      .filter((l) => l.topicRef && !syllabi.some((s) => getTopic(s, l.topicRef!)))
      .map((l) => `${l.id} -> ${l.topicRef}`);
    expect(orphaned).toEqual([]);
  });
});
