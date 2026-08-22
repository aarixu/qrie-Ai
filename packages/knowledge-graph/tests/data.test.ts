import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GraphIndex, loadGraph } from '../src/graph';

/**
 * The committed maps must load. This is the guard that a generated or
 * hand-edited graph cannot reach a student broken — a dangling prerequisite or
 * an accidental cycle fails here, in CI, not mid-diagnostic.
 */

const DATA_DIR = path.resolve(process.cwd(), 'packages/knowledge-graph/data');
// Probe banks live in the same folder and are linted separately, in probes.test.ts.
const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.probes.json'));

describe('committed knowledge graphs', () => {
  it('there is at least one', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s loads and is acyclic', (file) => {
    const graph = loadGraph(JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')));
    expect(graph.nodes.length).toBeGreaterThan(0);
  });

  it.each(files)('%s is nanoscale — outcomes are observable, not vague', (file) => {
    const graph = loadGraph(JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')));
    // A node that merely says "understand X" is not testable, which defeats the
    // whole point of a fine-grained map.
    const vague = graph.nodes.filter((n) => /^(understand|know|learn|be aware)/i.test(n.outcome));
    expect(vague.map((n) => n.id)).toEqual([]);
  });

  it.each(files)('%s has real structure, not a flat list', (file) => {
    const index = new GraphIndex(
      loadGraph(JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))),
    );
    // A map with no edges cannot infer anything — it would just be a quiz bank.
    const withPrerequisites = index.ids().filter((id) => index.prerequisitesOf(id).length > 0);
    expect(withPrerequisites.length).toBeGreaterThan(index.size / 2);

    // And it should have hubs worth diagnosing early.
    const maxBlocks = Math.max(...index.ids().map((id) => index.blockCount(id)));
    expect(maxBlocks).toBeGreaterThan(5);
  });

  it('class10-science lessonRefs point at lessons that exist', () => {
    const graph = loadGraph(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'class10-science.json'), 'utf8')),
    );
    const catalog = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'content/index.json'), 'utf8'),
    ) as { lessons: { id: string }[] };
    const known = new Set(catalog.lessons.map((l) => l.id));

    const dangling = graph.nodes
      .filter((n) => n.lessonRef && !known.has(n.lessonRef))
      .map((n) => `${n.id} -> ${n.lessonRef}`);
    expect(dangling).toEqual([]);
  });
});
