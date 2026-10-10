// Public surface of @ai-tutor/class-prep. See README.md for the contract.
export type { TopicOutcome } from './prompts.ts';

// capChecks, dropInventedOutcomes and dropBadProbes are deliberately NOT
// exported: they mutate a blueprint in place, they have no consumer outside
// this package, and a public export is a contract somebody else builds on.
export { prepareClass, assemble, parsePlan, rekeep, type LlmAdapter, type PrepOptions } from './prepare.ts';
export {
  reviewLesson,
  reviewerUser,
  parseVerdict,
  REVIEWER_SYSTEM,
  type ReviewVerdict,
  type ReviewProblem,
  type ReviewOptions,
} from './review.ts';
export { screenSpine, type ScreenedLine } from './screenSpine.ts';
export { verifySvg } from './verify.ts';
export { PLANNER_SYSTEM, ARTIST_SYSTEM, plannerSystemFor, plannerUser, artistUser, repairUser } from './prompts.ts';
export type {
  Blueprint,
  VisualBrief,
  VisualOutcome,
  PrepReport,
  PrepResult,
  Replay,
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
export { saveable, whyNotSaveable, idFor, type SavedClass, type SavedEntry, type SavedFile, type SaveMeta } from './save.ts';
export { saidButNotWritten, inkWaitsForALine } from './saidNotWritten.ts';
export {
  gateLesson,
  checkLessonMaths,
  spokenNotation,
  type GateProblem,
  type GateRule,
  type GateOptions,
  type MathsCheck,
} from './gate.ts';
export type { ComposerReport, PageReport } from './composerChecks.ts';
export * from './fromWeb.ts';
export * from './commons.ts';
export * from './nounPhotos.ts';
export * from './credits.ts';
