// Public surface of @ai-tutor/class-prep. See README.md for the contract.
export type { TopicOutcome } from './prompts.ts';

export { prepareClass, assemble, parsePlan, type LlmAdapter, type PrepOptions } from './prepare.ts';
export { verifySvg } from './verify.ts';
export { PLANNER_SYSTEM, ARTIST_SYSTEM, plannerUser, artistUser, repairUser } from './prompts.ts';
export type {
  Blueprint,
  VisualBrief,
  VisualOutcome,
  PrepReport,
  PrepResult,
  PrepPhase,
  PrepProgress,
} from './types.ts';
export { pickIcons, ICON_PICKER_SYSTEM, iconPickerUser, type IconOption, type IconChoice } from './icons.ts';
export { drawMissingIcons, verifyIconSvg, ICON_ARTIST_SYSTEM, iconArtistUser } from './drawIcon.ts';
export { unsafeMarkup } from './safety.ts';
export {
  drawPicture,
  parseParts,
  imageAspect,
  picturePrompt,
  partFinderUser,
  PART_FINDER_SYSTEM,
  type ImageAdapter,
  type PictureBrief,
  type PictureResult,
  type VisionAdapter,
} from './picture.ts';
export { saveable, idFor, type SavedClass, type SavedEntry, type SavedFile, type SaveMeta } from './save.ts';
export { saidButNotWritten } from './saidNotWritten.ts';
export * from './fromWeb.ts';
export * from './commons.ts';
