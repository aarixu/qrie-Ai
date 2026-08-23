import { GraphIndex, loadGraph, type KnowledgeGraph, type ProbeBank } from '@ai-tutor/knowledge-graph';

/**
 * The diagnostic's data layer: every authored Learning Outcome Map, merged to
 * fit the student in front of it.
 *
 * Maps are authored one (class, subject) at a time and land as pairs in
 * packages/knowledge-graph/data — <id>.json and <id>.probes.json. The glob is
 * the point (see lib/content.ts, which learned this the hard way): generating
 * a fourteenth map changes what this module serves without anyone remembering
 * to edit an import list. Vite serves content/ as publicDir and packages/ is
 * never reachable over HTTP, so the maps are imported into the bundle — which
 * is also what the diagnostic wants: the map must be in hand before the first
 * question can be chosen, and a placement test that starts with a spinner
 * starts badly.
 *
 * A class with no maps yet is a normal state, not an error — the loader
 * returns null and the screen offers the student a way past, rather than
 * crashing a brand new user on their first screen.
 */

export interface DiagnosticData {
  index: GraphIndex;
  bank: ProbeBank;
  /** The subjects the session should scope to — lineage-expanded. */
  subjects: string[];
  /** How many earlier classes the merged map actually covers. */
  lookBack: number;
}

/**
 * How far behind the student's class the placement reaches. Two levels back is
 * where most real breaks live (a Class 9 student broken on Class 7 fractions);
 * further back than that and twenty questions spread too thin to settle
 * anything.
 */
export const LOOK_BACK = 2;

const graphModules = import.meta.glob('../../../../packages/knowledge-graph/data/*.json', {
  eager: true,
}) as Record<string, { default: unknown }>;

interface AuthoredMap {
  graph: KnowledgeGraph;
  bank: ProbeBank;
}

/** All authored maps, keyed by data-file id (e.g. "class10-science"), loaded once. */
function authoredMaps(): Map<string, AuthoredMap> {
  const maps = new Map<string, AuthoredMap>();
  for (const [path, module] of Object.entries(graphModules)) {
    const file = path.split('/').pop()!;
    if (file.endsWith('.probes.json')) continue;
    const id = file.replace(/\.json$/, '');
    try {
      const graph = loadGraph(module.default);
      const probes = graphModules[path.replace(/\.json$/, '.probes.json')];
      const bank = (probes?.default ?? { version: 1, probes: [] }) as ProbeBank;
      maps.set(id, { graph, bank });
    } catch (error) {
      // loadGraph fails fast on a malformed or cyclic map. The details are for
      // whoever authored it; the student just gets the "not ready yet" path.
      console.error(`[diagnostic] map "${id}" failed to load:`, error);
    }
  }
  return maps;
}

let allMaps: Map<string, AuthoredMap> | null = null;
const maps = (): Map<string, AuthoredMap> => (allMaps ??= authoredMaps());

/**
 * What an older class called the subject a student now studies. Class 11
 * splits Science into the separate sciences, so a Biology student's previous
 * level is Class 10 SCIENCE — without this, their placement could never look
 * back across the split.
 */
const LINEAGE: Record<string, string[]> = {
  Biology: ['Science'],
  Chemistry: ['Science'],
  Physics: ['Science'],
};

/** The chosen subjects plus every earlier-class name they descend from. */
export const lineageSubjects = (subjects: readonly string[]): string[] => {
  const expanded = new Set<string>();
  for (const subject of subjects) {
    expanded.add(subject);
    for (const ancestor of LINEAGE[subject] ?? []) expanded.add(ancestor);
  }
  return [...expanded];
};

const memo = new Map<string, DiagnosticData | null>();

/**
 * The merged map for one student: their class and up to LOOK_BACK classes
 * behind it, restricted to their subjects (lineage included). Null when not
 * even the student's own class has a map — looking back presumes somewhere to
 * place forward into.
 *
 * Empty `subjects` means every subject, exactly as the diagnostic treats it.
 */
export function loadDiagnosticDataFor(klass: number, subjects: readonly string[]): DiagnosticData | null {
  const key = `${klass}|${[...subjects].sort().join(',')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const expanded = lineageSubjects(subjects);
  const wanted = expanded.length > 0 ? new Set(expanded) : null;

  const nodes = [];
  const probes = [];
  let ownClassCovered = false;
  let minKlassSeen = klass;

  for (const { graph, bank } of maps().values()) {
    const sample = graph.nodes[0];
    if (!sample) continue;
    if (sample.klass > klass || sample.klass < klass - LOOK_BACK) continue;
    if (wanted && !wanted.has(sample.subject)) continue;
    nodes.push(...graph.nodes);
    probes.push(...bank.probes);
    if (sample.klass === klass) ownClassCovered = true;
    minKlassSeen = Math.min(minKlassSeen, sample.klass);
  }

  const data: DiagnosticData | null = ownClassCovered
    ? {
        index: new GraphIndex({ version: 1, nodes }),
        bank: { version: 1, probes },
        subjects: expanded,
        lookBack: klass - minKlassSeen,
      }
    : null;
  memo.set(key, data);
  return data;
}

/** The pre-lineage loader, kept for callers that only know a class. */
export function loadDiagnosticData(klass: number): DiagnosticData | null {
  return loadDiagnosticDataFor(klass, []);
}
