import type { KnowledgeGraph, LearningNode } from './types.ts';

/**
 * Loading and traversing the Learning Outcome Map.
 *
 * The map is built to hold 10,000+ nodes, so nothing here walks the graph at
 * query time: GraphIndex precomputes the edges once and memoises the transitive
 * closures the diagnostic hammers on. Everything is pure — no I/O, no clock.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function fail(where: string, message: string): never {
  throw new Error(`knowledge graph ${where}: ${message}`);
}

/**
 * Validates and returns the graph.
 *
 * Fail-fast with a specific message rather than error-collecting: a graph file
 * is generated or hand-authored and then committed, so the reader is a human
 * fixing one problem at a time.
 */
export function loadGraph(json: unknown): KnowledgeGraph {
  if (!isObj(json)) throw new Error('knowledge graph must be a JSON object');
  if (json.version !== 1) fail('root', 'version must be exactly 1');
  if (!Array.isArray(json.nodes) || json.nodes.length === 0) {
    fail('root', 'needs a non-empty nodes array');
  }

  const byId = new Map<string, LearningNode>();
  json.nodes.forEach((raw, i) => {
    const at = `nodes[${i}]`;
    if (!isObj(raw)) fail(at, 'must be an object');
    if (!isStr(raw.id)) fail(at, 'node needs a non-empty id');
    if (byId.has(raw.id)) fail(at, `duplicate node id "${raw.id}"`);

    const where = `${at} ("${raw.id}")`;
    if (typeof raw.klass !== 'number' || !Number.isInteger(raw.klass) || raw.klass < 6 || raw.klass > 12) {
      fail(where, 'klass must be an integer from 6 to 12');
    }
    if (!isStr(raw.subject)) fail(where, 'needs a non-empty subject');
    if (!isStr(raw.chapter)) fail(where, 'needs a non-empty chapter');
    if (!isStr(raw.title)) fail(where, 'needs a non-empty title');
    if (!isStr(raw.outcome)) fail(where, 'needs a non-empty outcome');
    if (
      typeof raw.difficulty !== 'number' ||
      !Number.isInteger(raw.difficulty) ||
      raw.difficulty < 1 ||
      raw.difficulty > 5
    ) {
      fail(where, 'difficulty must be an integer from 1 to 5');
    }
    if (!Array.isArray(raw.prerequisites) || !raw.prerequisites.every(isStr)) {
      fail(where, 'prerequisites must be an array of node ids');
    }
    // Shape only. Whether the topic actually EXISTS is checked against the
    // syllabus in the data tests, which are the only place both files are in
    // hand — but a ref of the wrong shape can never resolve anywhere, and
    // catching that here means the map, not the classroom, reports it.
    if (raw.topicRef !== undefined) {
      if (!isStr(raw.topicRef) || raw.topicRef.split('/').length !== 3) {
        fail(where, 'topicRef must be "<syllabusId>/<chapterId>/<topicId>"');
      }
    }
    if (raw.lessonRef !== undefined && !isStr(raw.lessonRef)) {
      fail(where, 'lessonRef must be a non-empty lesson id');
    }
    byId.set(raw.id, raw as unknown as LearningNode);
  });

  // Edges resolve only after every id is known, so forward references are fine.
  for (const node of byId.values()) {
    for (const prerequisite of node.prerequisites) {
      if (!byId.has(prerequisite)) {
        fail(`node "${node.id}"`, `prerequisite "${prerequisite}" does not exist`);
      }
      if (prerequisite === node.id) fail(`node "${node.id}"`, 'cannot be its own prerequisite');
    }
  }

  const cycle = findCycle(byId);
  if (cycle) {
    fail('root', `prerequisite cycle: ${cycle.join(' -> ')}. The map must be acyclic`);
  }

  return json as unknown as KnowledgeGraph;
}

