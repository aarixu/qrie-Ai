/**
 * Every outcome map in packages/knowledge-graph/data (each `<class>-<subject>.json`;
 * the `.probes.json` question banks are not maps and are not here), imported so
 * they travel with the code that reads them: the brain function
 * (supabase/functions/brain) is a bundle that holds only the modules it
 * imports and has no folder to read at run time (review MF12).
 * tests/graph-data.test.ts fails when a map is added to the folder and not
 * here. In file-name order, the order graph.ts joins them in.
 */
import c10Mathematics from '../../knowledge-graph/data/class10-mathematics.json' with { type: 'json' };
import c10Science from '../../knowledge-graph/data/class10-science.json' with { type: 'json' };
import c11Biology from '../../knowledge-graph/data/class11-biology.json' with { type: 'json' };
import c11Chemistry from '../../knowledge-graph/data/class11-chemistry.json' with { type: 'json' };
import c11Mathematics from '../../knowledge-graph/data/class11-mathematics.json' with { type: 'json' };
import c6Mathematics from '../../knowledge-graph/data/class6-mathematics.json' with { type: 'json' };
import c6Science from '../../knowledge-graph/data/class6-science.json' with { type: 'json' };
import c7Mathematics from '../../knowledge-graph/data/class7-mathematics.json' with { type: 'json' };
import c7Science from '../../knowledge-graph/data/class7-science.json' with { type: 'json' };
import c8Mathematics from '../../knowledge-graph/data/class8-mathematics.json' with { type: 'json' };
import c8Science from '../../knowledge-graph/data/class8-science.json' with { type: 'json' };
import c9Mathematics from '../../knowledge-graph/data/class9-mathematics.json' with { type: 'json' };
import c9Science from '../../knowledge-graph/data/class9-science.json' with { type: 'json' };

/** One entry per map; each holds the map's `nodes`. */
export const GRAPH_MAPS: readonly { nodes: readonly unknown[] }[] = [
  c10Mathematics,
  c10Science,
  c11Biology,
  c11Chemistry,
  c11Mathematics,
  c6Mathematics,
  c6Science,
  c7Mathematics,
  c7Science,
  c8Mathematics,
  c8Science,
  c9Mathematics,
  c9Science,
];
