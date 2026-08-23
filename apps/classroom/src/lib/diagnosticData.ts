import { GraphIndex, loadGraph, type ProbeBank } from '@ai-tutor/knowledge-graph';
// The Learning Outcome Maps live in the knowledge-graph package, but Vite serves
// `content/` as publicDir — packages/ is never reachable over HTTP, so fetching
// these would 404 in the browser. Importing them makes them part of the bundle,
// which is also what the diagnostic wants: the map has to be in hand before the
// first question can be chosen, and a placement test that starts with a spinner
// starts badly.
import class10ScienceGraph from '../../../../packages/knowledge-graph/data/class10-science.json';
import class10ScienceProbes from '../../../../packages/knowledge-graph/data/class10-science.probes.json';

/**
 * The diagnostic's data layer: which class has a map, and the loaded form of it.
 *
 * Maps are authored class by class, so most classes have none yet. That is a
 * normal state, not an error — `loadDiagnosticData` returns null and the screen
 * offers the student a way past, rather than crashing a brand new user on their
 * first screen.
 */

export interface DiagnosticData {
  index: GraphIndex;
  bank: ProbeBank;
}

/**
 * Raw sources by class. `probes` is asserted because a JSON module widens the
 * literal `1` of `version` to `number`; the shape itself is checked by the
 * knowledge-graph package's own tests against these very files.
 */
const SOURCES: Record<number, { graph: unknown; bank: ProbeBank }> = {
  10: { graph: class10ScienceGraph, bank: class10ScienceProbes as ProbeBank },
};

// A GraphIndex precomputes reverse edges and memoises closures, so building one
// is worth doing once per class rather than once per mount.
const loaded = new Map<number, DiagnosticData>();

/** The map and probes for a class, or null when none has been authored yet. */
export function loadDiagnosticData(klass: number): DiagnosticData | null {
  const cached = loaded.get(klass);
  if (cached) return cached;

  const source = SOURCES[klass];
  if (!source) return null;

  try {
    const data: DiagnosticData = {
      index: new GraphIndex(loadGraph(source.graph)),
      bank: source.bank,
    };
    loaded.set(klass, data);
    return data;
  } catch (error) {
    // loadGraph fails fast on a malformed or cyclic map. The details are for
    // whoever authored it; the student just gets the "not ready yet" path.
    console.error(`[diagnostic] class ${klass} map failed to load:`, error);
    return null;
  }
}
