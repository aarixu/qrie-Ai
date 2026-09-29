/**
 * @ai-tutor/live-board — the canvas protocol for the live tutor.
 *
 * A model says WHAT goes on the board (a closed list of ops, parsed and capped
 * by `parseBoardOps`); code decides WHERE (`layoutLiveTurn`, append mode, over
 * board-layout's rulers). No coordinate ever comes from a model. Live ink is
 * kept in a `LiveState` beside the catalogue lesson and never written into it
 * (TD13).
 *
 * T2.1 and T2.2 of the tutor build plan. Pure: no DOM, no model, no clock.
 * NOT WIRED: nothing in the app calls this yet. The words it carries are NOT
 * screened here — `boardStrings` lists them for the caller's safety screen.
 */
export { parseBoardOps, boardStrings, type ParseOptions } from './parse';
export { layoutLiveTurn, emptyLiveState, nextTurn, augmentLesson } from './layout';
export {
  LIMITS,
  type BoardOp,
  type BoardOpKind,
  type Cursor,
  type Dropped,
  type ListItem,
  type LiveState,
  type LiveStep,
  type LiveTarget,
  type MarkShape,
  type Reveal,
  type WorkLine,
} from './types';
