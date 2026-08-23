// Public surface of @ai-tutor/persona — the one tutor, everywhere.
// See README.md for the contract and for what to change when you want her to
// behave differently.

export { TUTOR, type TutorTraits } from './traits';

export {
  describeFactors,
  classifyAnswer,
  FACTORS,
  MASTERY_SECURE,
  MASTERY_SHAKY,
  DOUBT_PACE_THRESHOLD,
  STREAK_MIN_DAYS,
  SLOW_ANSWER_MS,
  type StudentContext,
  type Klass,
  type AnswerSignal,
  type Attendance,
  type FactorSpec,
} from './factors';

export { MOMENTS, momentGuidance, type Moment } from './moments';

export {
  SURFACES,
  buildSystemPrompt,
  type Surface,
  type LessonContext,
  type PromptInput,
} from './prompt';
