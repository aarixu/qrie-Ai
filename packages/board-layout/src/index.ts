// Public surface of @ai-tutor/board-layout. See README.md for the contract.
export { layoutBeat, offsetElement, BOARD, PAGE_STRIDE } from './layout';
export type { CompareSide, Instruction, InstructionKind, ScriptBeat, LaidOutBeat } from './types';
export { layoutScene, connectElements, annotateElement, type Placed } from './scene';
export type { RevealStep } from './layout';
export { resolveOverlaps, type Bond, type Leash } from './collide';
export { ARRANGEMENTS, type ArrangementName, type SheetReport } from './compose';
export {
  assertNoOverlap,
  findOverlaps,
  OverlapError,
  type Overlap,
  type OverlapOptions,
} from './overlap';
