/**
 * @ai-tutor/tutor-control — what the tutor does next, decided in code.
 *
 * The LAM decides, the LLM classifies and renders, code checks (the tutor
 * build plan's architecture). This package is the deciding part: a pure
 * `decide(input) → Action` over the judge's verdict and the ask's authored
 * content, with 0 model calls and no clock. It delivers TD1's ladder as far as
 * a class's content allows (L0, L1, L3, L5 where a worked example is
 * authored, L7 where alternates are, L8), picks each line from fixed persona
 * lines or authored content in
 * the child's language, refuses any authored content that leaks the answer,
 * and says what the ledger must get for every action (E3).
 *
 * E1a of the plan, wired into the classroom's taps, hint chip, spoken answers
 * and silence nudges (apps/classroom/src/screens/ClassRoom.tsx). Every `say`
 * goes out only through the app's safety screen, with `haltSession()`
 * covering the path.
 *
 * The conductor (`createConductor`, `conductor/`) runs a whole live class
 * from a teaching plan that `validatePlan` has passed: after every student
 * turn it picks the next move, with `decide()` as its help ladder. Pure in
 * the same way: no model call, no clock of its own, no randomness, no I/O.
 */

export { FAST_WRONG_MS, decide, matchedOption } from './decide.ts';
export { asksForHint, asksToExplainAgain } from './hintRequest.ts';
export { leakTokens, leaks } from './leak.ts';
export { FRAMES, LINES, RECOGNISE } from './lines.ts';
export { recordsFor, type ActionRecord } from './records.ts';
export type {
  Action,
  ActionKind,
  AskInput,
  BoardIntent,
  DecideHistory,
  DecideInput,
  ErrorClass,
  TutorLanguage,
  Verdict,
  WorkedExample,
} from './types.ts';
export type {
  Ack,
  AlternateMode,
  Conductor,
  ConductorOptions,
  ConductorSnapshot,
  Move,
  MoveKind,
  PlanIdea,
  PlanMisconception,
  PlanPoint,
  PlanQuestion,
  Reading,
  StudentClass,
  TeachingPlan,
} from './conductor/types.ts';
export { STUDENT_CLASSES } from './conductor/types.ts';
export { createConductor, validatePlan, type PlanCheck, type PlanCheckOptions } from './conductor/index.ts';
