import { GraphIndex, loadGraph } from '@ai-tutor/knowledge-graph';
import { GRAPH_MAPS } from './graphData.ts';

/**
 * Every map the library's questions are written against, as ONE graph.
 *
 * A library question names the outcome it probes (lms.item.outcome_ids,
 * loaded from the same banks by tools/lms-library), so the brain needs every
 * class and subject at once. The node ids carry their class and subject
 * (`class8-mathematics-...`), so the maps join without colliding; if two
 * ever claimed one id, loadGraph would refuse rather than pick one.
 *
 * The maps are imported (graphData.ts), not read from a folder, so the same
 * code runs under node and in the bundled brain function.
 */

let cached: GraphIndex | null = null;

export function libraryIndex(): GraphIndex {
  if (cached) return cached;
  const nodes: unknown[] = [];
  for (const map of GRAPH_MAPS) nodes.push(...map.nodes);
  cached = new GraphIndex(loadGraph({ version: 1, nodes }));
  return cached;
}
