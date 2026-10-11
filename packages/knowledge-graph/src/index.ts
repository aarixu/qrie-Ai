// Public surface of @ai-tutor/knowledge-graph. See README.md for the contract.
export type {
  ClassLink,
  ClassLinks,
  LearningNode,
  KnowledgeGraph,
  Probe,
  ProbeBank,
  ProbeRole,
  Mastery,
  Answer,
  Gap,
  PlanStep,
  DiagnosticResult,
} from './types.ts';
export { GAP_THRESHOLD, PRIOR } from './types.ts';

// The measured half of the model: what students taught it, and how it learns.
export {
  DEFAULT_GUESS,
  DEFAULT_SLIP,
  edgeKey,
  edgeSupport,
  emptyParams,
  itemParams,
  posterior,
  type EdgeParams,
  type ItemParams,
  type ModelParams,
} from './params.ts';
export {
  observationsFrom,
  suspectEdges,
  suspectItems,
  train,
  type Observation,
  type SuspectEdge,
  type SuspectItem,
} from './calibration.ts';

export { loadGraph, GraphIndex, type FilterOptions } from './graph.ts';

// Several questions per outcome (lam-one-brain Task 16).
export { bankProblems, normaliseStem, primaryFirst, PROBE_ROLES } from './probes.ts';

export {
  initialMastery,
  applyEvidence,
  evidenceRegion,
  evidenceFrom,
  applyDoubt,
  applyTaught,
  clampMastery,
  decayMastery,
  gapsFrom,
  informationValue,
  confidenceCoverage,
  type InitialMasteryOptions,
  type ApplyEvidenceOptions,
  type GapOptions,
} from './mastery.ts';
