# @ai-tutor/knowledge-graph

The **Learning Outcome Map** — the product's model of what a student can do, and
the belief machinery that turns a handful of answers into a picture of thousands
of outcomes.

Zero runtime dependencies. Pure: no I/O, no clock, no randomness.

## The idea

A node is one atomic outcome — *"state which gas is released during
photosynthesis"* — not a chapter and not a lesson. Nodes are joined by
prerequisite edges, so the map is a DAG built to hold 10,000+ nodes.

The map is deliberately **nanoscale**: the finer the decomposition, the more
precisely a diagnostic can say where a student actually stopped understanding.

Because the map is a prerequisite DAG, most combinations of knows/doesn't-know
are impossible — which is what lets ~20 questions describe the whole map
(knowledge space theory; the same foundation ALEKS is built on):

```
correct   -> you almost certainly hold what this rests on   (raise ANCESTORS)
incorrect -> what rests on this is now in doubt             (lower DESCENDANTS)
```

## Public API

```ts
// Loading — fail-fast validation, including prerequisite CYCLE detection
loadGraph(json: unknown): KnowledgeGraph

// A queryable view. Build once; edges are precomputed, closures memoised.
class GraphIndex {
  constructor(graph: KnowledgeGraph)
  size: number
  ids(): string[]
  node(id): LearningNode | null
  prerequisitesOf(id): string[]        // direct
  dependentsOf(id): string[]           // direct, reverse edges
  ancestorsOf(id): ReadonlySet<string> // transitive prerequisites
  descendantsOf(id): ReadonlySet<string>
  blockCount(id): number               // how much this node holds back
  distanceToAncestor(from, ancestor): number   // edges, or -1
  topoOrder(): string[]                // prerequisites first, stable
  roots(): string[]
  filter({ klass?, subject?, chapter? }): LearningNode[]
}

// Beliefs, 0..1 per node
initialMastery(index, { biasByDifficulty? }): Mastery
applyEvidence(mastery, index, answer, { probed? }): Mastery   // pure, returns new
gapsFrom(mastery, index, { subjects?, klass?, threshold? }): Gap[]
informationValue(mastery, index, nodeId): number   // what asking would reveal
confidenceCoverage(mastery, index, opts): number   // share of settled beliefs
```

## Rules worth knowing

- Beliefs clamp to `[0.02, 0.98]` — a student can always surprise you.
- Propagation decays with distance and **never overwrites direct evidence**:
  pass the set of already-probed nodes as `opts.probed`.
- A slow correct answer counts for less than a fast one (reconstruction, not
  recall). A skipped answer is weak evidence *against*, and does not propagate.
- `gapsFrom` ranks by `confidence × log(1 + blockCount)` so a shaky node holding
  back two hundred others outranks a shaky leaf, without one hub dominating.
- `informationValue` is the practical form of ALEKS's "pick the item that halves
  the space": uncertainty (peaks at belief 0.5) × reach (how far an answer
  propagates).

## Data

`data/*.json` holds the committed maps. Grow them with `tools/gen-graph`.

## Depends on

Nothing.
