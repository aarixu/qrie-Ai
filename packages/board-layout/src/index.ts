// Public surface of @ai-tutor/board-layout. See README.md for the contract.
export { layoutBeat, BOARD } from './layout';
export type { Instruction, InstructionKind, ScriptBeat, LaidOutBeat } from './types';
export { layoutScene, connectElements, annotateElement, type Placed } from './scene';
export type { RevealStep } from './layout';
export { resolveOverlaps, type Bond } from './collide';
