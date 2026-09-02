// Public surface of @ai-tutor/diagnostic. See README.md for the contract.
export {
  startSession,
  answerProbe,
  isComplete,
  progressOf,
  DEFAULT_CONFIG,
  type DiagnosticSession,
  type DiagnosticConfig,
  type Progress,
} from './session';

export { selectNextProbe, availableProbeCount, type SelectOptions } from './select';

export { buildPlan, stepsFrom, type PlanOptions } from './plan';

export {
  learnFromQuiz,
  MAX_NEW_STEPS,
  MAX_PLAN_STEPS,
  type Adapted,
  type AdaptOptions,
} from './adapt';
