// Public surface of @ai-tutor/stage. See README.md for the contract.
export {
  applyCommand,
  initialState,
  type StageCommand,
  type StageState,
  type StageMode,
  type CutPlane,
  type CameraPreset,
  type ApplyResult,
} from './state';
export { AnchorRegistry, type AnchorEntry } from './anchors';
export { Viewport } from './viewport';
// Scene and computeVisible are implemented in Scene.tsx / visible.ts:
export { Scene } from './Scene';
export { computeVisible } from './visible';
export { computeFrame, bboxOf, type Rect } from './frame';
