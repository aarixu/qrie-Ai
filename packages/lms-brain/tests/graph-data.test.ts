// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { libraryIndex } from '../src/index.ts';

/**
 * THE BRAIN'S GRAPH TRAVELS WITH ITS CODE (review MF12).
 *
 * The brain function (supabase/functions/brain) is bundled: it holds only the
 * modules its code imports, never a folder read at run time. So the maps the
 * brain reasons over are imported (src/graphData.ts), and nothing on the
 * brain's path reaches for the file system.
 */

const SRC = path.resolve(process.cwd(), 'packages/lms-brain/src');
const DATA = path.resolve(process.cwd(), 'packages/knowledge-graph/data');
const maps = fs.readdirSync(DATA).filter((n) => n.endsWith('.json') && !n.endsWith('.probes.json')).sort();

describe('the graph the brain reads', () => {
  it('imports nothing from node: anywhere in the brain', () => {
    for (const f of fs.readdirSync(SRC).filter((n) => n.endsWith('.ts'))) {
      expect(fs.readFileSync(path.join(SRC, f), 'utf8'), f).not.toMatch(/from ['"]node:/);
    }
  });

  it('imports every map in the knowledge-graph data, and no probe bank', () => {
    const text = fs.readFileSync(path.join(SRC, 'graphData.ts'), 'utf8');
    const imported = [...text.matchAll(/knowledge-graph\/data\/([^'"]+\.json)['"]/g)].map((m) => m[1]).sort();
    expect(imported).toEqual(maps);
  });

  it('holds every node of every map, as the folder has them', () => {
    const ids = new Set(libraryIndex().ids());
    let n = 0;
    for (const f of maps) {
      for (const node of (JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) as { nodes: { id: string }[] }).nodes) {
        expect(ids.has(node.id), `${f}: ${node.id}`).toBe(true);
        n += 1;
      }
    }
    expect(ids.size).toBe(n);
  });
});