/** Depth-first cycle detection. Returns the offending path, or null. */
function findCycle(byId: ReadonlyMap<string, LearningNode>): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    const state = colour.get(id) ?? WHITE;
    if (state === BLACK) return null;
    if (state === GREY) return [...path.slice(path.indexOf(id)), id];

    colour.set(id, GREY);
    path.push(id);
    for (const next of byId.get(id)?.prerequisites ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    colour.set(id, BLACK);
    return null;
  };

  for (const id of byId.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

export interface FilterOptions {
  klass?: number;
  subject?: string;
  chapter?: string;
}

/**
 * A queryable view over a graph. Build it once per graph; every method is a
 * lookup or a memoised traversal.
 */
export class GraphIndex {
  private readonly byId: Map<string, LearningNode>;
  /** Reverse edges: node id -> ids that list it as a prerequisite. */
  private readonly dependents: Map<string, string[]>;
  private readonly ancestorCache = new Map<string, Set<string>>();
  private readonly descendantCache = new Map<string, Set<string>>();
  private topo: string[] | null = null;

  constructor(graph: KnowledgeGraph) {
    this.byId = new Map(graph.nodes.map((n) => [n.id, n]));
    this.dependents = new Map(graph.nodes.map((n) => [n.id, []]));
    for (const node of graph.nodes) {
      for (const prerequisite of node.prerequisites) {
        this.dependents.get(prerequisite)?.push(node.id);
      }
    }
  }

  get size(): number {
    return this.byId.size;
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }

  node(id: string): LearningNode | null {
    return this.byId.get(id) ?? null;
  }

  prerequisitesOf(id: string): string[] {
    return this.byId.get(id)?.prerequisites ?? [];
  }

  dependentsOf(id: string): string[] {
    return this.dependents.get(id) ?? [];
  }

  /** Everything this node transitively rests on. */
  ancestorsOf(id: string): ReadonlySet<string> {
    return this.closure(id, this.ancestorCache, (n) => this.prerequisitesOf(n));
  }

  /** Everything that transitively rests on this node. */
  descendantsOf(id: string): ReadonlySet<string> {
    return this.closure(id, this.descendantCache, (n) => this.dependentsOf(n));
  }

  /**
   * How much a node blocks. This is the number that makes a diagnostic
   * efficient: a shaky node with 200 descendants is worth far more of a
   * student's twenty questions than a shaky leaf.
   */
  blockCount(id: string): number {
    return this.descendantsOf(id).size;
  }

  /** Distance in edges from `from` up to an ancestor, or -1 if unrelated. */
  distanceToAncestor(from: string, ancestor: string): number {
    if (from === ancestor) return 0;
    let frontier = this.prerequisitesOf(from);
    const seen = new Set<string>(frontier);
    let depth = 1;
    while (frontier.length > 0) {
      if (frontier.includes(ancestor)) return depth;
      const next: string[] = [];
      for (const id of frontier) {
        for (const p of this.prerequisitesOf(id)) {
          if (!seen.has(p)) {
            seen.add(p);
            next.push(p);
          }
        }
      }
      frontier = next;
      depth += 1;
    }
    return -1;
  }

  /** Prerequisites first. Stable: ties break on declaration order. */
  topoOrder(): string[] {
    if (this.topo) return this.topo;
    const order: string[] = [];
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      done.add(id);
      for (const p of this.prerequisitesOf(id)) visit(p);
      order.push(id);
    };
    for (const id of this.byId.keys()) visit(id);
    this.topo = order;
    return order;
  }

  roots(): string[] {
    return [...this.byId.values()].filter((n) => n.prerequisites.length === 0).map((n) => n.id);
  }

  filter(opts: FilterOptions = {}): LearningNode[] {
    return [...this.byId.values()].filter(
      (n) =>
        (opts.klass === undefined || n.klass === opts.klass) &&
        (opts.subject === undefined || n.subject === opts.subject) &&
        (opts.chapter === undefined || n.chapter === opts.chapter),
    );
  }

  private closure(
    id: string,
    cache: Map<string, Set<string>>,
    step: (id: string) => string[],
  ): ReadonlySet<string> {
    const cached = cache.get(id);
    if (cached) return cached;

    // Iterative, not recursive: a 10,000-node chain would blow the stack.
    const out = new Set<string>();
    const stack = [...step(id)];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (out.has(next)) continue;
      out.add(next);
      stack.push(...step(next));
    }
    cache.set(id, out);
    return out;
  }
}
