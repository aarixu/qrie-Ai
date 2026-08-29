// Public surface of @ai-tutor/class-prep. See README.md for the contract.
export { prepareClass, assemble, type LlmAdapter, type PrepOptions } from './prepare';
export { verifySvg } from './verify';
export { PLANNER_SYSTEM, ARTIST_SYSTEM, plannerUser, artistUser, repairUser } from './prompts';
export type {
  Blueprint,
  VisualBrief,
  VisualOutcome,
  PrepReport,
  PrepResult,
  PrepPhase,
  PrepProgress,
} from './types';
