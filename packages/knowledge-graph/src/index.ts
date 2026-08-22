// Public surface of @ai-tutor/knowledge-graph. See README.md for the contract.
export type {
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

export { loadGraph, GraphIndex, type FilterOptions } from './graph';

export {
  initialMastery,
  applyEvidence,
  gapsFrom,
  informationValue,
  confidenceCoverage,
  type InitialMasteryOptions,
  type ApplyEvidenceOptions,
  type GapOptions,
} from './mastery';
