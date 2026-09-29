/**
 * @ai-tutor/tutor-control — what the tutor does next, decided in code.
 *
 * The LAM decides, the LLM classifies and renders, code checks (the tutor
 * build plan's architecture). This package is the deciding part: a pure
 * `decide(input) → Action` over the judge's verdict and the ask's authored
 * content, with 0 model calls and no clock. It delivers TD1's ladder as far as
 * today's content allows (L0, L1, L3, L8, and L5 once C6 authors worked
 * examples), picks each line from fixed persona lines or authored content in
 * the child's language, refuses any authored content that leaks the answer,
 * and says what the ledger must get for every action (E3).
 *
 * E1a of the plan. NOT WIRED: no app calls it yet. Wiring is E2/E3's job,
 * through the headless held-ask controller (T1.9), and must speak `say` only
 * through the app's safety screen with `haltSession()` covering the path.
 */

export { FAST_WRONG_MS, decide } from './decide.ts';
export { leakTokens, leaks } from './leak.ts';
export { FRAMES, LINES } from './lines.ts';
export { recordsFor, type ActionRecord } from './records.ts';
export type {
  Action,
  ActionKind,
  AskInput,
  BoardIntent,
  DecideInput,
  ErrorClass,
  TutorLanguage,
  Verdict,
  WorkedExample,
} from './types.ts';
