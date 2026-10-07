import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphIndex, loadGraph } from '@ai-tutor/knowledge-graph';

/**
 * Every map the library's questions are written against, as ONE graph.
 *
 * A library question names the outcome it probes (lms.item.outcome_ids,
 * loaded from the same banks by tools/lms-library), so the brain needs every
 * class and subject at once. The node ids carry their class and subject
 * (`class8-mathematics-...`), so the maps join without colliding; if two
 * ever claimed one id, loadGraph would refuse rather than pick one.
 */
const DATA = fileURLToPath(new URL('../../knowledge-graph/data/', import.meta.url));

let cached: GraphIndex | null = null;

export function libraryIndex(): GraphIndex {
  if (cached) return cached;
  const nodes: unknown[] = [];
  for (const f of fs.readdirSync(DATA).filter((n) => n.endsWith('.json') && !n.endsWith('.probes.json')).sort()) {
    const graph = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) as { nodes: unknown[] };
    nodes.push(...graph.nodes);
  }
  cached = new GraphIndex(loadGraph({ version: 1, nodes }));
  return cached;
}
