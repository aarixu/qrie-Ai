// Public surface of @ai-tutor/knowledge-graph. See README.md for the contract.
export type {
  ClassLink,
  ClassLinks,
  LearningNode,
  KnowledgeGraph,
  Probe,
  ProbeBank,
  Mastery,
  Answer,
  Gap,
  PlanStep,
  DiagnosticResult,
} from './types';
export { GAP_THRESHOLD, PRIOR } from './types';

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
} from './params';
export {
  observationsFrom,
  suspectEdges,
  suspectItems,
  train,
  type Observation,
  type SuspectEdge,
  type SuspectItem,
} from './calibration';

export { loadGraph, GraphIndex, type FilterOptions } from './graph';

export {
  initialMastery,
  applyEvidence,
  applyDoubt,
  applyTaught,
  decayMastery,
  gapsFrom,
  informationValue,
  confidenceCoverage,
  type InitialMasteryOptions,
  type ApplyEvidenceOptions,
  type GapOptions,
} from './mastery';
