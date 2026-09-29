// Public surface of @ai-tutor/doubt-session. See README.md for the contract.
export {
  createHandoff,
  DEFAULT_MAX_STUDENT_TURNS,
  type Handoff,
  type HandoffState,
  type SpeakResult,
} from './handoff';
export { buildContext, type DoubtContext, type DoubtLanguage } from './context';
export {
  buildDoubtBrief,
  recallTargets,
  isRecallable,
  type DoubtMoment,
  type DoubtSurface,
  type DoubtBriefOptions,
  type RecallTarget,
} from './brief';
export { closingLine, entryLine, exitLine } from './bridge';
export {
  createStubAgent,
  type AgentAdapter,
  type AgentIO,
  type SayOptions,
  type AgentSession,
} from './agent';
