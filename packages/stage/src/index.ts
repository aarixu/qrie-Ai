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
/**
 * Viewport is NOT re-exported here, deliberately.
 *
 * It pulls in three.js, a GLTF loader and a Draco decoder — about a megabyte
 * before the WASM — and a barrel export drags all of that into every bundle
 * that imports anything from this package. The classroom imports Scene, and
 * was paying for a 3D renderer that not one committed lesson uses.
 *
 * Anything that genuinely needs it imports '@ai-tutor/stage/src/viewport'
 * directly, which is also the seam to load it dynamically at the moment a
 * lesson turns out to contain a model3d element.
 */
// export { Viewport } from './viewport';
// Scene and computeVisible are implemented in Scene.tsx / visible.ts:
export { Scene } from './Scene';
/** Every picture from the web, listed under the board with its links. */
export { CreditsList, creditsOf } from './CreditsList';
/** A board line with `$…$` maths as safe HTML: words escaped, maths typeset. */
export { lineToHtml } from './math';
export { computeVisible } from './visible';
export { computeFrame, bboxOf, type Rect } from './frame';
