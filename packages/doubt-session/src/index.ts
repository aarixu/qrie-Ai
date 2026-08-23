// Public surface of @ai-tutor/doubt-session. See README.md for the contract.
export { createHandoff, type HandoffState } from './handoff';
export { buildContext, type DoubtContext } from './context';
export {
  buildDoubtBrief,
  recallTargets,
  isRecallable,
  type DoubtMoment,
  type DoubtSurface,
  type DoubtBriefOptions,
  type RecallTarget,
} from './brief';
export { entryLine, exitLine } from './bridge';
export {
  createStubAgent,
  type AgentAdapter,
  type AgentIO,
  type AgentSession,
} from './agent';
